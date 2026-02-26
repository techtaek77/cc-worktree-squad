const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const TOOL_DIR = ".ccws";
const CONFIG_FILE = ".ccws/config.json";
const TEMPLATE_FILE = ".ccws/session-template.md";
const DEFAULT_WORKTREE_DIR = ".ccws/worktrees";
const DEFAULT_SESSIONS_DIR = ".ccws/sessions";

const DEFAULT_TEMPLATE = `# Session Brief

You are working in a dedicated worktree session.

- Session name: {{session_name}}
- Branch: {{branch}}
- Base branch: {{base_branch}}
- Worktree path: {{worktree_path}}
- Created at: {{created_at}}

## Goal
- Fill this section before coding.

## Constraints
- Keep commits small and focused.
- Run tests/lint relevant to the changes.
`;

function main(argv) {
  const { command, positionals, options } = parseArgs(argv);

  try {
    switch (command) {
      case "init":
        commandInit(options);
        break;
      case "spawn":
        commandSpawn(positionals[0], options);
        break;
      case "squad":
      case "board":
        commandSquad(positionals, options);
        break;
      case "status":
      case "list":
        commandStatus();
        break;
      case "standup":
        commandStandup(options);
        break;
      case "teardown":
      case "rm":
        commandTeardown(positionals[0], options);
        break;
      case "help":
      case "--help":
      case "-h":
      case "":
      case undefined:
        printHelp();
        break;
      default:
        fail(`Unknown command: ${command}\n`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    fail(error.message);
  }
}

function commandInit(options) {
  const repoRoot = getRepoRoot(process.cwd());
  const force = getBooleanOption(options, "force");
  const configPath = path.join(repoRoot, CONFIG_FILE);

  if (fs.existsSync(configPath) && !force) {
    throw new Error(
      `Already initialized at ${configPath}. Use --force if you want to overwrite.`
    );
  }

  const defaultBaseBranch = detectDefaultBaseBranch(repoRoot);
  const config = {
    schemaVersion: 1,
    workspaceDir: DEFAULT_WORKTREE_DIR,
    sessionsDir: DEFAULT_SESSIONS_DIR,
    branchPrefix: "codex/",
    defaultBaseBranch,
    templateFile: TEMPLATE_FILE
  };

  ensureDir(path.join(repoRoot, TOOL_DIR));
  ensureDir(path.join(repoRoot, config.workspaceDir));
  ensureDir(path.join(repoRoot, config.sessionsDir));
  writeJson(configPath, config);

  const templatePath = path.join(repoRoot, config.templateFile);
  if (!fs.existsSync(templatePath) || force) {
    fs.writeFileSync(templatePath, DEFAULT_TEMPLATE, "utf8");
  }

  console.log("Initialized cc-worktree-squad.");
  console.log(`- Repo: ${repoRoot}`);
  console.log(`- Base branch: ${config.defaultBaseBranch}`);
  console.log(`- Config: ${configPath}`);
}

function commandSpawn(rawName, options) {
  if (!rawName) {
    throw new Error("Session name is required. Example: ccws spawn bugfix-auth");
  }

  const repoRoot = getRepoRoot(process.cwd());
  const config = readConfig(repoRoot);
  const name = normalizeSessionName(rawName);

  ensureDir(path.join(repoRoot, config.workspaceDir));
  ensureDir(path.join(repoRoot, config.sessionsDir));

  const baseBranch = options.base || config.defaultBaseBranch;

  const dryRun = getBooleanOption(options, "dry-run");
  const useTmux = getBooleanOption(options, "tmux");
  const tmuxCommand = options["tmux-cmd"] || "claude";
  const session = createSession(repoRoot, config, name, {
    baseBranch,
    branch: options.branch,
    dryRun
  });

  if (dryRun) {
    if (useTmux) {
      console.log(
        `[dry-run] Would run: tmux new-session -d -s ${name} -c "${session.worktreePath}" "${tmuxCommand}"`
      );
    }
    return;
  }

  console.log("Session created.");
  console.log(`- Name: ${name}`);
  console.log(`- Branch: ${session.branch}`);
  console.log(`- Base: ${baseBranch}`);
  console.log(`- Worktree: ${session.worktreePath}`);

  if (useTmux) {
    startTmuxSession(name, session.worktreePath, tmuxCommand);
    console.log(`- tmux: launched session "${name}"`);
  }

  console.log("");
  console.log("Next:");
  if (useTmux) {
    console.log(`tmux attach -t ${name}`);
  } else {
    console.log(`cd "${session.worktreePath}"`);
    console.log("claude");
    console.log("");
    console.log("tmux optional:");
    console.log(`tmux new -s ${name} -c "${session.worktreePath}" "claude"`);
  }
}

function commandSquad(rawNames, options) {
  const names = (rawNames || []).map((name) => normalizeSessionName(name)).filter(Boolean);
  if (names.length === 0) {
    throw new Error("At least one session name is required. Example: ccws squad api ui");
  }

  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length !== names.length) {
    throw new Error("Session names must be unique in squad mode.");
  }

  if (options.branch && names.length > 1) {
    throw new Error("`--branch` is only supported with one squad session.");
  }

  const repoRoot = getRepoRoot(process.cwd());
  const config = readConfig(repoRoot);
  const baseBranch = options.base || config.defaultBaseBranch;
  const dryRun = getBooleanOption(options, "dry-run");
  const tmuxCommand = options["tmux-cmd"] || "claude";
  const tmuxSessionName = normalizeSessionName(options.session || `squad-${timestampSlug()}`);

  if (!tmuxSessionName) {
    throw new Error("Invalid tmux session name. Try `--session squad-dev`.");
  }

  const sessions = uniqueNames.map((name) =>
    createSession(repoRoot, config, name, {
      baseBranch,
      branch: uniqueNames.length === 1 ? options.branch : undefined,
      dryRun
    })
  );

  if (dryRun) {
    for (const session of sessions) {
      console.log(
        `[dry-run] Would run: git worktree add -b ${session.branch} ${session.worktreePath} ${session.baseBranch}`
      );
    }
    console.log(
      `[dry-run] Would run: tmux new-session -d -s ${tmuxSessionName} -c "${sessions[0].worktreePath}" "${tmuxCommand}"`
    );
    for (let i = 1; i < sessions.length; i += 1) {
      console.log(
        `[dry-run] Would run: tmux split-window -t ${tmuxSessionName}:0 -c "${sessions[i].worktreePath}" "${tmuxCommand}"`
      );
    }
    if (sessions.length > 1) {
      console.log(`[dry-run] Would run: tmux select-layout -t ${tmuxSessionName}:0 tiled`);
    }
    return;
  }

  startTmuxSquadSession(tmuxSessionName, sessions, tmuxCommand);

  console.log("Squad created.");
  console.log(`- tmux session: ${tmuxSessionName}`);
  for (const session of sessions) {
    console.log(`- ${session.name} | ${session.branch} | ${session.worktreePath}`);
  }
  console.log("");
  console.log("Next:");
  console.log(`tmux attach -t ${tmuxSessionName}`);
}

function commandStatus() {
  const repoRoot = getRepoRoot(process.cwd());
  const config = readConfig(repoRoot);

  const managedRoot = path.join(repoRoot, config.workspaceDir);
  const worktrees = parseWorktreePorcelain(
    runGit(["worktree", "list", "--porcelain"], { cwd: repoRoot }).stdout
  );
  const sessions = readSessions(path.join(repoRoot, config.sessionsDir));

  const managedWorktrees = worktrees.filter((entry) =>
    entry.worktree.startsWith(managedRoot + path.sep) || entry.worktree === managedRoot
  );

  console.log(`Repo: ${repoRoot}`);
  if (managedWorktrees.length === 0) {
    console.log("No managed worktrees found.");
    return;
  }

  for (const entry of managedWorktrees) {
    const matchedSession = sessions.find((session) => session.worktreePath === entry.worktree);
    const name = matchedSession ? matchedSession.name : path.basename(entry.worktree);
    const branch = entry.branch || (matchedSession ? matchedSession.branch : "-");
    const created = matchedSession ? matchedSession.createdAt : "-";
    console.log(`- ${name} | ${branch} | ${relativeToRepo(repoRoot, entry.worktree)} | ${created}`);
  }
}

function commandStandup(options) {
  const repoRoot = getRepoRoot(process.cwd());
  const config = readConfig(repoRoot);
  const sessions = readSessions(path.join(repoRoot, config.sessionsDir))
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (sessions.length === 0) {
    console.log("No sessions found. Create one with `ccws spawn <name>` first.");
    return;
  }

  const maxFiles = getNumberOption(options, "files", 3);
  const now = new Date().toISOString();

  console.log(`Standup Report (${now})`);
  console.log(`Repo: ${repoRoot}`);
  console.log(`Sessions: ${sessions.length}`);

  for (const session of sessions) {
    const report = summarizeSession(session, maxFiles);
    console.log("");
    console.log(`## ${session.name} (${session.branch})`);
    console.log(`Path: ${relativeToRepo(repoRoot, session.worktreePath)}`);

    if (!report.exists) {
      console.log("State: missing worktree path");
      continue;
    }
    if (report.error) {
      console.log(`State: error (${report.error})`);
      continue;
    }

    console.log(`Last commit: ${report.lastCommit || "-"}`);
    if (report.totalChanges === 0) {
      console.log("Changes: clean");
      continue;
    }

    console.log(
      `Changes: ${report.totalChanges} files (staged ${report.staged}, unstaged ${report.unstaged}, untracked ${report.untracked})`
    );
    if (report.topFiles.length > 0) {
      console.log(`Top files: ${report.topFiles.join(", ")}`);
    }
  }
}

function commandTeardown(rawName, options) {
  if (!rawName) {
    throw new Error("Session name is required. Example: ccws teardown bugfix-auth");
  }

  const name = normalizeSessionName(rawName);
  const repoRoot = getRepoRoot(process.cwd());
  const config = readConfig(repoRoot);
  const sessionPath = path.join(repoRoot, config.sessionsDir, `${name}.json`);
  const session = fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, "utf8")) : null;

  const worktreePath = session
    ? session.worktreePath
    : path.join(repoRoot, config.workspaceDir, name);
  const deleteBranch = getBooleanOption(options, "delete-branch");
  const force = getBooleanOption(options, "force");
  const safe = getBooleanOption(options, "safe");
  const dryRun = getBooleanOption(options, "dry-run");

  if (!fs.existsSync(worktreePath)) {
    throw new Error(`Worktree does not exist: ${worktreePath}`);
  }

  const removeArgs = ["worktree", "remove"];
  if (force || !safe) {
    removeArgs.push("--force");
  }
  removeArgs.push(worktreePath);

  if (dryRun) {
    console.log(`[dry-run] Would run: git ${removeArgs.join(" ")}`);
    if (deleteBranch && session && session.branch) {
      console.log(`[dry-run] Would run: git branch -D ${session.branch}`);
    }
    return;
  }

  runGit(removeArgs, { cwd: repoRoot });

  if (deleteBranch && session && session.branch) {
    const result = runGit(["branch", "-D", session.branch], {
      cwd: repoRoot,
      allowFailure: true
    });
    if (result.status !== 0) {
      console.error(`Warning: failed to delete branch ${session.branch}.`);
    }
  }

  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }

  console.log(`Session removed: ${name}`);
}

function printHelp() {
  console.log(`cc-worktree-squad (ccws)

Usage:
  ccws init [--force]
  ccws spawn <name> [--base <branch>] [--branch <name>] [--tmux] [--tmux-cmd <command>] [--dry-run]
  ccws squad <name...> [--base <branch>] [--session <tmux-name>] [--tmux-cmd <command>] [--dry-run]
  ccws status
  ccws standup [--files <count>]
  ccws teardown <name> [--delete-branch] [--safe] [--dry-run]

Notes:
  - Run commands from inside a Git repository.
  - Branch prefix defaults to "codex/".
  - Use --tmux to launch a detached tmux session automatically.
  - Use squad for one-command multi-worktree + multi-pane tmux boards.
  - Use standup for session-by-session change summaries.
  - teardown uses --force by default (use --safe to disable).
`);
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const command = args.shift();
  const options = {};
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    if (withoutPrefix.includes("=")) {
      const [rawKey, ...valueParts] = withoutPrefix.split("=");
      options[rawKey] = valueParts.join("=");
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      options[withoutPrefix] = next;
      i += 1;
    } else {
      options[withoutPrefix] = true;
    }
  }

  return { command, positionals, options };
}

function getRepoRoot(cwd) {
  const result = runGit(["rev-parse", "--show-toplevel"], { cwd, allowFailure: true });
  if (result.status !== 0) {
    throw new Error("Not inside a Git repository.");
  }
  return result.stdout.trim();
}

function detectDefaultBaseBranch(repoRoot) {
  const headRef = runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
    cwd: repoRoot,
    allowFailure: true
  });

  if (headRef.status === 0) {
    return headRef.stdout.trim().replace(/^origin\//, "");
  }

  if (branchExists(repoRoot, "main")) {
    return "main";
  }
  if (branchExists(repoRoot, "master")) {
    return "master";
  }

  const current = runGit(["branch", "--show-current"], { cwd: repoRoot });
  const value = current.stdout.trim();
  if (!value) {
    throw new Error("Could not determine a default base branch.");
  }
  return value;
}

function readConfig(repoRoot) {
  const configPath = path.join(repoRoot, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Not initialized. Run: ccws init\nExpected config: ${configPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    workspaceDir: parsed.workspaceDir || DEFAULT_WORKTREE_DIR,
    sessionsDir: parsed.sessionsDir || DEFAULT_SESSIONS_DIR,
    branchPrefix: parsed.branchPrefix || "codex/",
    defaultBaseBranch: parsed.defaultBaseBranch || detectDefaultBaseBranch(repoRoot),
    templateFile: parsed.templateFile || TEMPLATE_FILE
  };
}

function loadTemplate(repoRoot, config) {
  const templatePath = path.join(repoRoot, config.templateFile);
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, "utf8");
  }
  return DEFAULT_TEMPLATE;
}

function renderTemplate(template, vars) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : ""
  );
}

function readSessions(sessionsDir) {
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }
  return fs
    .readdirSync(sessionsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const fullPath = path.join(sessionsDir, file);
      try {
        return JSON.parse(fs.readFileSync(fullPath, "utf8"));
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function ensureBaseBranchExists(repoRoot, branch) {
  if (localBranchExists(repoRoot, branch)) {
    return;
  }

  if (remoteBranchExists(repoRoot, branch)) {
    runGit(["branch", branch, `origin/${branch}`], { cwd: repoRoot });
    return;
  }

  throw new Error(`Base branch not found locally or on origin: ${branch}`);
}

function branchExists(repoRoot, branch) {
  return localBranchExists(repoRoot, branch) || remoteBranchExists(repoRoot, branch);
}

function localBranchExists(repoRoot, branch) {
  return (
    runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: repoRoot,
      allowFailure: true
    }).status === 0
  );
}

function remoteBranchExists(repoRoot, branch) {
  return (
    runGit(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], {
      cwd: repoRoot,
      allowFailure: true
    }).status === 0
  );
}

function parseWorktreePorcelain(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;

  for (const line of lines) {
    if (!line.trim()) {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }

    if (line.startsWith("worktree ")) {
      if (current) {
        entries.push(current);
      }
      current = { worktree: line.slice("worktree ".length) };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    }
  }

  if (current) {
    entries.push(current);
  }
  return entries;
}

function parseGitStatusPorcelain(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const files = [];
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of lines) {
    if (line.startsWith("?? ")) {
      untracked += 1;
      files.push(line.slice(3).trim());
      continue;
    }

    if (line.length < 4) {
      continue;
    }

    const x = line[0];
    const y = line[1];
    if (x !== " " && x !== "?") {
      staged += 1;
    }
    if (y !== " " && y !== "?") {
      unstaged += 1;
    }
    files.push(line.slice(3).trim());
  }

  return {
    staged,
    unstaged,
    untracked,
    totalChanges: lines.length,
    files
  };
}

function relativeToRepo(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath) || ".";
}

function normalizeSessionName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function timestampSlug() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

function createSession(repoRoot, config, rawName, options = {}) {
  const name = normalizeSessionName(rawName);
  if (!name) {
    throw new Error(`Invalid session name: ${rawName}`);
  }

  ensureDir(path.join(repoRoot, config.workspaceDir));
  ensureDir(path.join(repoRoot, config.sessionsDir));

  const baseBranch = options.baseBranch || config.defaultBaseBranch;
  ensureBaseBranchExists(repoRoot, baseBranch);

  const branch = options.branch || `${config.branchPrefix}${name}-${timestampSlug()}`;
  if (branchExists(repoRoot, branch)) {
    throw new Error(`Branch already exists: ${branch}`);
  }

  const worktreePath = path.join(repoRoot, config.workspaceDir, name);
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  const createdAt = new Date().toISOString();
  const session = {
    schemaVersion: 1,
    name,
    branch,
    baseBranch,
    worktreePath,
    createdAt
  };

  if (options.dryRun) {
    return session;
  }

  runGit(["worktree", "add", "-b", branch, worktreePath, baseBranch], { cwd: repoRoot });

  const brief = renderTemplate(loadTemplate(repoRoot, config), {
    session_name: name,
    branch,
    base_branch: baseBranch,
    worktree_path: worktreePath,
    created_at: createdAt
  });
  fs.writeFileSync(path.join(worktreePath, "SESSION_BRIEF.md"), brief, "utf8");
  writeJson(path.join(repoRoot, config.sessionsDir, `${name}.json`), session);

  return session;
}

function runGit(args, options = {}) {
  return run("git", args, options);
}

function startTmuxSession(sessionName, cwd, command) {
  if (!isExecutableAvailable("tmux")) {
    throw new Error("tmux is not installed. Remove --tmux or install tmux first.");
  }

  const hasSession = run("tmux", ["has-session", "-t", sessionName], {
    allowFailure: true
  });
  if (hasSession.status === 0) {
    throw new Error(`tmux session already exists: ${sessionName}`);
  }

  run("tmux", ["new-session", "-d", "-s", sessionName, "-c", cwd, command]);
}

function startTmuxSquadSession(sessionName, sessions, command) {
  if (!sessions.length) {
    throw new Error("No sessions to launch.");
  }
  if (!isExecutableAvailable("tmux")) {
    throw new Error("tmux is not installed. Install tmux first to use squad mode.");
  }

  const hasSession = run("tmux", ["has-session", "-t", sessionName], {
    allowFailure: true
  });
  if (hasSession.status === 0) {
    throw new Error(`tmux session already exists: ${sessionName}`);
  }

  run("tmux", ["new-session", "-d", "-s", sessionName, "-c", sessions[0].worktreePath, command]);
  for (let i = 1; i < sessions.length; i += 1) {
    run("tmux", ["split-window", "-t", `${sessionName}:0`, "-c", sessions[i].worktreePath, command]);
  }
  if (sessions.length > 1) {
    run("tmux", ["select-layout", "-t", `${sessionName}:0`, "tiled"]);
  }
}

function summarizeSession(session, maxFiles) {
  if (!fs.existsSync(session.worktreePath)) {
    return { exists: false };
  }

  const statusResult = runGit(["-C", session.worktreePath, "status", "--porcelain"], {
    allowFailure: true
  });
  if (statusResult.status !== 0) {
    return {
      exists: true,
      error: (statusResult.stderr || "failed to read git status").trim()
    };
  }

  const parsed = parseGitStatusPorcelain(statusResult.stdout || "");
  const commitResult = runGit(
    ["-C", session.worktreePath, "log", "-1", "--pretty=format:%h %cr %s"],
    { allowFailure: true }
  );

  return {
    exists: true,
    error: null,
    lastCommit: commitResult.status === 0 ? (commitResult.stdout || "").trim() : null,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
    totalChanges: parsed.totalChanges,
    topFiles: parsed.files.slice(0, Math.max(0, maxFiles))
  };
}

function isExecutableAvailable(bin) {
  const result = spawnSync(bin, ["--version"], { encoding: "utf8" });
  return !result.error;
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd,
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(`Command failed: ${bin} ${args.join(" ")}${stderr}`);
  }

  return result;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function getBooleanOption(options, key) {
  if (!options || !Object.prototype.hasOwnProperty.call(options, key)) {
    return false;
  }
  if (typeof options[key] === "boolean") {
    return options[key];
  }
  return String(options[key]).toLowerCase() === "true";
}

function getNumberOption(options, key, fallback) {
  if (!options || !Object.prototype.hasOwnProperty.call(options, key)) {
    return fallback;
  }
  const value = Number(options[key]);
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function fail(message) {
  console.error(`Error: ${message}`);
}

module.exports = {
  main,
  parseArgs,
  parseWorktreePorcelain,
  parseGitStatusPorcelain,
  normalizeSessionName,
  renderTemplate,
  createSession,
  summarizeSession
};
