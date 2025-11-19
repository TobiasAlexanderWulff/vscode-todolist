export type TodoScope = 'global' | 'workspace';

export type ScopeKey = 'global' | `workspace:${string}`;

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

export interface TodoSnapshot {
	scopeKey: ScopeKey;
	todos: Todo[];
	capturedAt: number;
}
