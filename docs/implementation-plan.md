# Implementation Plan

High-level roadmap for building the VS Code TODO extension. Each phase references the agreements captured in `docs/vision.md` and `AGENTS.md`.

## Phase 1 – Foundation (done)
1. **Clean scaffold**
   - Remove the default `helloWorld` command and placeholder text.
   - Configure localization plumbing (`@vscode/l10n`) and set up EN/DE message bundles.
2. **State & models**
   - Define the `Todo` model (id, title, completed, scope, position, timestamps).
   - Implement `TodoRepository` abstraction that persists via `globalState` (profile) and `workspaceState` (per folder), including undo buffer support.
3. **Settings & configuration**
   - Add `todo.confirmDestructiveActions` and reserve the `todo.*` namespace for additional settings.

## Phase 2 – Webview UI & Commands (done)
1. **Explorer views**
   - Build dual `WebviewView`s (`Global`, `Projects`) with per-folder sections in multi-root workspaces.
   - Support drag-and-drop reordering and persist `position`.
2. **Commands**
   - Implement `todo.addTodo`, `todo.editTodo`, `todo.completeTodo`, `todo.removeTodo`, `todo.clearTodos`.
   - Use inline create/edit in the webview (no modal inputs), localized prompts/messages, and undo-aware clears/removals respecting `todo.confirmDestructiveActions`.

## Phase 3 – Auto-delete (done)
1. **Completed cleanup**
   - Add optional auto-delete for completed todos with configurable delay and fade (`todo.autoDeleteCompleted`, `todo.autoDeleteDelayMs`, `todo.autoDeleteFadeMs`).
   - Surface a fade-out cue and cancel deletion if the item is re-opened.

## Phase 4 – Testing & Quality (in progress)
1. **Unit tests**
   - Cover repository persistence, ordering/normalization, undo buffers, and auto-delete scheduling.
2. **Integration tests**
   - Validate commands, localization switching, multi-root behavior, drag-and-drop ordering, confirmation/undo flows, and webview state sync.
3. **Automation**
   - Add CI (e.g., GitHub Actions) to run `npm run compile` then `npm run test`.

## Phase 5 – Modularization & Rules (planned)
1. **Architecture**
   - Extract command router, webview message router with payload validation, domain helpers (ordering, scope descriptions), and service modules (undo, auto-delete).
   - Introduce boundary/lint rules to keep VS Code API usage at the edges and enforce strict TS/ESLint settings.
2. **Docs**
   - Capture module boundaries and responsibilities in `ARCHITECTURE.md`; keep `docs/vision.md` aligned.

## Phase 6 – Release Prep (ongoing)
1. **Lint/type/test gate**
   - Ensure `npm run compile`, `npm run test`, and `npm run package` succeed consistently.
2. **Marketplace readiness**
   - Finalize icon, categories, keywords, and publish metadata.
   - Produce screenshots/animations referenced in README and CHANGELOG.

## Ongoing
- Keep the roadmap updated as decisions evolve.
- Reference this plan when creating issues or delegating work to agents.
