/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: native (desktop) Language Host service for the renderer. Acquires the MessagePort
// that the main process transfers back after spawning the Rust host, then wraps it in the
// wire protocol. Mirrors the EH pattern (acquirePort + service call) from localProcessExtensionHost.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { acquirePort } from '../../../../base/parts/ipc/electron-browser/ipc.mp.js';
import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { ILanguageHostServerService, ipcLanguageHostServerChannelName } from '../../../../platform/languageHost/common/languageHostServer.js';
import { ILanguageHostService } from '../common/languageHost.js';
import { LanguageHostProtocol } from '../common/languageHostProtocol.js';

// Channel name shared with the main process side (see languageHostServerService).
// Constraint: the `coderm:` prefix is required, not cosmetic. The sandboxed preload's
// validateIPC() gate (src/vs/base/parts/sandbox/electron-browser/preload.ts and
// preload-aux.ts) throws on any channel not prefixed `vscode:` or `coderm:`. This channel
// crosses that gate (acquirePort() -> validateIPC(responseChannel)), so a non-`coderm:`
// name would throw at runtime.
const RESPONSE_CHANNEL = 'coderm:languageHost:messagePort';

export class NativeLanguageHostService extends Disposable implements ILanguageHostService {
	declare readonly _serviceBrand: undefined;

	private protocol: LanguageHostProtocol | undefined;
	private _whenReadyPromise: Promise<void> | undefined;

	constructor(
		@ILanguageHostServerService private readonly languageHostServerService: ILanguageHostServerService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		// Lazy: only start when a caller first awaits whenReady(), so the native host
		// process is not spawned unless the coderm.languageHost.enabled opt-in runs.
	}

	whenReady(): Promise<void> {
		if (!this._whenReadyPromise) {
			this._whenReadyPromise = this.start();
		}
		return this._whenReadyPromise;
	}

	private async start(): Promise<void> {
		const nonce = generateUuid();

		// Begin listening for the port the main process will post back on RESPONSE_CHANNEL,
		// then ask main (via the proxied server service) to spawn the Rust host and transfer it.
		const portPromise = acquirePort(undefined, RESPONSE_CHANNEL, nonce);
		const windowId = this.nativeHostService.windowId;
		await this.languageHostServerService.startLanguageHost(windowId, RESPONSE_CHANNEL, nonce);
		const port = await portPromise;

		this.protocol = new LanguageHostProtocol(port);
		this.logService.info('[languageHost] connected to native host');
	}

	async echo(payload: Uint8Array): Promise<Uint8Array> {
		if (!this.protocol) {
			throw new Error('Language Host not ready');
		}
		return this.protocol.request(payload);
	}
}

// Expose the main-process ILanguageHostServerService to the renderer as a remote proxy,
// so the renderer can call startLanguageHost(...) over IPC (same pattern as
// services/extensions/electron-browser/extensionHostStarter.ts).
registerMainProcessRemoteService(ILanguageHostServerService, ipcLanguageHostServerChannelName);

registerSingleton(ILanguageHostService, NativeLanguageHostService, InstantiationType.Delayed);

// --- Coderm end ---
