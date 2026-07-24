/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: Language Host configuration + Phase 0 self-test. Registers coderm.languageHost.*
// settings (default off so main stays inert) and runs a single echo round-trip when enabled.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILanguageHostService } from '../../../services/languageHost/common/languageHost.js';

export const CodermLanguageHostEnabledSetting = 'coderm.languageHost.enabled';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.languageHost',
	order: 103,
	title: localize('codermLanguageHostConfigurationTitle', "Language Host"),
	type: 'object',
	properties: {
		[CodermLanguageHostEnabledSetting]: {
			type: 'boolean',
			// Note: default:false intentionally deviates from the project's "new settings
			// default to enabled" convention (project CLAUDE.md, development rules). Phase 0 only
			// validates the wire path; defaulting true would spawn the Rust host for every
			// user before any language feature ships. Revisit once Phase 1 adds a user-facing
			// capability.
			default: false,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.languageHost.enabled',
				"Enable the native (Rust) Language Host. When enabled, language features for the configured languages are offloaded from the Extension Host to a separate native process to reduce memory and CPU usage."),
		},
		'coderm.languageHost.languages': {
			type: 'array',
			default: [],
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.languageHost.languages',
				"Language IDs handled by the native Language Host. Empty (default) keeps the feature inert; Phase 0 only validates the communication path."),
			items: { type: 'string' },
		},
	},
});

class LanguageHostPhase0Contribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.coderm.languageHostPhase0';

	constructor(
		@ILanguageHostService languageHostService: ILanguageHostService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		if (!configurationService.getValue<boolean>(CodermLanguageHostEnabledSetting)) {
			return; // feature off: main stays untouched
		}

		languageHostService.whenReady()
			.then(() => languageHostService.echo(new Uint8Array([1, 2, 3, 4, 5])))
			.then(result => this.logService.info(`[coderm.languageHost] phase 0 echo self-test OK: echoed ${result.byteLength} bytes`))
			.catch(err => this.logService.error('[coderm.languageHost] phase 0 echo self-test FAILED', err));
	}
}

registerWorkbenchContribution2(LanguageHostPhase0Contribution.ID, LanguageHostPhase0Contribution, WorkbenchPhase.AfterRestored);

// --- Coderm end ---
