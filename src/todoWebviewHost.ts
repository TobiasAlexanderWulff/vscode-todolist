import * as vscode from 'vscode';

export type ProviderMode = 'global' | 'projects';

export type WebviewScope =
	| { scope: 'global' }
	| { scope: 'workspace'; workspaceFolder: string };

export type OutboundMessage =
	| { type: 'stateUpdate'; payload: unknown }
	| { type: 'startInlineCreate'; scope: WebviewScope }
	| { type: 'startInlineEdit'; scope: WebviewScope; todoId: string };

export type InboundMessage =
	| { type: 'webviewReady'; mode: ProviderMode }
	| { type: 'commitCreate'; scope: WebviewScope; title: string }
	| { type: 'commitEdit'; scope: WebviewScope; todoId: string; title: string }
	| { type: 'toggleComplete'; scope: WebviewScope; todoId: string }
	| { type: 'removeTodo'; scope: WebviewScope; todoId: string }
	| { type: 'reorderTodos'; scope: WebviewScope; order: string[] }
	| { type: 'clearScope'; scope: WebviewScope };

export interface WebviewMessageEvent {
	mode: ProviderMode;
	message: InboundMessage;
}

export class TodoWebviewHost implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly providers = new Map<ProviderMode, TodoWebviewProvider>();
	private readonly onDidReceiveMessageEmitter = new vscode.EventEmitter<WebviewMessageEvent>();

	readonly onDidReceiveMessage = this.onDidReceiveMessageEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {
		const providerConfigs: Array<{ id: ProviderMode; viewId: string }> = [
			{ id: 'global', viewId: 'todoGlobalView' },
			{ id: 'projects', viewId: 'todoProjectsView' },
		];
		providerConfigs.forEach((config) => {
			const provider = new TodoWebviewProvider(
				context.extensionUri,
				config.viewId,
				config.id,
				(message) => this.handleMessage(config.id, message)
			);
			this.providers.set(config.id, provider);
			this.disposables.push(
				vscode.window.registerWebviewViewProvider(config.viewId, provider, {
					webviewOptions: { retainContextWhenHidden: true },
				})
			);
		});
	}

	dispose(): void {
		this.providers.forEach((provider) => provider.dispose());
		this.disposables.forEach((disposable) => disposable.dispose());
		this.onDidReceiveMessageEmitter.dispose();
	}

	postMessage(mode: ProviderMode, message: OutboundMessage): void {
		this.providers.get(mode)?.postMessage(message);
	}

	broadcast(message: OutboundMessage): void {
		this.providers.forEach((provider) => provider.postMessage(message));
	}

	private handleMessage(mode: ProviderMode, message: InboundMessage): void {
		if (message.type === 'webviewReady') {
			this.providers.get(mode)?.markReady();
		}
		this.onDidReceiveMessageEmitter.fire({ mode, message });
	}
}

class TodoWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private webviewView: vscode.WebviewView | undefined;
	private ready = false;

	constructor(
		private readonly extensionUri: vscode.Uri,
		readonly viewId: string,
		private readonly mode: ProviderMode,
		private readonly onMessage: (message: InboundMessage) => void
	) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.webviewView = webviewView;
		this.ready = false;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};
		webviewView.webview.onDidReceiveMessage((message: unknown) =>
			this.onMessage(message as InboundMessage)
		);
		webviewView.webview.html = this.buildHtml(webviewView.webview);
	}

	postMessage(message: OutboundMessage): void {
		if (!this.webviewView || !this.ready) {
			return;
		}
		this.webviewView.webview.postMessage(message);
	}

	markReady(): void {
		this.ready = true;
	}

	dispose(): void {
		this.webviewView = undefined;
		this.ready = false;
	}

	private buildHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const csp = [
			"default-src 'none';",
			`img-src ${webview.cspSource} https:;`,
			`style-src 'unsafe-inline' ${webview.cspSource};`,
			`script-src 'nonce-${nonce}';`,
		].join(' ');
		return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="${csp}" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>TODOs</title>
	</head>
	<body>
		<main id="root" data-mode="${this.mode}">
			<p>TODO webview placeholder (${this.mode}).</p>
		</main>
		<script nonce="${nonce}">
			(function () {
				const vscode = acquireVsCodeApi();
				vscode.postMessage({ type: 'webviewReady', mode: '${this.mode}' });
			})();
		</script>
	</body>
</html>`;
	}
}

function getNonce(): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i += 1) {
		const randomIndex = Math.floor(Math.random() * characters.length);
		nonce += characters.charAt(randomIndex);
	}
	return nonce;
}
