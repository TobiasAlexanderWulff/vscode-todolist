import { ScopeTarget, TodoTarget } from '../types/scope';
import { ProviderMode, WebviewScope } from '../todoWebviewHost';

/**
 * Converts a scope or todo target into the webview-facing scope descriptor.
 *
 * @param scope - Scope or todo target to convert.
 * @returns Webview scope when resolvable; otherwise undefined.
 */
export function scopeTargetToWebviewScope(
	scope: ScopeTarget | TodoTarget
): WebviewScope | undefined {
	if (scope.scope === 'global') {
		return { scope: 'global' };
	}
	if (!scope.workspaceFolder) {
		return undefined;
	}
	return { scope: 'workspace', workspaceFolder: scope.workspaceFolder };
}

/**
 * Maps a scope target to the corresponding webview provider mode.
 *
 * @param scope - Scope target to map.
 * @returns Provider identifier used by the webview host.
 */
export function scopeToProviderMode(scope: ScopeTarget): ProviderMode {
	return scope.scope === 'global' ? 'global' : 'projects';
}