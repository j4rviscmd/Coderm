/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hides the title bar's trailing "More Actions" overflow button (`...`). Driven
 * via a body class + CSS because `WorkbenchToolBar.setActions` repopulates the
 * overflow bucket from `primary` whenever items exceed `maxItems`, so dropping
 * the `secondary` argument from the call site has no effect on the button.
 */

import { mainWindow } from '../../../../base/browser/window.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';

export const CodermHideTitleBarMoreActionsSetting = 'coderm.titleBar.hideMoreActions';

const BODY_CLASS = 'coderm-hide-title-bar-more-actions';

// #region Configuration

// Constraint: APPLICATION scope is intentional because hiding the title bar
// overflow is a host-level visual choice; per-workspace overrides would
// fragment the title bar UX across windows (sibling pattern: cursorAutoHide.ts).
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		id: 'coderm.titleBar',
		// Note: order=106 reserves a stable slot after existing Coderm settings
		// (activePaneBorder=100, cursorAutoHide=101, ...) so the Settings UI
		// renders this section predictably relative to siblings.
		order: 106,
		title: localize('codermConfigurationTitle', "Coderm"),
		type: 'object',
		properties: {
			[CodermHideTitleBarMoreActionsSetting]: {
				type: 'boolean',
				default: true,
				scope: ConfigurationScope.APPLICATION,
				description: localize('coderm.titleBar.hideMoreActions', "Controls whether the trailing \"More Actions\" overflow button (`...`) is hidden in the title bar. When enabled, secondary title bar actions (e.g. items contributed by extensions such as Copilot Chat) are not surfaced via the overflow menu."),
			},
		},
	});

// #endregion

// #region Stylesheet

createStyleSheet(undefined, sheet => {
	// Why: `:has(.codicon-toolbar-more)` targets only the overflow `...` action
	// item, never other title bar actions, because WorkbenchToolBar reuses the
	// generic `.action-item` class for every entry (see file-level JSDoc for
	// why a CSS hook is required instead of removing the action source).
	// Constraint: `!important` is required to win specificity over the host's
	// inline `flex: 1` / `display: flex` rules on `.action-item`.
	sheet.textContent = `
		/* Coderm: hide the "More Actions" overflow button in the title bar's action toolbar. */
		.${BODY_CLASS} .titlebar-right .action-toolbar-container
			.monaco-action-bar .action-item:has(.codicon-toolbar-more) {
			display: none !important;
		}
	`;
});

// #endregion

// #region Controller

class HideTitleBarMoreActionsController extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.coderm.hideTitleBarMoreActions';

	constructor(@IConfigurationService private readonly configurationService: IConfigurationService) {
		super();

		this._store.add(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(CodermHideTitleBarMoreActionsSetting)) {
				this._apply();
			}
		}));

		this._apply();
	}

	private _apply(): void {
		const enabled = this.configurationService.getValue<boolean>(CodermHideTitleBarMoreActionsSetting) ?? true;
		mainWindow.document.body.classList.toggle(BODY_CLASS, enabled);
	}
}

// Why: AfterRestored (not BlockBeforeRestored) so the title bar toolbar DOM is
// present when _apply() runs the first time; earlier phases would race the
// layout restore and the body class could be applied before the toolbar exists.
registerWorkbenchContribution2(HideTitleBarMoreActionsController.ID, HideTitleBarMoreActionsController, WorkbenchPhase.AfterRestored);

// #endregion
