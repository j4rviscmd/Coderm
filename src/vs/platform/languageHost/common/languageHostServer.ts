/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: Language Host server service (electron-main side). Mirrors IExtensionHostStarter:
// spawns the native (Rust) Language Host binary and relays its stdio to a MessagePort that
// is transferred to the renderer. The renderer acquires the port via acquirePort() after
// calling startLanguageHost().

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const ILanguageHostServerService = createDecorator<ILanguageHostServerService>('languageHostServerService');

export const ipcLanguageHostServerChannelName = 'languageHostServer';

export interface ILanguageHostStartResult {
	readonly id: string;
	readonly pid: number | undefined;
}

export interface ILanguageHostExitEvent {
	readonly id: string;
	readonly code: number;
	readonly signal: string;
}

/**
 * electron-main process service. Owns the Rust Language Host child process(es) and the
 * stdio<->MessagePort byte relay. Kept in platform/ (not services/) because it performs
 * process management from the main process, exactly like IExtensionHostStarter.
 */
export interface ILanguageHostServerService {
	readonly _serviceBrand: undefined;

	readonly onDidExit: Event<ILanguageHostExitEvent>;

	/**
	 * Spawn the Language Host binary for the given window and transfer a MessagePort
	 * (carrying the stdio relay) back to that window's renderer via responseChannel+nonce.
	 */
	startLanguageHost(windowId: number, responseChannel: string, nonce: string): Promise<ILanguageHostStartResult>;

	killLanguageHost(id: string): Promise<void>;
}

// --- Coderm end ---
