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
      case "status":
      case "list":
        commandStatus();
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

  const name = normalizeSessionName(rawName);
  const repoRoot = getRepoRoot(process.cwd());
  const config = readConfig(repoRoot);

  ensureDir(path.join(repoRoot, config.workspaceDir));
  ensureDir(path.join(repoRoot, config.sessionsDir));

  const baseBranch = options.base || config.defaultBaseBranch;
  ensureBaseBranchExists(repoRoot, baseBranch);

  const branch = options.branch || `${config.branchPrefix}${name}-${timestampSlug()}`;
  if (branchExists(repoRoot, branch)) {
    throw new Error(`Branch already exists: ${branch}`);
  }

  const worktreePath = path.join(repoRoot, config.workspaceDir, name);
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  const dryRun = getBooleanOption(options, "dry-run");
  const useTmux = getBooleanOption(options, "tmux");
  const tmuxCommand = options["tmux-cmd"] || "claude";
  if (dryRun) {
    console.log("[dry-run] Would run:");
    console.log(`git worktree add -b ${branch} ${worktreePath} ${baseBranch}`);
    if (useTmux) {
      console.log(
        `[dry-run] Would run: tmux new-session -d -s ${name} -c "${worktreePath}" "${tmuxCommand}"`
      );
    }
    return;
  }

  runGit(["worktree", "add", "-b", branch, worktreePath, baseBranch], { cwd: repoRoot });

  const createdAt = new Date().toISOString();
  const brief = renderTemplate(loadTemplate(repoRoot, config), {
    session_name: name,
    branch,
    base_branch: baseBranch,
    worktree_path: worktreePath,
    created_at: createdAt
  });
  fs.writeFileSync(path.join(worktreePath, "SESSION_BRIEF.md"), brief, "utf8");

  const session = {
    schemaVersion: 1,
    name,
    branch,
    baseBranch,
    worktreePath,
    createdAt
  };
  writeJson(path.join(repoRoot, config.sessionsDir, `${name}.json`), session);

  console.log("Session created.");
  console.log(`- Name: ${name}`);
  console.log(`- Branch: ${branch}`);
  console.log(`- Base: ${baseBranch}`);
  console.log(`- Worktree: ${worktreePath}`);

  if (useTmux) {
    startTmuxSession(name, worktreePath, tmuxCommand);
    console.log(`- tmux: launched session "${name}"`);
  }

  console.log("");
  console.log("Next:");
  if (useTmux) {
    console.log(`tmux attach -t ${name}`);
  } else {
    console.log(`cd "${worktreePath}"`);
    console.log("claude");
    console.log("");
    console.log("tmux optional:");
    console.log(`tmux new -s ${name} -c "${worktreePath}" "claude"`);
  }
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
  ccws status
  ccws teardown <name> [--delete-branch] [--safe] [--dry-run]

Notes:
  - Run commands from inside a Git repository.
  - Branch prefix defaults to "codex/".
  - Use --tmux to launch a detached tmux session automatically.
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

function fail(message) {
  console.error(`Error: ${message}`);
}

module.exports = {
  main,
  parseArgs,
  parseWorktreePorcelain,
  normalizeSessionName,
  renderTemplate
};
