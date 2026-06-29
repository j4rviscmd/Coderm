/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';

// #region Configuration

/**
 * Coderm-specific configuration keys controlling the summonable modal editor.
 */
const CodermSettings = {
	/**
	 * When enabled, an open modal editor pane captures editors opened via Quick
	 * Open / terminal / etc. instead of letting upstream close the modal and
	 * redirect them to the main part. The actual redirect is suppressed in
	 * editorGroupFinder.ts; this setting is the on/off switch.
	 */
	CAPTURE_CONTENT: 'coderm.modal.captureContent',
};

// Constraint: APPLICATION scope mirrors every other Coderm setting; whether the
// modal captures incoming editors is a host-level UX choice, not a per-workspace
// preference (sibling pattern: inactiveOverlay.ts).
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.modal',
	// Note: order=108 reserves the next stable slot after inactiveOverlay (107)
	// so the Settings UI renders this section predictably relative to siblings.
	order: 108,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermSettings.CAPTURE_CONTENT]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.modal.captureContent',
				'When a modal editor pane is open, open editors via Quick Open, the terminal, etc. into the modal instead of closing the modal and redirecting to the main editor area. Disable to restore the upstream behavior.'),
		},
	},
});

// #endregion

// #region Actions

/**
 * Summons a centered, empty modal editor pane.
 *
 * Why a dedicated open command: upstream ships no command to summon an EMPTY
 * modal editor pane — its modal commands only operate on an already-open modal
 * via the EditorPartModalContext precondition. createModalEditorPart() opens a
 * single empty, focused group showing the Coderm watermark, which the user can
 * then fill via Quick Open / terminal.new / etc.
 */
class OpenModalEditorAction extends Action2 {
	static readonly ID = 'coderm.workbench.modalEditor.open';

	constructor() {
		super({
			id: OpenModalEditorAction.ID,
			title: localize2('coderm.workbench.modalEditor.open', 'Open Modal Editor'),
			f1: true,
			category: Categories.View,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorGroupsService = accessor.get(IEditorGroupsService);
		// createModalEditorPart() is a singleton: re-invoking it while a modal
		// is already open is a safe no-op that re-focuses the existing one.
		await editorGroupsService.createModalEditorPart();
	}
}

/**
 * Dismisses the open modal editor pane (if any).
 *
 * Unlike the upstream workbench.action.closeModalEditor command, this carries
 * no EditorPartModalContext precondition, so it works even when focus is
 * somewhere outside the modal.
 */
class CloseModalEditorAction extends Action2 {
	static readonly ID = 'coderm.workbench.modalEditor.close';

	constructor() {
		super({
			id: CloseModalEditorAction.ID,
			title: localize2('coderm.workbench.modalEditor.close', 'Close Modal Editor'),
			f1: true,
			category: Categories.View,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorGroupsService = accessor.get(IEditorGroupsService);
		const modalPart = editorGroupsService.activeModalEditorPart;
		if (modalPart) {
			await modalPart.close();
		}
	}
}

registerAction2(OpenModalEditorAction);
registerAction2(CloseModalEditorAction);

// #endregion
