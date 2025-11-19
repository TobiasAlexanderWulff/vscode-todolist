# vscode-todo

`vscode-todo` keeps the tasks that live in your head next to the files you are editing. The extension tracks two scopes in one Explorer tree:

- **Global / profile-bound:** todos that follow your active VS Code profile across every workspace.
- **Project / workspace-bound:** todos that live alongside a specific workspace folder inside multi-root setups.

The project vision, keyboard shortcuts, and UX principles live in [`docs/vision.md`](docs/vision.md). The high-level implementation roadmap is in [`docs/implementation-plan.md`](docs/implementation-plan.md).

## Current status

Phase 1 lays the groundwork:

- All commands (`todo.addTodo`, `todo.editTodo`, `todo.completeTodo`, `todo.removeTodo`, `todo.clearTodos`) are registered and localized (English + German). They currently show “coming soon” messages while the repository and TreeView are under construction.
- Localization uses `@vscode/l10n` with JSON bundles stored under `/l10n`.
- A `TodoRepository` manages profile (global) and workspace scoped data, including undo snapshots and `position` metadata that will power drag-and-drop ordering.

Stay tuned for Phase 2 when the custom TreeView and rich command flows land.

## Commands & shortcuts

| Command | Title | Default shortcut |
| --- | --- | --- |
| `todo.addTodo` | Add TODO | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd> |
| `todo.editTodo` | Edit TODO | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>E</kbd> |
| `todo.completeTodo` | Complete TODO | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>Enter</kbd> |
| `todo.removeTodo` | Remove TODO | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>Backspace</kbd> |
| `todo.clearTodos` | Clear TODO list | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>Backspace</kbd> |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `todo.confirmDestructiveActions` | `true` | Require confirmation before clearing multiple todos and show an Undo toast afterwards. |

## Development

```bash
npm install
npm run compile
npm run watch        # incremental build while coding
npm run test         # runs the VS Code extension tests
```

The `docs/` folder contains the product vision, implementation plan, and agents guide that explain how to extend this project.
