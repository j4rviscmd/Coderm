/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Configuration key for eager extension activation.
 *
 * Extensions listed here will have `*` injected into their activation events,
 * causing them to activate during the eager (startup) phase instead of waiting
 * for their normal activation triggers (e.g. key press, onStartupFinished).
 */
export const CodermEagerExtensionsSetting = 'coderm.extensions.eagerActivation';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.eagerExtensions',
	order: 105,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermEagerExtensionsSetting]: {
			type: 'array',
			items: { type: 'string' },
			default: ['asvetliakov.vscode-neovim', 'vscodevim.vim'],
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.extensions.eagerActivation',
				'List of extension IDs to activate eagerly on startup. Extensions listed here will be activated immediately instead of waiting for their normal activation triggers (e.g. first key press). This is useful for vim/neovim extensions where every millisecond of activation latency matters.'),
		},
	},
});
