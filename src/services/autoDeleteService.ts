import * as vscode from 'vscode';

import { readConfig, TodoConfig } from '../adapters/config';
import { ScopeTarget } from '../types/scope';

const DEFAULT_AUTO_DELETE_DELAY_MS = 1_500;
const DEFAULT_AUTO_DELETE_FADE_MS = 750;

export type AutoDeleteRemovalHandler<TContext> = (
	context: TContext,
	scope: ScopeTarget,
	todoId: string
) => Promise<boolean | void>;

export type AutoDeleteCueHandler = (
	scope: ScopeTarget,
	todoId: string,
	durationMs: number
) => void;

interface AutoDeleteHandlers<TContext> {
	removeTodo?: AutoDeleteRemovalHandler<TContext>;
	sendCue?: AutoDeleteCueHandler;
}

export class AutoDeleteCoordinator<TContext> implements vscode.Disposable {
	private timers = new Map<string, NodeJS.Timeout>();

	constructor(private readonly handlers: AutoDeleteHandlers<TContext> = {}) {}

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

	cancel(scope: ScopeTarget, todoId: string): void {
		const key = this.buildKey(scope, todoId);
		const timer = this.timers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(key);
		}
	}

	cancelScope(scope: ScopeTarget, todos: Array<{ id: string }>): void {
		todos.forEach((todo) => this.cancel(scope, todo.id));
	}

	dispose(): void {
		this.timers.forEach((timer) => clearTimeout(timer));
		this.timers.clear();
	}

	private buildKey(scope: ScopeTarget, todoId: string): string {
		return scope.scope === 'global' ? `global:${todoId}` : `${scope.workspaceFolder}:${todoId}`;
	}

	private sanitizeDelay(value: number | undefined, defaultValue = DEFAULT_AUTO_DELETE_DELAY_MS): number {
		if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
			return defaultValue;
		}
		return value;
	}
}
