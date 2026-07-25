/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: Language Host service (renderer side). Phase 1 adds document sync (notifications)
// and language feature dispatch (requests) on the same MessagePort acquired at startup.
// The Phase 0 raw echo probe is intentionally removed: the documentSymbol/foldingRange path
// now carries the wire-path validation that echo used to provide.

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextModel } from '../../../../editor/common/model.js';

export const ILanguageHostService = createDecorator<ILanguageHostService>('languageHostService');

export interface ILanguageHostService {
	readonly _serviceBrand: undefined;

	/**
	 * Resolves once the MessagePort to the native Language Host is established.
	 */
	whenReady(): Promise<void>;

	/**
	 * Start syncing a document to the native host. Sends the full text initially, then
	 * full-text replaces on every content edit. No-op for languages outside the configured set.
	 */
	syncDocument(model: ITextModel): void;

	/**
	 * Stop syncing a document (sends document/close).
	 */
	unsyncDocument(uri: string): void;

	/**
	 * Request the document symbol tree for a synced document. Returns the host's JSON string
	 * (a DocumentSymbol[] shape); the caller parses and shapes it.
	 */
	requestDocumentSymbol(uri: string): Promise<string>;

	/**
	 * Request folding ranges for a synced document. Returns the host's JSON string
	 * (a FoldingRange[] shape).
	 */
	requestFoldingRange(uri: string): Promise<string>;
}

// --- Coderm end ---
