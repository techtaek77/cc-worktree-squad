# cc-worktree-squad v0.2.0

## Highlights

- Added `ccws squad <name...>` for one-command multi-agent setup
- Added automatic tiled tmux board launch for squad sessions
- Added `--session` option to set custom tmux board names

## Quick start

```bash
ccws init
ccws squad api ui docs --session feature-squad
tmux attach -t feature-squad
```

## Why this matters

Parallel Claude work is now a first-class workflow: one command creates isolated worktrees and opens a ready-to-use tmux multi-pane board.
