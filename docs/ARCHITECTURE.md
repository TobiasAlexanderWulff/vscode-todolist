# Architecture Overview

This extension is organized into layered modules to keep business rules reusable and VS Code API usage contained at the edges.

## Layers
- **Domain** (`src/domain`): Pure helpers and types for todos (ordering, normalization, shared message contracts). No VS Code API usage.
- **Services** (`src/services`): Stateful utilities that implement behaviors over the domain (repository, undo snapshots, auto-delete scheduling, scope helpers). May use VS Code types but avoid UI calls.
- **Adapters** (`src/adapters`): Boundaries to VS Code APIs — command handlers/router, webview host/router, configuration, and state broadcasting.
- **Webview runtime** (`src/webview`): Client-side code running inside the webviews; communicates via typed messages shared with the extension host.
- **Composition** (`src/extension.ts`): Activation entry that wires localization, services, adapters, and disposables.
- **Config adapter** (`src/adapters/config.ts`): Single place to read `todo.*` settings; other modules receive config rather than reading VS Code directly.

## Dependency Rules
- Domain → nothing.
- Services → Domain.
- Adapters → Services + Domain; VS Code API usage should live here.
- Webview runtime → Domain-shared message types only (no VS Code API).
- No default exports; avoid circular dependencies.

## Testing Guidance
- Unit-test Domain helpers and Services without VS Code mocks where possible.
- Route webview messages through the adapter/router in tests to verify validation and ordering/undo behaviors.
- Keep integration tests focused on command surfaces, multi-root behavior, localization, confirmation/undo, and auto-delete cues.
- For config-sensitive tests, stub the adapter (`stubReadConfig` in `src/test/testUtils`) instead of mutating VS Code configuration.
- Fake webview hosts used in tests can capture `postMessage`/`broadcast` traffic without real VS Code webviews.
