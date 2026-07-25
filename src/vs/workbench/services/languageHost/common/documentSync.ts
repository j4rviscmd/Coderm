/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: Document synchronization for the Language Host.
// Watches ITextModel lifecycle/content changes and forwards them to the Rust host as
// notifications (request_id = 0, no response). Phase 1 sends the full text on open AND on
// every change (full-text replace) — the Rust side overwrites its buffer each time. This
// sidesteps an incremental range-merge engine at the cost of re-sending the buffer.

import { ITextModel } from '../../../../editor/common/model.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';

export type DocumentSyncMessage =
	| { type: 'document/open'; uri: string; version: number; languageId: string; text: string }
	| { type: 'document/change'; uri: string; version: number; text: string }
	| { type: 'document/close'; uri: string };

export class DocumentSyncManager {
	private readonly syncedDocuments = new Map<string, ITextModel>();
	private readonly disposables = new Map<string, IDisposable>();

	constructor(
		private readonly sendMessage: (message: DocumentSyncMessage) => void,
		private readonly isLanguageEnabled: (languageId: string) => boolean,
	) { }

	syncDocument(model: ITextModel): void {
		if (!this.isLanguageEnabled(model.getLanguageId())) {
			return; // not a language the host handles
		}

		const uri = model.uri.toString();
		if (this.syncedDocuments.has(uri)) {
			return; // already syncing
		}

		this.sendMessage({
			type: 'document/open',
			uri,
			version: model.getVersionId(),
			languageId: model.getLanguageId(),
			text: model.getValue(),
		});

		// TODO(Phase 2): debounce rapid edits. Phase 1 forwards each change immediately.
		const disposable = model.onDidChangeContent(() => {
			this.sendMessage({
				type: 'document/change',
				uri,
				version: model.getVersionId(),
				text: model.getValue(),
			});
		});

		this.syncedDocuments.set(uri, model);
		this.disposables.set(uri, disposable);
	}

	unsyncDocument(uri: string): void {
		const disposable = this.disposables.get(uri);
		if (disposable) {
			disposable.dispose();
			this.disposables.delete(uri);
		}
		// Only notify close for documents we were actually syncing.
		if (this.syncedDocuments.delete(uri)) {
			this.sendMessage({ type: 'document/close', uri });
		}
	}

	dispose(): void {
		for (const disposable of this.disposables.values()) {
			disposable.dispose();
		}
		this.disposables.clear();
		this.syncedDocuments.clear();
	}
}
