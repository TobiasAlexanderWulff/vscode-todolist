/** Scope reference used by commands and services to resolve the correct repository slice. */
export type ScopeTarget = { scope: 'global' } | { scope: 'workspace'; workspaceFolder: string };

/** Scope-aware todo reference that includes the item identifier. */
export type TodoTarget =
	| { todoId: string; scope: 'global' }
	| { todoId: string; scope: 'workspace'; workspaceFolder: string };