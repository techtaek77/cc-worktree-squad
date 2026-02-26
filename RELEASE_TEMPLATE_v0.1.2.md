# cc-worktree-squad v0.1.2

## Highlights

- Added `package-lock.json` to fix GitHub Actions npm-cache failures
- CI and release workflows are now compatible with tagged builds

## Why this patch exists

`v0.1.1` introduced useful features, but CI/release jobs failed due to missing lockfile.
`v0.1.2` is a stability patch to fix the pipeline.
