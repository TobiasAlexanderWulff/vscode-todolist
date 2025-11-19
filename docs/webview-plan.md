# Webview Rewrite Plan

Documenting the agreed direction for replacing the existing TreeView-based UI with WebviewViews that support inline creation/editing of todos.

## Objectives
- Keep the dual-scope workflow (profile/global and workspace/project) visible side by side.
- Remove blocking dialogs when adding/editing todos from the activity-bar views by enabling inline inputs directly in the list.
- Preserve the current repository, commands, localization, and undo-confirmation flows so existing behavior stays familiar.
- Maintain drag-and-drop ordering per scope, now implemented within the custom webview UI.

## Architecture Overview
1. **WebviewView providers**  
   - Replace `TodoTreeDataProvider` with two `WebviewViewProvider`s (one for `todoGlobalView`, one for `todoProjectsView`) so the contributed view IDs stay the same.  
   - Each provider owns its HTML/JS bundle, enforces VS Code CSP, and posts messages to/from the extension.
2. **State source of truth**  
   - `TodoRepository` remains the persistence layer. When the repository changes, both webviews receive a serialized snapshot (`todos`, drag metadata, localized strings).  
   - The extension tracks which scopes are visible so it can lazily initialize or immediately hydrate each webview.
3. **Message contract**  
   - Webviews send commands such as `commitCreate`, `commitEdit`, `toggleComplete`, `reorder`, `remove`, and `clear`.  
   - The extension responds with success/error plus refreshed state. Errors surface via toast/status messages.
4. **Inline UX**  
   - Clicking the view-title “+” button or running `todo.addTodo` posts a `startInlineCreate` message to the matching webview.  
   - The webview inserts a temporary row with a focused `<input>` that captures Enter/Escape. On commit, it posts the title back for persistence.  
   - Inline edit reuses the same flow, triggered from `todo.editTodo`, double-click, or context button in the list.
5. **Ordering & drag/drop**  
   - HTML drag-and-drop (one scope/list at a time) emits the reordered ID list. The extension normalizes `position` fields via the repository before saving.

## UX Flows
- **Add Todo**: resolve scope → post `startInlineCreate` → user types → webview sends `commitCreate` → repository creates todo → broadcast `stateUpdate`.  
- **Edit Todo**: command or UI action sends `startInlineEdit(todoId)` → input opens inline → Enter triggers `commitEdit`.  
- **Complete/Remove**: UI buttons send actions directly; repository mutates then broadcasts state.  
- **Clear Todos**: command initiates existing confirmation + undo snapshot flow; once settled, state is re-emitted to both views.  
- **Multi-root Projects**: the projects webview renders collapsible sections per workspace folder; inline actions respect the folder key embedded in the payload.

## Implementation Tasks
1. Scaffold a reusable `TodoWebviewHost` helper that handles message routing, state serialization, and localization payloads for both views.
2. Build a TypeScript webview client (bundled via `esbuild`) responsible for rendering lists, inline inputs, drag/drop, and messaging via `acquireVsCodeApi`.
3. Update command handlers (`add`, `edit`, `complete`, `remove`, `clear`) to dispatch inline-start events instead of showing `showInputBox`, while keeping destructive confirmations intact.
4. Remove the TreeDataProvider/drag controller, adjust activation to register the two WebviewView providers, and ensure contributed menus/buttons still point to the same commands.
5. Extend tests to cover the new message contracts (unit tests for the host, ordering logic, undo snapshots) and consider integration coverage via the VS Code harness.
6. Refresh docs (`README.md`, `CHANGELOG.md`, `docs/vision.md`) once the new experience is in place, including screenshots when stable.

## Testing & Release Checklist
- `npm run compile` (type-check + lint + bundle) succeeds with the new webview assets.
- `npm run test` includes repository + host unit tests and any integration specs for inline flows.
- Localization bundles (`package.nls*.json`) include any new strings required by the webview UI.
- Before packaging, verify drag/drop, inline entry, undo, and multi-root scenarios manually.
