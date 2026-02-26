# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and follows Semantic Versioning.

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
