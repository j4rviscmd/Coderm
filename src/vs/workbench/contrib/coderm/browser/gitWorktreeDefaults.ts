/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Coderm default: enable `git.detectWorktrees` by default.
 *
 * The upstream default is `false`, which means git worktrees are not
 * automatically opened as separate repositories. Since Coderm users
 * commonly work with worktrees (e.g. via worktree-start skill),
 * detecting them by default provides a better experience and enables
 * gutter diff for worktree files without manual configuration.
 */

import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationDefaults } from '../../../../platform/configuration/common/configurationRegistry.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerDefaultConfigurations([{
		overrides: {
			'git.detectWorktrees': true
		}
	} satisfies IConfigurationDefaults]);
