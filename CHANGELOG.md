# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and follows Semantic Versioning.

## [0.2.0] - 2026-02-27

### Added

- `ccws squad <name...>` command for one-shot multi-worktree creation
- Automatic tiled tmux board launch for squad sessions
- `--session` option to set custom tmux board name

## [0.1.2] - 2026-02-27

### Fixed

- Added `package-lock.json` so GitHub Actions npm cache works reliably
- Restored CI/Release workflow compatibility for tagged builds

## [0.1.1] - 2026-02-27

### Added

- `ccws spawn --tmux` to launch a detached tmux session automatically
- `ccws spawn --tmux-cmd <command>` for custom tmux startup command
- README badges for CI, release, and license visibility

## [0.1.0] - 2026-02-26

### Added

- Initial CLI with `init`, `spawn`, `status`, and `teardown`
- Session metadata and template generation (`SESSION_BRIEF.md`)
- Safe defaults for parallel Git worktree session management
- Unit tests for parser/template utilities
- Initial docs and release scaffolding
