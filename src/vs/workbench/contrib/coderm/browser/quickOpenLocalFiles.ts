/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Configuration key that controls whether local files with absolute paths
 * can be opened via Quick Open when in remote SSH connection.
 */
export const CodermQuickOpenLocalFilesSetting = 'coderm.quickOpen.localFiles';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.quickOpenLocalFiles',
	order: 104,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermQuickOpenLocalFilesSetting]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.quickOpen.localFiles',
				'Controls whether local files with absolute paths (e.g., /Users/... or C:\\...) can be opened via Quick Open (Ctrl+P) when connected via SSH. When enabled, both local file:// and remote vscode-remote:// URIs are shown as candidates.'),
		},
	},
});