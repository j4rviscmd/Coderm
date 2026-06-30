/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IEditorGroupsService, GroupsOrder } from '../../../services/editor/common/editorGroupsService.js';

// #region Configuration

// Constraint: APPLICATION scope mirrors every other Coderm setting; these are
// host-level editor group policies, not per-workspace preferences (sibling
// pattern: inactiveOverlay.ts, modalEditorActions.ts).
//
// Note: the policy keys are consumed as plain string literals in upstream core
// files (editorGroupFinder.ts, editorGroupView.ts) rather than imported from
// here. VSCode's layering rules forbid common/services layers from importing
// contrib/*, so we follow the established modalEditorActions captureContent
// pattern (register here, reference by literal there).
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.editorGroupPolicy',
	// Note: order=109 reserves the next stable slot after modalEditorActions (108)
	// so the Settings UI renders this section predictably relative to siblings.
	order: 109,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		'coderm.workbench.editor.separateTerminalEditors': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.workbench.editor.separateTerminalEditors',
				'When enabled, terminal and text editors never share an editor group. Opening an editor via Quick Open, the terminal, or other default open paths routes to an existing same-type group (or a new group if none exists) instead of mixing into a group of the other type. Explicit actions such as drag-and-drop or "Open to the Side" are unaffected.'),
		},
		'coderm.workbench.editor.singleTerminalEditorPerGroup': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.workbench.editor.singleTerminalEditorPerGroup',
				'When enabled, each editor group holds at most one terminal editor. Opening a new terminal routes to an empty group (or creates a new one) instead of adding a tab to an existing terminal group. Text editors are unaffected. Explicit actions such as drag-and-drop are unaffected.'),
		},
		'coderm.workbench.editor.disableGroupLock': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.workbench.editor.disableGroupLock',
				'When enabled, completely disables the editor group lock feature. Groups can never be locked — neither automatically (e.g. terminal editor groups) nor manually via the Toggle/Lock Editor Group Lock commands — and always behave as unlocked.'),
		},
	},
});

// #endregion

// #region Lock disabler contribution

/**
 * Why a contribution is still needed alongside the `lock()` guard in
 * editorGroupView.ts: the model-level `locked` flag can be restored from
 * persisted layout state (editorGroupModel.deserialize) without going through
 * `lock()`. This contribution clears any such residual locks on startup and
 * whenever the setting is toggled, so the "always unlocked" invariant holds.
 */
class CodermEditorGroupLockDisabler extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.coderm.editorGroupLockDisabler';

	constructor(
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		this.unlockAllGroups();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('coderm.workbench.editor.disableGroupLock')) {
				this.unlockAllGroups();
			}
		}));
	}

	private unlockAllGroups(): void {
		if (this.configurationService.getValue<boolean>('coderm.workbench.editor.disableGroupLock') === false) {
			return;
		}

		for (const group of this.editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			if (group.isLocked) {
				group.lock(false);
			}
		}
	}
}

registerWorkbenchContribution2(CodermEditorGroupLockDisabler.ID, CodermEditorGroupLockDisabler, WorkbenchPhase.AfterRestored);

// #endregion
