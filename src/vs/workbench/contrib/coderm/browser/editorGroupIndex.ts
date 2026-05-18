/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Configuration key for the editor group index display setting.
 *
 * When enabled and multiple editor groups are open, each group's tab bar
 * shows a `[N]` index badge (1-based) to help identify groups for
 * tmux-like `<prefix>n` style navigation.
 */
export const CodermEditorGroupIndexSetting = 'coderm.workbench.editor.editorGroupIndexInTab';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.editorGroupIndex',
	order: 102,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermEditorGroupIndexSetting]: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.workbench.editor.editorGroupIndexInTab',
				'Controls whether each editor group displays an index badge in its tab bar (e.g. [1], [2]). Only visible when multiple groups are open.'),
		},
	},
});
