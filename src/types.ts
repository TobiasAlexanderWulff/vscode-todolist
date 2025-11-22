/** Represents the storage scope a todo belongs to. */
export type TodoScope = 'global' | 'workspace';

/** Serialized key used to look up todos within global or workspace mementos. */
export type ScopeKey = 'global' | `workspace:${string}`;

/** Shape persisted for each todo item across scopes. */
export interface Todo {
	id: string;
	title: string;
	completed: boolean;
	scope: TodoScope;
	workspaceFolder?: string;
	position: number;
	createdAt: string;
	updatedAt: string;
}

/** Snapshot used for undo flows and bulk operations. */
export interface TodoSnapshot {
	scopeKey: ScopeKey;
	todos: Todo[];
	capturedAt: number;
}