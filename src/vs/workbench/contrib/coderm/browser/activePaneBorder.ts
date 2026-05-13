/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Active pane border configuration registration for Coderm.
 *
 * Registers the `coderm.activePaneBorder.*` settings that control the
 * tmux-like border highlight drawn around the focused pane. The feature
 * applies to editor groups (when multiple groups are open) and to
 * sidebar / panel / auxiliary bar composites when they receive focus.
 *
 * Settings:
 * - `coderm.activePaneBorder.enabled` — toggle the feature on/off
 * - `coderm.activePaneBorder.color`  — override border color (hex string); falls back to theme's `focusBorder` when empty
 * - `coderm.activePaneBorder.width`  — border thickness in pixels (1-5)
 */

import { localize } from '../../../../nls.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		'id': 'coderm.activePaneBorder',
		'order': 100,
		'title': localize('codermConfigurationTitle', "Coderm"),
		'type': 'object',
		'properties': {
			'coderm.activePaneBorder.enabled': {
				'type': 'boolean',
				'default': true,
				'description': localize('activePaneBorderEnabled', "Controls whether the active pane displays a border highlight (tmux-like). Applies to editor panes when multiple are open, and to sidebar/panel/auxiliary bar when focused.")
			},
			'coderm.activePaneBorder.color': {
				'type': 'string',
				'default': '',
				'description': localize('activePaneBorderColor', "Override color for the active pane border (e.g. '#00FF00'). When empty, the theme's focus border color is used.")
			},
			'coderm.activePaneBorder.width': {
				'type': 'number',
				'default': 1,
				'minimum': 1,
				'maximum': 5,
				'description': localize('activePaneBorderWidth', "Controls the width in pixels of the active pane border.")
			}
		}
	});
