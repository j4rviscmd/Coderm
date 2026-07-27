/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: Language Host configuration + Phase 1 feature registration. Registers
// coderm.languageHost.* settings (default off so main stays inert) and, when enabled with a
// non-empty language set, registers tree-sitter-backed documentSymbol/foldingRange providers
// and syncs open models to the native host.

import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILanguageHostService } from '../../../services/languageHost/common/languageHost.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { registerLanguageFeatureProviders } from '../../../services/languageHost/common/languageFeatures.js';

export const CodermLanguageHostEnabledSetting = 'coderm.languageHost.enabled';

// --- Coderm start: Phase 6 isolated EH settings ---
export const CodermLanguageHostIsolatedEnabledSetting = 'coderm.languageHost.isolatedEnabled';
// --- Coderm end ---

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.languageHost',
	order: 103,
	title: localize('codermLanguageHostConfigurationTitle', "Language Host"),
	type: 'object',
	properties: {
		[CodermLanguageHostEnabledSetting]: {
			type: 'boolean',
			// Note: default:false intentionally deviates from the project's "new settings
			// default to enabled" convention (project CLAUDE.md, development rules). The host
			// spawns a Rust process and parses every open document of the configured languages;
			// defaulting true would opt every user into that before the feature is proven.
			default: false,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.languageHost.enabled',
				"Enable the native (Rust) Language Host. When enabled, documentSymbol and foldingRange for the configured languages are computed by tree-sitter in a separate native process."),
		},
		'coderm.languageHost.languages': {
			type: 'array',
			default: [],
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.languageHost.languages',
				"Language IDs handled by the native Language Host (e.g. \"typescript\", \"tsx\"). Empty (default) keeps the feature inert."),
			items: { type: 'string' },
		},
		// --- Coderm start: Phase 6 isolated EH settings ---
		[CodermLanguageHostIsolatedEnabledSetting]: {
			// Note: default:false intentionally deviates from the project's "new settings
			// default to enabled" convention (project CLAUDE.md, development rules). This
			// spawns an additional extension host process for the listed extensions; keep
			// it inert until Phase 6 is proven end-to-end.
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.languageHost.isolatedEnabled',
				"(experimental, Phase 6) Run the extensions listed in isolatedExtensions inside a dedicated extension host process, isolated from the main local process extension host."),
		},
		'coderm.languageHost.isolatedExtensions': {
			type: 'array',
			default: [],
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.languageHost.isolatedExtensions',
				"(experimental, Phase 6) Extension IDs to route into the isolated extension host when isolatedEnabled is true (e.g. [\"vscode.typescript-language-features\"])."),
			items: { type: 'string' },
		},
		// --- Coderm end ---
	},
});

class LanguageHostPhase1Contribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.coderm.languageHostPhase1';

	constructor(
		@ILanguageHostService languageHostService: ILanguageHostService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IModelService modelService: IModelService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService,
	) {
		super();

		if (!configurationService.getValue<boolean>(CodermLanguageHostEnabledSetting)) {
			return; // feature off: main stays untouched
		}

		const languages = configurationService.getValue<string[]>('coderm.languageHost.languages') || [];
		if (languages.length === 0) {
			logService.info('[coderm.languageHost] no languages configured, feature inert');
			return;
		}

		languageHostService.whenReady()
			.then(() => {
				logService.info('[coderm.languageHost] starting Phase 1 (documentSymbol + foldingRange via tree-sitter)');

				this._register(registerLanguageFeatureProviders(languageHostService, languages, languageFeaturesService));

				// Sync every currently-open model, then track add/remove so the host buffer
				// matches the renderer for the lifetime of the window.
				for (const model of modelService.getModels()) {
					languageHostService.syncDocument(model);
				}
				this._register(modelService.onModelAdded(model => languageHostService.syncDocument(model)));
				this._register(modelService.onModelRemoved(model => languageHostService.unsyncDocument(model.uri.toString())));

				logService.info(`[coderm.languageHost] active for languages: ${languages.join(', ')}`);
			})
			.catch(err => logService.error('[coderm.languageHost] failed to start', err));
	}
}

registerWorkbenchContribution2(LanguageHostPhase1Contribution.ID, LanguageHostPhase1Contribution, WorkbenchPhase.AfterRestored);

// --- Coderm end ---
