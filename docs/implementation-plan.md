# Implementation Plan

High-level roadmap for building the VS Code TODO extension. Each phase references the agreements captured in `docs/vision.md` and `AGENTS.md`.

## Phase 1 – Foundation
1. **Clean scaffold**
   - Remove the default `helloWorld` command and placeholder text.
   - Configure localization plumbing (`@vscode/l10n`) and set up EN/DE message bundles.
2. **State & models**
   - Define the `Todo` model (id, title, completed, scope, position, timestamps if needed).
   - Implement `TodoRepository` abstraction that persists via `globalState` (profile) and `workspaceState` (per folder), including undo buffer support.
3. **Settings & configuration**
   - Add `todo.confirmDestructiveActions` + future-proof settings namespace.

## Phase 2 – Tree View & Commands
1. **Tree provider**
   - Build `TodoTreeDataProvider` with root nodes: `Global` and `Projects`.
   - Handle multi-root folders by grouping todos by `workspaceFolder.uri`.
   - Support drag-and-drop reordering (update `position` fields).
2. **Commands**
   - Implement `todo.addTodo`, `todo.editTodo`, `todo.completeTodo`, `todo.removeTodo`, `todo.clearTodos`.
   - Respect localization for prompts/messages and tie commands to the tree selection when appropriate.
3. **Confirmation & undo**
   - Prompt only for multi-item clears, obeying `todo.confirmDestructiveActions`.
   - Show a VS Code information toast with an “Undo” action that restores prior state if clicked within a timeout.

## Phase 3 – UX Polish
1. **Animations & feedback**
   - Add subtle TreeView refresh animations (e.g., temporary placeholders or fade-out cues after removals).
   - Update status bar / notifications as needed.
2. **Documentation**
   - Replace README boilerplate with actual feature descriptions, shortcut references, and screenshots/gifs of the TreeView.
   - Update `CHANGELOG.md` for each milestone; keep `docs/vision.md` and `AGENTS.md` in sync with scope changes.

## Phase 4 – Testing & Quality
1. **Unit tests**
   - Cover repository persistence, ordering logic, and undo buffer using mocked contexts.
2. **Integration tests**
   - Use `@vscode/test-electron` to validate commands, localization switching, multi-root behavior, and confirmation flow.
3. **Automation**
   - Consider adding GitHub Actions workflow for `npm run compile` + `npm run test`.

## Phase 5 – Release Prep
1. **Lint/type/test gate**
   - Ensure `npm run compile`, `npm run test`, and `npm run package` succeed consistently.
2. **Marketplace readiness**
   - Finalize icon, categories, keywords, and publish metadata.
   - Produce screenshots/animations referenced in README.

## Ongoing
- Keep the roadmap updated as decisions evolve.
- Reference this plan when creating issues or delegating work to agents.
