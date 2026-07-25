/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: electron-main ILanguageHostServerService implementation. Owns the Rust Language
// Host child process and the stdio<->MessagePort byte relay.
// Wire format on stdio: [4 bytes LE request_id][4 bytes LE length][payload].
// The relay is a transparent 8-byte-frame pass-through: the renderer emits one frame per
// MessagePort message, and each Rust response frame is forwarded whole to the renderer.
// Why a relay (not direct socket): Electron exposes no cross-process shared memory; the
// tsserver Content-Length framing (see typescript-language-features) is a proven pattern.

import { spawn, ChildProcess } from 'child_process';
import { join } from '../../../base/common/path.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { MessageChannelMain } from 'electron';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';
import {
	ILanguageHostExitEvent,
	ILanguageHostServerService,
	ILanguageHostStartResult,
} from '../common/languageHostServer.js';

// Node MessagePort passes the value directly; Electron MessagePortMain may wrap it in a
// MessageEvent { data }. Buffers may coincidentally carry a `data` field, so skip the
// unwrap for typed arrays and ArrayBuffers.
function unwrapPortMessage(e: unknown): unknown {
	if (
		e && typeof e === 'object' &&
		Object.hasOwn(e, 'data') &&
		!(e instanceof Uint8Array) &&
		!(e instanceof ArrayBuffer)
	) {
		return (e as { data: unknown }).data;
	}
	return e;
}

export class LanguageHostServerService extends Disposable implements ILanguageHostServerService {
	declare readonly _serviceBrand: undefined;

	private static readonly _frameHeaderBytes = 8; // request_id (4) + length (4)

	private static _lastId = 0;
	private readonly _hosts = new Map<string, { process: ChildProcess; port: Electron.MessagePortMain }>();

	private readonly _onDidExit = this._register(new Emitter<ILanguageHostExitEvent>());
	readonly onDidExit: Event<ILanguageHostExitEvent> = this._onDidExit.event;

	constructor(
		@IEnvironmentMainService private readonly _environmentMainService: IEnvironmentMainService,
		@IWindowsMainService private readonly _windowsMainService: IWindowsMainService,
		@ILogService private readonly _logService: ILogService,
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
	) {
		super();

		this._register(lifecycleMainService.onWillShutdown(() => {
			for (const [id, entry] of this._hosts) {
				try { entry.process.kill(); } catch { /* process may already be gone */ }
				try { entry.port.close(); } catch { /* ignore */ }
				this._logService.info(`[languageHost:${id}] killed on shutdown`);
			}
			this._hosts.clear();
		}));
	}

	async startLanguageHost(windowId: number, responseChannel: string, nonce: string): Promise<ILanguageHostStartResult> {
		const id = String(++LanguageHostServerService._lastId);
		const codeWindow = this._windowsMainService.getWindowById(windowId);
		const win = codeWindow?.win;
		if (!win) {
			throw new Error(`Cannot start Language Host: unknown window ${windowId}`);
		}

		const binaryPath = this._resolveBinaryPath();
		this._logService.info(`[languageHost:${id}] spawning ${binaryPath}`);

		const childProcess = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

		const { port1, port2 } = new MessageChannelMain();
		this._setupRelay(id, port1, childProcess);

		this._hosts.set(id, { process: childProcess, port: port1 });

		childProcess.on('exit', (code, signal) => {
			this._logService.info(`[languageHost:${id}] exit code=${code} signal=${signal}`);
			this._hosts.delete(id);
			try { port1.close(); } catch { /* ignore */ }
			this._onDidExit.fire({ id, code: code ?? -1, signal: signal ?? '' });
		});

		childProcess.on('error', err => {
			this._logService.error(`[languageHost:${id}] spawn error`, err);
		});

		// Transfer port2 to the owning renderer. The renderer is waiting on
		// acquirePort(responseChannel, nonce) and will receive this port via mainWindow 'message'.
		win.webContents.postMessage(responseChannel, nonce, [port2]);

		return { id, pid: childProcess.pid };
	}

	async killLanguageHost(id: string): Promise<void> {
		const entry = this._hosts.get(id);
		if (!entry) {
			return; // already gone
		}
		try { entry.process.kill(); } catch { /* ignore */ }
	}

	private _setupRelay(id: string, port: Electron.MessagePortMain, childProcess: ChildProcess): void {
		// renderer -> Rust: forward the renderer's 8-byte-header frame ([reqId][length][payload])
		// unchanged. The renderer emits exactly one frame per postMessage and MessagePort
		// preserves message boundaries, so no extra length-prefixing is needed on this leg.
		port.on('message', (e: unknown) => {
			const raw = unwrapPortMessage(e);
			const data: Uint8Array = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw as Uint8Array;
			if (!data || data.byteLength === undefined) {
				this._logService.trace(`[languageHost:${id}] relay: received non-buffer message`, e);
				return;
			}
			this._logService.trace(`[languageHost:${id}] relay: received ${data.byteLength} bytes from renderer`);
			childProcess.stdin?.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
		});
		port.start();

		childProcess.stdin?.on('error', err => this._logService.error(`[languageHost:${id}] stdin error`, err));

		// Rust -> renderer: reassemble [reqId(4)][length(4)][payload] frames from the stdout
		// stream and forward each whole frame. Forwarding the header (not just the payload)
		// lets the renderer's multiplexer read reqId + payload in a single message.
		let readBuffer = Buffer.alloc(0);
		childProcess.stdout?.on('data', (chunk: Buffer) => {
			readBuffer = Buffer.concat([readBuffer, chunk]);
			while (readBuffer.length >= LanguageHostServerService._frameHeaderBytes) {
				const length = readBuffer.readUInt32LE(4); // skip request_id at [0..4]
				if (length === 0 || readBuffer.length < LanguageHostServerService._frameHeaderBytes + length) {
					break; // incomplete frame, wait for more
				}
				const frame = readBuffer.subarray(
					0,
					LanguageHostServerService._frameHeaderBytes + length
				);
				// Copy into a standalone Uint8Array so it survives the next concat/subarray.
				port.postMessage(Uint8Array.from(frame));
				readBuffer = readBuffer.subarray(LanguageHostServerService._frameHeaderBytes + length);
			}
		});

		childProcess.stderr?.on('data', (chunk: Buffer) => {
			this._logService.warn(`[languageHost:${id}] ${chunk.toString().trimEnd()}`);
		});
	}

	private _resolveBinaryPath(): string {
		// TODO(P3): resolve the production-bundled binary under resources/native-servers/.
		// For dev (npm run watch + ./scripts/code.sh) the cargo debug binary lives at <appRoot>/rust/target/debug.
		const binaryName = process.platform === 'win32' ? 'coderm-language-host.exe' : 'coderm-language-host';
		return join(this._environmentMainService.appRoot, 'rust', 'target', 'debug', binaryName);
	}
}

// --- Coderm end ---
