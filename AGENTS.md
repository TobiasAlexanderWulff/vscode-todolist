# AGENTS

Guidance for anyone (human or automated) collaborating on this repository. Follow the responsibilities below to keep the project healthy and aligned with the shared product vision in `docs/vision.md`.

## Agent Roles

### 1. Vision & Scope Agent
- Source of truth: `docs/vision.md`.
- Keep the dual-scope todo workflow intact (global/profile vs. per-project) and ensure any new feature proposals respect the principles listed there.
- Maintain the command surface (`todo.addTodo`, `todo.editTodo`, `todo.completeTodo`, `todo.removeTodo`, `todo.clearTodos`) and the custom Explorer TreeView layout (Global + Projects with workspace-folder nodes).
- Confirm UX decisions stay consistent: drag-and-drop ordering via `position`, layered confirmations with undo toasts, EN/DE localization, and responsive multi-root behavior.

### 2. Builder Agent
- Implement extension code in `src/` using TypeScript and the VS Code API. Prefer small, composable modules (e.g., repository, tree provider, command handlers).
- Keep code lint-clean and formatted: run `npm run lint` (ESLint with `@typescript-eslint/recommended`) and match Prettier defaults (2 spaces, single quotes, 100-char width, semicolons).
- Bundle with `esbuild` via the provided scripts (`npm run compile`, `npm run package`, `npm run watch`).
- When introducing destructive actions, hook into the confirmation flow defined in the vision (settings-aware prompts, undo toasts, subtle TreeView animations).

### 3. QA & Test Agent
- Use `npm run test` (VS Code test harness) plus unit tests under `src/test` to cover repository logic, command behaviors, localization, and multi-root scenarios as described in the testing strategy.
- Add focused tests for drag-and-drop ordering (ensuring `position` updates) and confirmation/undo flows by stubbing user interactions.
- For regression verification, run `npm run compile` to ensure type checking + linting pass before executing the test suite.

### 4. Documentation & Release Agent
- Update `README.md`, `CHANGELOG.md`, and `docs/vision.md` when behavior or scope changes.
- Provide screenshots or animations for the TreeView when features stabilize.
- Keep `.vscode/` and `.vscodeignore` aligned with the development workflow (launch configs, tasks, packaging ignore rules).
- Prepare marketplace releases by running `npm run package` and documenting notable changes in the changelog.

## Shared Workflows
- Install dependencies: `npm install`.
- Type-check only: `npm run check-types`.
- Continuous development: `npm run watch` (esbuild + tsc) and `npm run watch-tests` when iterating on specs.
- Testing order before PR or release: `npm run compile` → `npm run test`.
- Do not amend existing commits; add new commits instead unless the user explicitly instructs otherwise.
- After finishing a task that changes the codebase, propose a suitable conventional commit message and commit the changes.
- When adding a whole new feature or fundamentally changing an existing one, consider creating a new branch for those changes.

## Contribution Checklist
1. Read `docs/vision.md` and confirm the change supports the vision.
2. Implement feature/fix under `src/`, keeping commands and TreeView logic cohesive.
3. Update or add tests in `src/test`.
4. Run `npm run lint`, `npm run check-types`, `npm run test`.
5. Refresh docs/changelog if user-facing behavior shifts.

Staying aligned with these role descriptions ensures future agents can pick up the work quickly and continue building the VS Code TODO experience without re-litigating decisions already captured in the vision.
