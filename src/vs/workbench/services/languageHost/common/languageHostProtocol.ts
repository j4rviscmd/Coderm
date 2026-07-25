/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: Language Host wire protocol (Phase 1: request-id multiplexer).
// Frame format: [4 bytes LE request_id][4 bytes LE length][payload].
// The Rust host echoes the request_id on responses so concurrent requests can be demuxed.
//   request_id == 0 → notification (fire-and-forget, no response). Used for document sync.
//   request_id  > 0 → request (response awaited). Used for language features.
// FlatBuffers is intentionally NOT used yet: VS Code 1.122's renderer does not support static
// npm imports, so FlatBuffers will be introduced later on the main-process side.
// rpcProtocol.ts (JSON+VSBuffer) remains untouched.

const FRAME_HEADER_BYTES = 8; // request_id (4) + length (4)
const NOTIFY_REQUEST_ID = 0; // reserved id for notifications (no response)
const REQUEST_TIMEOUT_MS = 30000; // 30s for language feature requests

interface PendingRequest {
	resolve: (data: Uint8Array) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

// Phase 1: request-id multiplexer. Multiple concurrent requests are supported.
// Each request has a unique ID, and responses are routed by matching the ID.
export class LanguageHostProtocol {

	private nextRequestId = 1;
	private pending = new Map<number, PendingRequest>();

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
		const requestId = view.getUint32(0, true);
		const length = view.getUint32(4, true);
		if (bytes.byteLength < FRAME_HEADER_BYTES + length) {
			return; // incomplete frame
		}

		// Notifications (request_id == 0) carry no response; ignore any inbound frame with
		// that id rather than logging it as an unknown request.
		if (requestId === NOTIFY_REQUEST_ID) {
			return;
		}

		const payload = bytes.slice(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length);
		const pending = this.pending.get(requestId);
		if (pending) {
			this.pending.delete(requestId);
			clearTimeout(pending.timer);
			pending.resolve(payload);
		} else {
			// Note: this is expected (not a protocol error) when a response lands after its
			// request already timed out and the timer above cleared the pending entry.
			console.warn(`[LanguageHostProtocol] received response for unknown request_id ${requestId}`);
		}
	}

	// Fire-and-forget: reqId=0, no response expected.
	notify(payload: Uint8Array): void {
		this.port.postMessage(this.frame(NOTIFY_REQUEST_ID, payload));
	}

	// Request/response: unique reqId, response awaited (or timeout).
	request(payload: Uint8Array): Promise<Uint8Array> {
		const requestId = this.nextRequestId++;
		this.port.postMessage(this.frame(requestId, payload));

		return new Promise<Uint8Array>((resolve, reject) => {
			const timer = setTimeout(() => {
				const pending = this.pending.get(requestId);
				if (pending) {
					this.pending.delete(requestId);
					reject(new Error(`Language Host request ${requestId} timed out after ${REQUEST_TIMEOUT_MS}ms`));
				}
			}, REQUEST_TIMEOUT_MS);

			this.pending.set(requestId, { resolve, reject, timer });
		});
	}

	private frame(requestId: number, payload: Uint8Array): Uint8Array {
		// Frame: [4 bytes LE request_id][4 bytes LE length][payload]
		const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
		const view = new DataView(frame.buffer);
		view.setUint32(0, requestId, true);
		view.setUint32(4, payload.byteLength, true);
		frame.set(payload, FRAME_HEADER_BYTES);

		// Send the frame as a structured-clone copy (no transfer). Electron's renderer
		// -> main MessagePort does not honor ArrayBuffer/typed-array transfer for the
		// message payload (the main side receives { data: null }), so we copy.
		return frame;
	}
}

// --- Coderm end ---
