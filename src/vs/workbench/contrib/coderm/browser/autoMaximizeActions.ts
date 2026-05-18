/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Configuration key for the auto-maximize-on-focus setting.
 *
 * When enabled, a minimized editor group is automatically expanded back to
 * its original proportions when it receives focus. When disabled (default),
 * the group keeps its current (minimized) size even after gaining focus.
 */
export const CodermAutoMaximizeSetting = 'coderm.workbench.editor.autoMaximizeOnFocus';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.autoMaximize',
	order: 101,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermAutoMaximizeSetting]: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.workbench.editor.autoMaximizeOnFocus',
				'Controls whether a minimized editor group is automatically expanded when it receives focus. When disabled, the group stays at its current size.'),
		},
	},
});
