/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Configuration key that controls whether terminal editor tabs appear in
 * Quick Open (Ctrl+P) history. When `false` (default), terminal instances
 * opened as editor tabs are excluded from the recently opened files list.
 */
export const CodermQuickOpenIncludeTerminalsSetting = 'coderm.quickOpen.includeTerminals';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.quickOpenIncludeTerminals',
	order: 103,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermQuickOpenIncludeTerminalsSetting]: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.quickOpen.includeTerminals',
				'Controls whether terminal editor tabs are included in Quick Open (Ctrl+P) history. When disabled (default), terminal instances opened as editor tabs will not appear in the recently opened files list.'),
		},
	},
});
