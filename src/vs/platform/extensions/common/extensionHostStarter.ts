/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IExtensionHostStarter = createDecorator<IExtensionHostStarter>('extensionHostStarter');

export const ipcExtensionHostStarterChannelName = 'extensionHostStarter';
export const extensionHostGraceTimeMs = 6000;

export interface IExtensionHostProcessOptions {
	responseWindowId: number;
	responseChannel: string;
	responseNonce: string;
	env: { [key: string]: string | undefined };
	detached: boolean;
	execArgv: string[] | undefined;
	silent: boolean;
	// --- Coderm start: isolated language EH kind ---
	// When set to 'isolatedExtensionHost' the spawned utility process is named
	// 'isolated-extension-host' (visible in Process Explorer). Optional: the main
	// process falls back to the regular extension-host name when undefined, so the
	// local process extension host is unaffected.
	kind?: 'extensionHost' | 'isolatedExtensionHost';
	// --- Coderm end ---
}

export interface IExtensionHostStarter {
	readonly _serviceBrand: undefined;

	onDynamicStdout(id: string): Event<string>;
	onDynamicStderr(id: string): Event<string>;
	onDynamicMessage(id: string): Event<unknown>;
	onDynamicExit(id: string): Event<{ code: number; signal: string }>;

	createExtensionHost(): Promise<{ id: string }>;
	start(id: string, opts: IExtensionHostProcessOptions): Promise<{ pid: number | undefined }>;
	enableInspectPort(id: string): Promise<boolean>;
	waitForExit(id: string, maxWaitTimeMs: number): Promise<void>;
	kill(id: string): Promise<void>;

}
