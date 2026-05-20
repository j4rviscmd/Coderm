/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Configuration key that controls the horizontal padding (in pixels) applied
 * to both left and right sides of the integrated terminal. This value replaces
 * the hardcoded 20px gutter via the `--coderm-terminal-hpadding` CSS custom
 * property.
 */
export const CodermTerminalHorizontalPaddingSetting = 'coderm.terminal.horizontalPadding';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.terminalHorizontalPadding',
	order: 104,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermTerminalHorizontalPaddingSetting]: {
			type: 'number',
			default: 20,
			minimum: 0,
			maximum: 100,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.terminal.horizontalPadding',
				'Controls the horizontal padding (in pixels) applied to both left and right sides of the integrated terminal. The default value of 20 matches the standard gutter width.'),
		},
	},
});
