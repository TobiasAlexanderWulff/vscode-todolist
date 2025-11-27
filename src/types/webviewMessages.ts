import { ProviderMode, WebviewScope } from '../todoWebviewHost';

export type { WebviewScope };

/** Message informing the webview about the latest serialized state. */
export type StateUpdateMessage = { type: 'stateUpdate'; payload: unknown };
/** Message prompting the webview to start inline creation for a scope. */
export type StartInlineCreateMessage = { type: 'startInlineCreate'; scope: WebviewScope };
/** Message prompting the webview to enter inline edit mode for a todo. */
export type StartInlineEditMessage = { type: 'startInlineEdit'; scope: WebviewScope; todoId: string };
/** Message indicating an auto-delete fade should be shown for a todo. */
export type AutoDeleteCueMessage = {
	type: 'autoDeleteCue';
	scope: WebviewScope;
	todoId: string;
	durationMs: number;
};

/** Union of messages sent from the extension to the webview runtime. */
export type OutboundMessage =
	| StateUpdateMessage
	| StartInlineCreateMessage
	| StartInlineEditMessage
	| AutoDeleteCueMessage;

/** Message sent when the webview initializes so the host can flush pending messages. */
export type WebviewReadyMessage = { type: 'webviewReady'; mode: ProviderMode };
/** Message requesting creation of a todo from inline input. */
export type CommitCreateMessage = { type: 'commitCreate'; scope: WebviewScope; title: string };
/** Message requesting an inline todo edit be saved. */
export type CommitEditMessage = {
	type: 'commitEdit';
	scope: WebviewScope;
	todoId: string;
	title: string;
};
/** Message toggling completion state of a todo. */
export type ToggleCompleteMessage = { type: 'toggleComplete'; scope: WebviewScope; todoId: string };
/** Message requesting a todo title be copied to the clipboard. */
export type CopyTodoMessage = { type: 'copyTodo'; scope: WebviewScope; todoId: string };
/** Message requesting a todo be removed from a scope. */
export type RemoveTodoMessage = { type: 'removeTodo'; scope: WebviewScope; todoId: string };
/** Message communicating a drag-and-drop reordering. */
export type ReorderTodosMessage = { type: 'reorderTodos'; scope: WebviewScope; order: string[] };
/** Message requesting a full clear of todos in a scope. */
export type ClearScopeMessage = { type: 'clearScope'; scope: WebviewScope };

/** Union of messages sent from the webview runtime to the extension. */
export type InboundMessage =
	| WebviewReadyMessage
	| CommitCreateMessage
	| CommitEditMessage
	| ToggleCompleteMessage
	| CopyTodoMessage
	| RemoveTodoMessage
	| ReorderTodosMessage
	| ClearScopeMessage;

/** Envelope fired by the webview host when messages arrive from a specific provider. */
export type WebviewMessageEvent = { mode: ProviderMode; message: InboundMessage };
