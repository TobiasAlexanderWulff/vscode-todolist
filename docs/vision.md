# Vision

## Context
- We are building a VS Code extension scaffolded via `yo code` (TypeScript template).
- The extension should make it effortless to track TODO items without leaving the editor.
- VS Code already provides profile-aware global storage and workspace-aware storage that we can leverage.

## High-level Goal
Create a lightweight TODO manager baked into the VS Code UI with two complementary scopes:
1. **Global (profile-bound)** — personal todos that follow the user across every workspace within the active VS Code profile.
2. **Project (workspace-bound)** — todos that live with the current project and are shared with the team whenever the workspace is opened.

Both scopes should be visible side-by-side in the Explorer view (e.g., via a `TreeView`) so users can see the full picture of their tasks at a glance.

## Core Capabilities
- Add, edit, complete, remove, and bulk-clear todos within either scope via commands (`todo.addTodo`, `todo.editTodo`, `todo.completeTodo`, `todo.removeTodo`, `todo.clearTodos`).
- Provide drag-and-drop reordering inside each scope; default ordering falls back to the creation ID when no manual ordering is set. Persist ordering by storing a `position` field per todo that updates whenever an item is dragged.
- Persist todos automatically using the storage that VS Code exposes through `ExtensionContext` (`globalState` for profile data, `workspaceState` for project data). Each todo carries a hidden ID and completion state.
- Offer a custom TreeView inside the Explorer, displaying two collapsible parents (“Global” and “Projects”). For multi-root workspaces, show a collapsible todo section per workspace folder under “Projects” and merge the global section once.
- Keep the TreeView in sync with storage so changes are reflected immediately when switching workspaces or profiles mid-session.
- Confirm destructive actions (e.g., clearing all todos) with a layered approach: only prompt when more than one item will be affected, surface a warning dialog, respect the `todo.confirmDestructiveActions` setting (default `true`), and follow up with a post-action toast containing an “Undo” action that restores the previous state for a short window. Pair the confirmation with subtle TreeView animations (fade/removal cues) so feedback is visible even without dialogs.

## Experience Principles
- **Zero setup** — the extension should work out of the box once installed; no external services or manual configuration.
- **Stay in flow** — todo capture must be frictionless (simple input boxes, keyboard friendly commands).
- **Keep context visible** — it should be obvious whether an item lives in the global list or the project list.
- **Profile aware** — switching VS Code profiles should automatically switch the global todo set with no additional work.
- **Respect language preferences** — provide English and German localizations, with graceful fallback behavior.

## Rough Implementation Direction
1. Scaffold the project with `yo code` (TypeScript template).
2. Implement a `TodoRepository` abstraction that wraps `globalState`/`workspaceState`.
3. Build a `TreeDataProvider` with two collapsible root nodes (“Global” and “Projects”), rendering each workspace folder as a child under “Projects.”
4. Wire extension commands to mutate the repository, confirm destructive actions (e.g., clearing todos), and refresh the tree.
5. Add localization (EN/DE) via `@vscode/l10n`, persistence tests, and validation around data migration/versioning.

- `Ctrl+Alt+T` / `Cmd+Alt+T`: `todo.addTodo`.
- `Ctrl+Alt+E` / `Cmd+Alt+E`: `todo.editTodo`.
- `Ctrl+Alt+Enter` / `Cmd+Alt+Enter`: `todo.completeTodo`.
- `Ctrl+Alt+Backspace` / `Cmd+Alt+Backspace`: `todo.removeTodo`.
- `Ctrl+Alt+Shift+Backspace` / `Cmd+Alt+Shift+Backspace`: `todo.clearTodos`.
Each shortcut uses `Ctrl/Cmd + Alt` as a base chord, which is relatively underused in default VS Code mappings. All actions remain accessible via the command palette and context menus for users who override shortcuts.

## Linting & Formatting Rules (pre-scaffold decisions)
- TypeScript + ESLint + Prettier.
- ESLint config: extend `@typescript-eslint/recommended`, enforce strict typing (`no-explicit-any`, `explicit-module-boundary-types`), prefer `const`, and require consistent return statements.
- Prettier settings: 2-space indentation, semicolons, single quotes, trailing commas set to `es5`, 100-character print width.
- Add lint scripts to `package.json` (`npm run lint` → `eslint src --max-warnings=0`) and format scripts (`npm run format` → `prettier --write "src/**/*.ts"`).

## Testing Strategy
- Unit-test the repository layer with mocked `ExtensionContext` objects to ensure global/workspace state round-trips IDs, positions, and schema migrations correctly.
- Exercise drag-and-drop ordering logic by simulating reorder operations and confirming `position` fields reflow as expected (including fallback-to-ID behavior).
- Use the VS Code extension test harness to invoke commands (`todo.addTodo`, `todo.editTodo`, etc.) and assert TreeDataProvider output/state.
- Verify confirmation and undo flows by stubbing user responses, ensuring multi-item clears prompt, respect the `todo.confirmDestructiveActions` setting, and restore state when undo is pressed.
- Smoke-test localization (EN/DE) by loading each locale and verifying key strings render, especially TreeView labels and command titles.
- Cover multi-root workspaces by opening multiple folders in integration tests to confirm project scopes remain isolated while global todos persist across folders.

## Known Non-Goals (for now)
- Syncing beyond the user’s VS Code profile (e.g., cloud sync).
- Rich task metadata (due dates, tags, priorities) beyond a simple title + completion state.
- Automatic parsing of TODO comments from source files.
