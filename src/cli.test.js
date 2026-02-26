const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  parseWorktreePorcelain,
  normalizeSessionName,
  renderTemplate
} = require("./cli");

test("parseArgs handles flags and key-values", () => {
  const parsed = parseArgs([
    "spawn",
    "My Session",
    "--base",
    "main",
    "--dry-run",
    "--tmux",
    "--tmux-cmd",
    "claude --dangerously-skip-permissions",
    "--branch=codex/my-session"
  ]);

  assert.equal(parsed.command, "spawn");
  assert.deepEqual(parsed.positionals, ["My Session"]);
  assert.equal(parsed.options.base, "main");
  assert.equal(parsed.options["dry-run"], true);
  assert.equal(parsed.options.tmux, true);
  assert.equal(parsed.options["tmux-cmd"], "claude --dangerously-skip-permissions");
  assert.equal(parsed.options.branch, "codex/my-session");
});

test("parseArgs handles squad command and list positionals", () => {
  const parsed = parseArgs([
    "squad",
    "api",
    "ui",
    "docs",
    "--session",
    "my-board",
    "--tmux-cmd=claude"
  ]);

  assert.equal(parsed.command, "squad");
  assert.deepEqual(parsed.positionals, ["api", "ui", "docs"]);
  assert.equal(parsed.options.session, "my-board");
  assert.equal(parsed.options["tmux-cmd"], "claude");
});

test("parseWorktreePorcelain parses entries", () => {
  const text = [
    "worktree /repo",
    "HEAD aaa",
    "branch refs/heads/main",
    "",
    "worktree /repo/.ccws/worktrees/bugfix-auth",
    "HEAD bbb",
    "branch refs/heads/codex/bugfix-auth-20260226-2200",
    ""
  ].join("\n");

  const entries = parseWorktreePorcelain(text);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].worktree, "/repo/.ccws/worktrees/bugfix-auth");
  assert.equal(entries[1].branch, "codex/bugfix-auth-20260226-2200");
});

test("normalizeSessionName creates safe slugs", () => {
  assert.equal(normalizeSessionName("  Bugfix Auth !!  "), "bugfix-auth");
  assert.equal(normalizeSessionName("A__B"), "a__b");
});

test("renderTemplate applies placeholders", () => {
  const rendered = renderTemplate("hi {{name}} from {{team}}", {
    name: "jt",
    team: "ccws"
  });
  assert.equal(rendered, "hi jt from ccws");
});
