/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// CODEM: Persist terminal sessions on window reload only.
// Even when terminal.integrated.enablePersistentSessions is disabled, fully restore
// process, cwd, scrollback, and pane layout on reload window. close/quit still discards.
//
// Approach: Subclass TerminalConfigurationService via DI override to wrap
// config.enablePersistentSessions according to reload context, reusing the existing VSCode
// persistence paths (pty host detach/reattach, layout info, editor serializer). The wrapper
// logic is contained in this single file, plus an alignment fix in terminalEditorInput.ts
// to route the existing direct read through config.

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ShutdownReason, ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import type { ITerminalConfiguration } from '../../terminal/common/terminal.js';
import { TerminalConfigurationService } from '../../terminal/browser/terminalConfigurationService.js';
import { ITerminalConfigurationService } from '../../terminal/browser/terminal.js';

// #region Configuration

export const CodermTerminalPersistSessionOnReloadSetting = 'coderm.terminal.persistSessionOnReload';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.terminalPersistSessionOnReload',
	order: 105,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermTerminalPersistSessionOnReloadSetting]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.terminal.persistSessionOnReload',
				'Persist terminal sessions on window reload even when "terminal.integrated.enablePersistentSessions" is disabled. Processes, cwd, scrollback, and pane layout are fully restored on reload only; close/quit behavior follows the upstream setting.'),
		},
	},
});

// #endregion

// #region Wrapper Service

/**
 * Coderm wrapper around {@link TerminalConfigurationService} that forces
 * `enablePersistentSessions` to `true` in reload-relevant contexts, even when
 * the user has set `terminal.integrated.enablePersistentSessions: false`.
 *
 * Behavior matrix (when the coderm setting is enabled AND the user setting is false):
 * - Normal operation / reload startup: force `true` so processes are created
 *   with `shouldPersist=true` (reload detach requires this at process creation
 *   time — `shouldPersist` is baked in readonly) and reconnection is enabled.
 * - Reload shutdown (`reason === RELOAD`): force `true` so processes detach.
 * - Non-reload shutdown (`CLOSE`/`QUIT`/`LOAD`): pass through `false` so
 *   processes are disposed and buffer revival is skipped, matching the user's
 *   `enablePersistentSessions: false` intent.
 *
 * Race-free guarantee: this service IS `ITerminalConfigurationService`, so DI
 * instantiates it before any consumer (e.g. TerminalService). The
 * `onBeforeShutdown` listener here registers before TerminalService's, and
 * `Emitter.fire()` dispatches synchronously, so `_shutdownReason` is set
 * before any consumer reads `config` during shutdown.
 *
 * Registration order: `coderm.contribution.ts` is imported AFTER
 * `terminal.contribution.ts` in `workbench.common.main.ts`, and
 * `ServiceCollection.set()` is last-wins, so this `registerSingleton`
 * replaces the upstream `TerminalConfigurationService` descriptor.
 */
export class CodermTerminalConfigurationService extends TerminalConfigurationService {

	private _shutdownReason: ShutdownReason | undefined;
	private _codermEnabledCached: boolean | undefined;
	private _wrappedConfigBase: Readonly<ITerminalConfiguration> | undefined;
	private _wrappedConfig: Readonly<ITerminalConfiguration> | undefined;

	// Parent's _configurationService is private; inject our own to read the coderm setting.
	constructor(
		@IConfigurationService private readonly _codermConfigurationService: IConfigurationService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super(_codermConfigurationService);

		// Track shutdown reason to gate the override during non-reload shutdown.
		this._register(lifecycleService.onBeforeShutdown(e => {
			this._shutdownReason = e.reason;
		}));

		// Reset if shutdown is vetoed (window stays open).
		this._register(lifecycleService.onShutdownVeto(() => {
			this._shutdownReason = undefined;
		}));

		// Invalidate caches when the coderm setting changes.
		this._register(this._codermConfigurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(CodermTerminalPersistSessionOnReloadSetting)) {
				this._codermEnabledCached = undefined;
				this._wrappedConfigBase = undefined;
			}
		}));
	}

	private _isCodermEnabled(): boolean {
		if (this._codermEnabledCached === undefined) {
			// Note: `?? true` mirrors the registered `default: true` (see configuration registration above) as a
			// defensive fallback for the rare case getValue() returns undefined (e.g. before defaults are loaded).
			this._codermEnabledCached = this._codermConfigurationService.getValue<boolean>(CodermTerminalPersistSessionOnReloadSetting) ?? true;
		}
		return this._codermEnabledCached;
	}

	override get config(): Readonly<ITerminalConfiguration> {
		const base = super.config;
		// No override needed if user already has persistence enabled.
		if (base.enablePersistentSessions) {
			return base;
		}
		// No override if the Coderm feature is disabled.
		if (!this._isCodermEnabled()) {
			return base;
		}
		// During non-reload shutdown, respect the user's setting (false) so that
		// close/quit disposes processes and skips buffer revival.
		if (this._shutdownReason !== undefined && this._shutdownReason !== ShutdownReason.RELOAD) {
			return base;
		}
		// Force enablePersistentSessions: true (normal op, reload shutdown, reload startup).
		if (this._wrappedConfigBase !== base) {
			this._wrappedConfigBase = base;
			this._wrappedConfig = Object.freeze({ ...base, enablePersistentSessions: true });
		}
		return this._wrappedConfig!;
	}
}

// Override the upstream ITerminalConfigurationService registration.
registerSingleton(ITerminalConfigurationService, CodermTerminalConfigurationService, InstantiationType.Delayed);

// #endregion
