/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Configuration key for preventing new editor group creation on focus.
 *
 * When enabled (default), focusing a non-existent group index (e.g., pressing
 * Cmd+3 when only 2 groups exist) does nothing instead of creating a new group.
 */
export const CodermPreventNewGroupOnFocusSetting = 'coderm.workbench.editor.preventNewGroupOnFocus';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.preventNewGroupOnFocus',
	order: 102,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermPreventNewGroupOnFocusSetting]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.workbench.editor.preventNewGroupOnFocus',
				'Controls whether focusing a non-existent editor group index is suppressed instead of creating a new empty group. When enabled, pressing Cmd+2 through Cmd+8 on a non-existent group does nothing.'),
		},
	},
});
