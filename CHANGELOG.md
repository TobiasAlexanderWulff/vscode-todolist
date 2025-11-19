# Change Log

All notable changes to the "vscode-todo" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- Phase 1 foundation: removed scaffold command, registered real TODO commands and keybindings, and documented the product vision in `docs/vision.md`.
- Localization bootstrap with `@vscode/l10n` plus English/German bundles for runtime strings and `package.nls.*.json`.
- Implemented the `TodoRepository` with scoped persistence (profile/workspace), undo snapshots, and position metadata. Added the `todo.confirmDestructiveActions` setting.
- Updated developer docs (`README.md`, `docs/implementation-plan.md`, `AGENTS.md`) to describe workflows and the implementation roadmap.
