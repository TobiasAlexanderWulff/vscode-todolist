import { ScopeTarget } from '../types/scope';
import { ProviderMode, WebviewScope } from '../todoWebviewHost';

export function scopeTargetToWebviewScope(scope: ScopeTarget): WebviewScope {
	return scope.scope === 'global'
		? { scope: 'global' }
		: { scope: 'workspace', workspaceFolder: scope.workspaceFolder };
}

export function scopeToProviderMode(scope: ScopeTarget): ProviderMode {
	return scope.scope === 'global' ? 'global' : 'projects';
}
