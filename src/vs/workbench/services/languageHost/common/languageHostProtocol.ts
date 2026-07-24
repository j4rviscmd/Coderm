/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: Language Host wire protocol (Phase 0: simple length-prefixed echo).
// Frame format: [4 bytes LE length][raw payload]. The Rust host echoes the payload back.
// FlatBuffers is intentionally NOT used yet: VS Code 1.122's renderer does not support static
// npm imports, so FlatBuffers will be introduced in Phase 1 on the main-process side.
// rpcProtocol.ts (JSON+VSBuffer) remains untouched.

const FRAME_HEADER_BYTES = 4;
const REQUEST_TIMEOUT_MS = 5000;

interface PendingRequest {
	resolve: (data: Uint8Array) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

// Constraint: only one in-flight request at a time (no multiplexing). `pending`
// holds exactly one request; a second `request()` before the first resolves will
// overwrite it and can misroute the response. Phase 0 only issues the single echo
// self-test, so this is safe here. Phase 1 must replace this with a request-id
// multiplexer once multiple request types are needed.
export class LanguageHostProtocol {

	private pending: PendingRequest | undefined;

	constructor(private readonly port: MessagePort) {
		port.onmessage = (e: MessageEvent) => this.onMessage(e.data);
		port.start();
	}

	private onMessage(data: unknown): void {
		const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data as Uint8Array;
		if (bytes.byteLength < FRAME_HEADER_BYTES) {
			return;
		}
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const length = view.getUint32(0, true);
		if (bytes.byteLength < FRAME_HEADER_BYTES + length) {
			return; // incomplete frame
		}

		const payload = bytes.slice(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length);
		const pending = this.pending;
		if (pending) {
			this.pending = undefined;
			clearTimeout(pending.timer);
			pending.resolve(payload);
		}
	}

	request(payload: Uint8Array): Promise<Uint8Array> {
		// Frame: [4 bytes LE length][payload]
		const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
		new DataView(frame.buffer).setUint32(0, payload.byteLength, true);
		frame.set(payload, FRAME_HEADER_BYTES);

		return new Promise<Uint8Array>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending) {
					this.pending = undefined;
					reject(new Error(`Language Host request timed out after ${REQUEST_TIMEOUT_MS}ms`));
				}
			}, REQUEST_TIMEOUT_MS);

			this.pending = { resolve, reject, timer };

			// Send the frame as a structured-clone copy (no transfer). Electron's renderer
			// -> main MessagePort does not honor ArrayBuffer/typed-array transfer for the
			// message payload (the main side receives { data: null }), so we copy. This is
			// fine for Phase 0's small frames; revisit zero-copy via VSBuffer-style wrapping
			// (as rpcProtocol does) once payloads grow in Phase 3+.
			this.port.postMessage(frame);
		});
	}
}

// --- Coderm end ---
