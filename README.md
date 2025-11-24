# vscode-todolist

Lightweight todos that live where you work: keep personal tasks alongside project tasks in one Activity Bar home.

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/TobiasWulff.vscode-todolist.png)](https://marketplace.visualstudio.com/items?itemName=TobiasWulff.vscode-todolist) [![GitHub License](https://img.shields.io/github/license/tobiasalexanderwulff/vscode-todolist.png)](https://github.com/tobiasalexanderwulff/vscode-todolist/blob/main/LICENSE)

## Two scopes, one view
- **Global (profile-bound):** follow your VS Code profile everywhere.
- **Projects (workspace-bound):** each workspace gets its own list (multi-root supported).

## What you can do
- Add & edit todos inline - no popups, no friction
- Drag & drop ordering (persisted automatically)
- Quick toggle, delete, and undo
- Keyboard-first workflow (Cmd/Ctrl + Alt shortcuts)
- English & German UI

## Quick start
1) Open the **TODOs** icon in the Activity Bar (the toolbar where your explorer/search/git icons live).
2) In the view header, click the `Add` action (or press `Ctrl/Cmd + Alt + T`) to add your first todo.
3) Try dragging your todo to reorder it, or click the checkbox to mark it as done.

## Commands and shortcuts
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
| `todo.confirmDestructiveActions` | `true` | If enabled, asks before clearing multiple todos and shows an Undo toast. |
| `todo.autoDeleteCompleted` | `true` | Automatically delete completed todos after a short delay. |
| `todo.autoDeleteDelayMs` | `1500` | Delay (in milliseconds) before deleting a completed todo when auto-delete is enabled. |
| `todo.autoDeleteFadeMs` | `750` | Fade-out duration (in milliseconds) before a completed todo is removed automatically. |
