# cc-worktree-squad

[![CI](https://github.com/techtaek77/cc-worktree-squad/actions/workflows/ci.yml/badge.svg)](https://github.com/techtaek77/cc-worktree-squad/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/techtaek77/cc-worktree-squad?display_name=tag)](https://github.com/techtaek77/cc-worktree-squad/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/techtaek77/cc-worktree-squad/blob/main/LICENSE)

Parallel worktree launcher for Claude Code sessions.

It helps you run multiple coding threads in one repository without branch collisions or folder chaos.

## Requirements

- Git 2.30+
- Node.js 18+

## What it does

- `init`: Bootstraps `.ccws/` config in your current Git repository
- `spawn`: Creates a dedicated worktree + branch + `SESSION_BRIEF.md`
- `squad`: Creates multiple worktrees and launches a tiled tmux board
- `status`: Shows currently managed worktrees
- `teardown`: Removes a worktree and optionally deletes its branch

## Install (local dev)

```bash
cd /path/to/cc-worktree-squad
npm link
```

Then from any Git repo:

```bash
ccws init
ccws spawn bugfix-auth
ccws spawn feature-docs --tmux
ccws squad api ui docs --session my-board
ccws status
ccws teardown bugfix-auth --delete-branch
```

## Command reference

```bash
ccws init [--force]
ccws spawn <name> [--base <branch>] [--branch <name>] [--tmux] [--tmux-cmd <command>] [--dry-run]
ccws squad <name...> [--base <branch>] [--session <tmux-name>] [--tmux-cmd <command>] [--dry-run]
ccws status
ccws teardown <name> [--delete-branch] [--safe] [--dry-run]
```

## How branch naming works

By default:

- Prefix: `codex/`
- Auto branch name format: `codex/<session>-<yyyymmdd-hhmm>`

Example:

`codex/bugfix-auth-20260226-0930`

## Teardown behavior

`teardown` uses `git worktree remove --force` by default because active sessions often have untracked notes (`SESSION_BRIEF.md`).

If you want strict safety mode (fail on dirty worktree), use:

```bash
ccws teardown bugfix-auth --safe
```

## Spawn with tmux

Use `--tmux` to create a detached tmux session automatically:

```bash
ccws spawn fix-parser --tmux
tmux attach -t fix-parser
```

Use a custom startup command:

```bash
ccws spawn fix-parser --tmux --tmux-cmd "claude"
```

## Squad mode (multi-agent board)

Create multiple worktrees and launch all of them in one tiled tmux session:

```bash
ccws squad api ui docs --session feature-squad
tmux attach -t feature-squad
```

Each pane starts in its own worktree and runs `claude`.

## Generated structure

Inside your target repository:

```text
.ccws/
  config.json
  session-template.md
  sessions/
    bugfix-auth.json
  worktrees/
    bugfix-auth/
      SESSION_BRIEF.md
```

## Why this exists

When you run 3-5 parallel tasks with Claude Code, branch/workdir collisions become the real boss fight.
This CLI keeps each task isolated so you can focus on shipping.

## Development

```bash
npm test
```

## Release process

```bash
# 1) Update CHANGELOG.md
# 2) Commit changes
git tag v0.1.0
git push origin main --tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml` to run tests and create a GitHub Release.
