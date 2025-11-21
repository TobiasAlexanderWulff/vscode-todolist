# vscode-todo

Lightweight todos that live where you work: keep personal tasks alongside project tasks in one Activity Bar home.

![Version](https://img.shields.io/badge/version-0.2.0-blue?label=Version) ![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)

## Two scopes, one view
- **Global (profile-bound):** your personal list follows your VS Code profile everywhere.
- **Projects (workspace-bound):** each workspace folder keeps its own todos; multi-root workspaces get one collapsible section per folder.

## What you can do
- Inline add/edit directly inside the Activity Bar view—stay in flow, no modal inputs.
- Drag-and-drop ordering with persisted `position` so your custom sort sticks.
- Toggle completion, remove single items, or clear a list with layered confirmation and an Undo toast.
- Keyboard-friendly commands and defaults (Ctrl/Cmd + Alt chord) always available via the Command Palette.
- English and German localization via `@vscode/l10n`.

## Quick start
1) Open the **TODOs** icon in the Activity Bar.
2) Click the plus in either Global or Projects (or press `Ctrl/Cmd + Alt + T`) to create a todo inline.
3) Drag items to reorder; toggle completion by clicking the checkbox.
4) Clear a list via the trash icon—confirmations respect `todo.confirmDestructiveActions` and offer Undo.

## Commands and shortcuts
| Command | Title | Default shortcut |
| --- | --- | --- |
| `todo.addTodo` | Add TODO | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd> |
| `todo.editTodo` | Edit TODO | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>E</kbd> |
| `todo.completeTodo` | Complete TODO | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>Enter</kbd> |
| `todo.removeTodo` | Remove TODO | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>Backspace</kbd> |
| `todo.clearTodos` | Clear TODO list | <kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>Backspace</kbd> |

## Setting
| Setting | Default | Description |
| --- | --- | --- |
| `todo.confirmDestructiveActions` | `true` | If enabled, asks before clearing multiple todos and shows an Undo toast. |

## Development
```bash
npm install
npm run compile       # type-check + lint + build
npm run watch         # incremental build while coding
npm run test          # VS Code extension tests
```

See `docs/vision.md` for the product principles and `docs/implementation-plan.md` for the roadmap.
