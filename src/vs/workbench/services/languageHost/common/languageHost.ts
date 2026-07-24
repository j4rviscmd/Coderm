/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: Language Host service (renderer side). Phase 0 exposes an echo probe to validate
// the wire path (renderer -> main relay -> Rust). Phase 1+ adds document sync and language
// feature dispatch on the same MessagePort acquired at startup.

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ILanguageHostService = createDecorator<ILanguageHostService>('languageHostService');

export interface ILanguageHostService {
	readonly _serviceBrand: undefined;

	/**
	 * Resolves once the MessagePort to the native Language Host is established and the
	 * first handshake exchange has completed.
	 */
	whenReady(): Promise<void>;

	/**
	 * Phase 0 echo probe: sends `payload` to the native host and returns the echoed bytes.
	 * Throws if the host is not ready or the request times out / errors.
	 */
	echo(payload: Uint8Array): Promise<Uint8Array>;
}

// --- Coderm end ---
