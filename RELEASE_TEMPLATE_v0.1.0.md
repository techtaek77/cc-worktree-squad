# cc-worktree-squad v0.1.0

## Highlights

- Added core CLI commands: `init`, `spawn`, `status`, and `teardown`
- Added session manifest + `SESSION_BRIEF.md` generation per worktree
- Added tests for CLI parsing and template rendering
- Added initial contributor, issue, and release automation templates

## Why this release matters

`cc-worktree-squad` makes parallel Claude Code sessions practical by isolating each task into a dedicated Git worktree and branch.

## Quick start

```bash
npm link
ccws init
ccws spawn bugfix-auth
ccws status
```

## Known limitations

- No built-in tmux auto-launch yet
- No interactive merge assistant yet
