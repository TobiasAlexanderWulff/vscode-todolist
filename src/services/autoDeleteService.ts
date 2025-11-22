import * as vscode from 'vscode';

import { readConfig, TodoConfig } from '../adapters/config';
import { ScopeTarget } from '../types/scope';

const DEFAULT_AUTO_DELETE_DELAY_MS = 1_500;
const DEFAULT_AUTO_DELETE_FADE_MS = 750;

/** Handler invoked when an auto-delete timer expires. */
export type AutoDeleteRemovalHandler<TContext> = (
	context: TContext,
	scope: ScopeTarget,
	todoId: string
) => Promise<boolean | void>;

/** Handler used to notify the UI about an impending auto-delete. */
export type AutoDeleteCueHandler = (
	scope: ScopeTarget,
	todoId: string,
	durationMs: number
) => void;

/** Optional handlers invoked during auto-delete scheduling and execution. */
interface AutoDeleteHandlers<TContext> {
	removeTodo?: AutoDeleteRemovalHandler<TContext>;
	sendCue?: AutoDeleteCueHandler;
}

/**
 * Coordinates auto-delete timers for completed todos, dispatching cues and removals.
 *
 * @typeParam TContext - Context object passed back into handlers for repo access.
 */
export class AutoDeleteCoordinator<TContext> implements vscode.Disposable {
	private timers = new Map<string, NodeJS.Timeout>();

	constructor(private readonly handlers: AutoDeleteHandlers<TContext> = {}) {}

	/**
	 * Schedules an auto-delete timer for a todo, replacing existing timers for that todo.
	 *
	 * @param context - Context forwarded to the removal handler.
	 * @param scope - Scope describing where the todo lives.
	 * @param todoId - Identifier of the todo to remove.
	 * @param config - Optional configuration override.
	 */
	schedule(context: TContext, scope: ScopeTarget, todoId: string, config?: TodoConfig): void {
		const configuration = config ?? readConfig();
		const enabled = configuration.autoDeleteCompleted;
		if (!enabled) {
			this.cancel(scope, todoId);
			return;
		}
		const delay = this.sanitizeDelay(configuration.autoDeleteDelayMs, DEFAULT_AUTO_DELETE_DELAY_MS);
		const fadeDuration = this.sanitizeDelay(configuration.autoDeleteFadeMs, DEFAULT_AUTO_DELETE_FADE_MS);
		const key = this.buildKey(scope, todoId);
		this.cancel(scope, todoId);
		const timer = setTimeout(async () => {
			const removalTimer = setTimeout(async () => {
				this.timers.delete(key);
				try {
					await this.handlers.removeTodo?.(context, scope, todoId);
				} catch (error) {
					console.error('Auto-delete failed', error);
				}
			}, fadeDuration);
			this.timers.set(key, removalTimer);
			try {
				this.handlers.sendCue?.(scope, todoId, fadeDuration);
			} catch (error) {
				console.error('Auto-delete fade failed', error);
			}
		}, delay);
		this.timers.set(key, timer);
	}

	/**
	 * Cancels auto-delete timers for a specific todo.
	 *
	 * @param scope - Scope describing where the todo lives.
	 * @param todoId - Identifier of the todo to cancel timers for.
	 */
	cancel(scope: ScopeTarget, todoId: string): void {
		const key = this.buildKey(scope, todoId);
		const timer = this.timers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(key);
		}
	}

	/**
	 * Cancels all timers associated with a scope, typically during bulk clears.
	 *
	 * @param scope - Scope describing the todos.
	 * @param todos - Todos whose timers should be cancelled.
	 */
	cancelScope(scope: ScopeTarget, todos: Array<{ id: string }>): void {
		todos.forEach((todo) => this.cancel(scope, todo.id));
	}

	/** Disposes all timers held by the coordinator. */
	dispose(): void {
		this.timers.forEach((timer) => clearTimeout(timer));
		this.timers.clear();
	}

	private buildKey(scope: ScopeTarget, todoId: string): string {
		return scope.scope === 'global' ? `global:${todoId}` : `${scope.workspaceFolder}:${todoId}`;
	}

	/**
	 * Sanitizes the configured delay to a non-negative numeric value.
	 *
	 * @param value - Delay read from configuration.
	 * @param defaultValue - Fallback delay to use if the value is invalid.
	 */
	private sanitizeDelay(value: number | undefined, defaultValue = DEFAULT_AUTO_DELETE_DELAY_MS): number {
		if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
			return defaultValue;
		}
		return value;
	}
}