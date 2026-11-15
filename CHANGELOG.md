# Changelog

Updates to this project, newest first. Older entries come from the Git history (commit hash in brackets).

## 2026-11-15
### Fixed
- **Pop-up boxes no longer scroll the page behind them:** swiping inside a pop-up, or on the dimmed area around it, stays in the pop-up (`overscroll-behavior` on `dialog:modal` and `::backdrop`). Full effect in Chrome, Edge and Firefox; Safari applies it when the box's own content scrolls. From Chrome's Modern Web Guidance. (c08d0be)

## 2026-11-12
### Notes
- Added CLAUDE.md: notes for Claude on how this project works, its rules and decisions. (c08d0be)
- Started this changelog; from now on every update adds an entry here. (c08d0be)

## 2026-11-04
### Removed
- Remove three unused CSS rules (2ca5fa8)

## 2026-11-01
### Added
- Add lint config files; make summarize.py executable (2ec621e)
- Add files via upload (c25dda9)
- Add files via upload (1867ebe)
