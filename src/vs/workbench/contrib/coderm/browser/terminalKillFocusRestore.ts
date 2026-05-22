/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { TerminalEditorInput } from '../../terminal/browser/terminalEditorInput.js';

// #region Configuration

/**
 * Configuration key for the terminal-kill focus restore feature.
 *
 * When enabled (default), killing a terminal-in-editor (e.g. via ctrl+d)
 * automatically closes the resulting empty editor group and restores focus
 * to the remaining pane. This provides tmux-like pane behavior where
 * closing a terminal pane always focuses the adjacent pane.
 *
 * This works independently of the general `workbench.editor.closeEmptyGroups`
 * setting — terminal kills always close the empty pane.
 */
export const CodermTerminalKillFocusRestoreSetting = 'coderm.terminal.closeEmptyPaneOnKill';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.terminalKillFocusRestore',
	order: 103,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermTerminalKillFocusRestoreSetting]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.terminal.closeEmptyPaneOnKill',
				'Controls whether an empty editor group is automatically closed and focus is restored to the remaining pane when a terminal-in-editor is killed (e.g. via ctrl+d). This provides tmux-like pane behavior independent of the closeEmptyGroups setting.'),
		},
	},
});

// #endregion

// #region Controller

/**
 * Workbench contribution that restores focus to the remaining pane when a
 * terminal-in-editor is killed and the editor group becomes empty.
 *
 * Without this, the default behavior depends on `workbench.editor.closeEmptyGroups`:
 * - `true`: group closes and focus moves to the most recently active group (works)
 * - `false`: group stays empty and focus remains in the empty group (broken UX)
 *
 * This contribution ensures that for terminal kills, the empty pane is always
 * closed regardless of the general setting.
 */
export class TerminalKillFocusRestoreController extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.coderm.terminalKillFocusRestore';

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();

		this._register(this._editorService.onDidCloseEditor(e => {
			if (!this._isEnabled()) {
				return;
			}

			// Only handle terminal editor inputs
			if (!(e.editor instanceof TerminalEditorInput)) {
				return;
			}

			const group = this._editorGroupsService.getGroup(e.groupId);
			if (!group) {
				return;
			}

			// If the group is now empty and there are other groups, remove it
			if (group.isEmpty && this._editorGroupsService.count > 1) {
				this._editorGroupsService.removeGroup(group);
			}
		}));
	}

	private _isEnabled(): boolean {
		return this._configurationService.getValue<boolean>(CodermTerminalKillFocusRestoreSetting) ?? true;
	}
}

// #endregion

// #region Registration

registerWorkbenchContribution2(
	TerminalKillFocusRestoreController.ID,
	TerminalKillFocusRestoreController,
	WorkbenchPhase.AfterRestored
);

// #endregion
