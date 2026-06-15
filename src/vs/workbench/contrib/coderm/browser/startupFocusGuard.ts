/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { getActiveElement, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';

// #region Configuration

/**
 * Configuration key for the startup focus guard.
 *
 * Eager extension activation (see `coderm.extensions.eagerActivation`) starts
 * extensions like vscode-neovim early, which is the whole point — but the rest
 * of startup work that runs afterwards occasionally leaves focus stranded on
 * `<body>` (no pane focused), so the user has to alt+tab away and back to get
 * the editor responsive again. When enabled (default), this contribution
 * refocuses the active editor group once, during a short window after the eager
 * extensions finish activating, but only when focus is truly lost — never when
 * the user deliberately moved it elsewhere.
 */
export const CodermStartupFocusGuardSetting = 'coderm.startup.focusGuard.enabled';

/**
 * How long after eager extensions activate we keep watching for focus loss.
 *
 * Why: The observed regression is a one-time focus theft that happens right
 * after activation, while the rest of startup work drains. A few seconds is
 * plenty and keeps the guard from interfering with later intentional focus
 * moves. Not exposed as a setting to keep the surface area minimal
 * (CLAUDE.md: "do not add flexibility that was not requested").
 */
const FOCUS_GUARD_WINDOW_MS = 3000;

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.startupFocusGuard',
	order: 106,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermStartupFocusGuardSetting]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.startup.focusGuard.enabled',
				'Restores editor focus once after startup when eager extension activation (e.g. vscode-neovim) causes focus to drift away from the editor. Watches for a short window after eager extensions finish activating and refocuses the active editor group only when focus lands on nothing (i.e. no pane has focus). Intentional focus moves (e.g. clicking the terminal) are respected. Default: enabled.'),
		},
	},
});

// #endregion

// #region Controller

/**
 * Restores editor focus after startup when eager extension activation strands
 * focus (no pane focused).
 *
 * Why: Eager activation (see `coderm.extensions.eagerActivation`) activates
 * vscode-neovim early — the original goal of PR #193/#205. The side effect is
 * that other startup work running afterwards can steal focus and leave it on
 * `<body>` / nothing, so vscode-neovim (which keys off `editorTextFocus`)
 * silently stops responding to normal-mode keys until the user alt+tabs away
 * and back. This guard opens a short window right after each eager extension
 * activates and refocuses the active editor group only when focus is truly
 * lost.
 *
 * Constraint: We deliberately do NOT refocus when `getActiveElement()` points
 * at a real pane (terminal, sidebar, panel, command palette). That is an
 * intentional focus move and must be respected — only the "focus landed on
 * nothing" case is treated as the regression we want to fix. This is what lets
 * us avoid the complexity of mousedown/keyboard intent tracking: distinguishing
 * "stranded" from "deliberately moved" reduces to a single `getActiveElement()`
 * check.
 */
export class StartupFocusGuardController extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.coderm.startupFocusGuard';

	/** Holds the focusout listener and window timer; cleared when the window closes. */
	private readonly _windowStore = new DisposableStore();

	private _windowActive = false;

	constructor(
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(this._windowStore);

		// Why: Honor the setting being toggled off at runtime — close any active
		// guard window immediately so it stops interfering.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(CodermStartupFocusGuardSetting) && !this._isEnabled()) {
				this._closeWindow();
			}
		}));

		// Why: Register the status listener unconditionally (rather than returning
		// early when disabled) so toggling the setting ON at runtime can still
		// observe a future activation. The per-event _isEnabled() check below
		// honors the OFF state, matching terminalKillFocusRestore's pattern.
		this._register(this._extensionService.onDidChangeExtensionsStatus(ids => {
			if (!this._isEnabled()) {
				return;
			}
			this._onExtensionsStatusChanged(ids);
		}));
	}

	public override dispose(): void {
		// Why: In-flight _onFocusOut setTimeout callbacks check this flag; setting
		// it false here makes a post-dispose fire a safe no-op.
		this._windowActive = false;
		super.dispose();
	}

	private _isEnabled(): boolean {
		return this._configurationService.getValue<boolean>(CodermStartupFocusGuardSetting) ?? true;
	}

	/** Reads the shared eager-activation list directly to avoid coupling to eagerExtensions.ts. */
	private _readEagerExtensionIds(): string[] {
		const ids = this._configurationService.getValue<string[]>('coderm.extensions.eagerActivation');
		return Array.isArray(ids) ? ids : [];
	}

	/**
	 * Opens the guard window once any eager extension reports it has finished
	 * activating. The event fires for several reasons (release barrier, runtime
	 * errors, activation completion); only `activationTimes` being set indicates
	 * actual completion.
	 */
	private _onExtensionsStatusChanged(ids: ExtensionIdentifier[]): void {
		if (this._windowActive) {
			return;
		}
		const eagerIds = this._readEagerExtensionIds();
		if (eagerIds.length === 0) {
			return;
		}
		const status = this._extensionService.getExtensionsStatus();
		const eagerJustActivated = ids.some(id => {
			if (!eagerIds.some(eagerId => ExtensionIdentifier.equals(eagerId, id))) {
				return false;
			}
			// Why `id.value` (raw) and not `toKey` (lowercased): getExtensionsStatus()
			// keys its result by `extension.identifier.value`, the raw id string —
			// a lowercased lookup would miss mixed-case ids like "GitHub.Copilot".
			const entry = status[id.value];
			return entry?.activationTimes !== undefined;
		});
		if (eagerJustActivated) {
			this._openWindow();
		}
	}

	private _openWindow(): void {
		this._windowActive = true;

		// focusout bubbles (unlike blur), so we can catch focus leaving the editor
		// at the document level. useCapture so we run before per-pane handlers.
		this._windowStore.add(addDisposableListener(mainWindow.document, 'focusout', () => {
			this._onFocusOut();
		}, true));

		this._windowStore.add(disposableTimeout(() => {
			this._closeWindow();
		}, FOCUS_GUARD_WINDOW_MS, this._windowStore));
	}

	/**
	 * On focus leaving an element, check whether focus has truly been lost.
	 *
	 * Why the one-tick deferral: at `focusout` time the new active element is
	 * not settled yet, so `getActiveElement()` would still report the element
	 * that lost focus. Deferring lets the browser commit the new focus target.
	 * This mirrors `editorGroupView`'s FOCUS_OUT handler, which uses the same
	 * `setTimeout(..., 0)` trick.
	 */
	private _onFocusOut(): void {
		// Why: Plain setTimeout (not disposableTimeout added to _windowStore) so
		// _restoreFocus -> _closeWindow -> _windowStore.clear() never clears the
		// store from within a callback the store owns. The _windowActive flag
		// (set false in dispose() and _closeWindow()) makes a post-dispose or
		// post-close fire a safe no-op.
		setTimeout(() => {
			if (!this._windowActive) {
				return;
			}
			if (this._isStrandedFocus(getActiveElement())) {
				this._restoreFocus();
			}
		}, 0);
	}

	/**
	 * Returns true only when focus has landed on "nothing" — the regression
	 * signature. A real pane (terminal, sidebar, panel, command palette) is an
	 * intentional focus move and must be left alone.
	 */
	private _isStrandedFocus(active: Element | null): boolean {
		if (active === null) {
			return true;
		}
		return active === mainWindow.document.body || active === mainWindow.document.documentElement;
	}

	private _restoreFocus(): void {
		this._editorGroupsService.activeGroup.focus();
		this._logService.info('[Coderm] startup focus guard: restored editor focus after eager activation');
		this._closeWindow();
	}

	private _closeWindow(): void {
		this._windowActive = false;
		this._windowStore.clear();
	}
}

// #endregion

// #region Registration

// Why: AfterRestored (not earlier) because eager extension activation runs
// after `_initialize()` completes (see `_activateEagerExtensions()` in
// abstractExtensionService.ts), which aligns with LifecyclePhase.Restored.
// An earlier phase would register the `onDidChangeExtensionsStatus` listener
// before the eager extensions finish activating, but the guard's design
// assumes it can observe the activation completion event itself — registering
// too late would miss that event and never open the guard window.
registerWorkbenchContribution2(
	StartupFocusGuardController.ID,
	StartupFocusGuardController,
	WorkbenchPhase.AfterRestored
);

// #endregion
