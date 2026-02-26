# cc-worktree-squad v0.1.1

## Highlights

- Added `spawn --tmux` to auto-start a detached tmux session
- Added `spawn --tmux-cmd` for custom startup command
- Added README badges (CI, release, license)

## Quick example

```bash
ccws spawn fix-parser --tmux
tmux attach -t fix-parser
```

## Notes

- If `tmux` is not installed, `spawn --tmux` fails with a clear message.
