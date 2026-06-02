/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { localize } from '../../../../nls.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';

// #region Configuration

/**
 * Coderm configuration keys used by the cursor-auto-hide feature.
 */
const CodermSettings = {
	/** Whether the cursor-auto-hide feature is enabled. */
	ENABLED: 'coderm.cursorAutoHide.enabled',
	/** Inactivity delay in milliseconds before the cursor is hidden. */
	DELAY: 'coderm.cursorAutoHide.delay',
	/** Whether to suppress mouse-triggered editor hover when cursorAutoHide is active. */
	SUPPRESS_HOVER: 'coderm.cursorAutoHide.suppressHover',
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.cursorAutoHide',
	order: 101,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermSettings.ENABLED]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.cursorAutoHide.enabled', "Controls whether the mouse cursor is automatically hidden after a period of inactivity. The cursor reappears on any mouse movement and hides immediately when typing."),
		},
		[CodermSettings.DELAY]: {
			type: 'number',
			default: 3000,
			minimum: 500,
			maximum: 30000,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.cursorAutoHide.delay', "Controls the delay in milliseconds before the mouse cursor is automatically hidden after inactivity."),
		},
		[CodermSettings.SUPPRESS_HOVER]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.cursorAutoHide.suppressHover', "Controls whether mouse-triggered editor hover tooltips are suppressed while cursor auto-hide is active. Keyboard-triggered hover (e.g. Ctrl+K Ctrl+I) still works."),
		},
	},
});

// #endregion

// #region Controller

/** CSS class applied to `<body>` to hide the mouse cursor via `cursor: none !important`. */
const CURSOR_HIDDEN_CLASS = 'cursor-auto-hidden';
/** Persistent body class when cursorAutoHide is enabled AND suppressHover is true. */
export const HOVER_SUPPRESSED_CLASS = 'coderm-hover-suppressed';

/**
 * Workbench contribution that automatically hides the mouse cursor after a
 * configurable period of inactivity. Any mouse activity restores the cursor;
 * keyboard activity hides it immediately.
 */
export class CursorAutoHideController extends Disposable implements IWorkbenchContribution {

	/** Unique identifier used for lazy workbench contribution registration. */
	static readonly ID = 'workbench.contrib.coderm.cursorAutoHide';

	private _enabled: boolean = true;
	private _delay: number = 3000;
	private _suppressHover: boolean = true;
	private _timer: ReturnType<typeof setTimeout> | undefined;
	private _isHidden: boolean = false;
	/** Whether a context menu is currently open; prevents the timer from restarting while visible. */
	private _contextMenuVisible: boolean = false;

	/**
	 * @param configurationService - Provides access to Coderm settings for enabled/delay values.
	 */
	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();

		// Inject cursor-hiding CSS (disposed via this._store)
		createStyleSheet(undefined, s => {
			s.textContent = `
				.${CURSOR_HIDDEN_CLASS},
				.${CURSOR_HIDDEN_CLASS} * { cursor: none !important; }

				/* Hide sash hover highlight when cursor is auto-hidden */
				.${CURSOR_HIDDEN_CLASS} .monaco-sash.hover::before {
					background: none !important;
				}
			`;
		}, this._store);

		// Listen for configuration changes
		this._store.add(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(CodermSettings.ENABLED)) {
				this._onDidChangeEnabled();
			}
			if (e.affectsConfiguration(CodermSettings.DELAY)) {
				this._onDidChangeDelay();
			}
			if (e.affectsConfiguration(CodermSettings.SUPPRESS_HOVER)) {
				this._onDidChangeSuppressHover();
			}
		}));

		// Pause cursor hiding while a context menu is open
		this._store.add(contextMenuService.onDidShowContextMenu(() => {
			this._contextMenuVisible = true;
			this._showCursor();
			this._clearTimer();
		}));
		this._store.add(contextMenuService.onDidHideContextMenu(() => {
			this._contextMenuVisible = false;
			if (this._enabled) {
				this._resetTimer();
			}
		}));

		// Initialize
		this._readConfiguration();
		this._updateHoverSuppressedClass();
		this._setupListeners();
	}

	/** Reads the current `enabled`, `delay`, and `suppressHover` values from configuration. */
	private _readConfiguration(): void {
		this._enabled = this.configurationService.getValue<boolean>(CodermSettings.ENABLED) ?? true;
		this._delay = this.configurationService.getValue<number>(CodermSettings.DELAY) ?? 3000;
		this._suppressHover = this.configurationService.getValue<boolean>(CodermSettings.SUPPRESS_HOVER) ?? true;
	}

	/** Handles runtime changes to the `enabled` setting. Shows or resets the cursor accordingly. */
	private _onDidChangeEnabled(): void {
		this._enabled = this.configurationService.getValue<boolean>(CodermSettings.ENABLED) ?? true;
		this._updateHoverSuppressedClass();
		if (!this._enabled) {
			this._showCursor();
			this._clearTimer();
		} else {
			this._resetTimer();
		}
	}

	/** Handles runtime changes to the `delay` setting. Restarts the inactivity timer. */
	private _onDidChangeDelay(): void {
		this._delay = this.configurationService.getValue<number>(CodermSettings.DELAY) ?? 3000;
		if (this._enabled) {
			this._resetTimer();
		}
	}

	/** Handles runtime changes to the `suppressHover` setting. */
	private _onDidChangeSuppressHover(): void {
		this._suppressHover = this.configurationService.getValue<boolean>(CodermSettings.SUPPRESS_HOVER) ?? true;
		this._updateHoverSuppressedClass();
	}

	/** Adds or removes the hover-suppressed body class based on current settings. */
	private _updateHoverSuppressedClass(): void {
		if (this._enabled && this._suppressHover) {
			mainWindow.document.body.classList.add(HOVER_SUPPRESSED_CLASS);
		} else {
			mainWindow.document.body.classList.remove(HOVER_SUPPRESSED_CLASS);
		}
	}

	/**
	 * Registers DOM event listeners for mouse and keyboard activity.
	 * Starts the inactivity timer if the feature is currently enabled.
	 */
	private _setupListeners(): void {
		const doc = mainWindow.document;

		this._register(addDisposableListener(doc, 'mousemove', this._onActivity, true));
		this._register(addDisposableListener(doc, 'mousedown', this._onActivity, true));
		this._register(addDisposableListener(doc, 'keydown', this._onKeyDown, true));

		if (this._enabled) {
			this._resetTimer();
		}
	}

	/** Shows the cursor and restarts the inactivity timer on any mouse activity. */
	private readonly _onActivity = (): void => {
		if (!this._enabled) {
			return;
		}
		this._showCursor();
		this._resetTimer();
	};

	/** Hides the cursor immediately on keyboard activity (users typing don't need the cursor). */
	private readonly _onKeyDown = (): void => {
		if (!this._enabled) {
			return;
		}
		this._hideCursor();
		this._clearTimer();
	};

	/** Clears any pending timer and starts a new one with the current delay. */
	private _resetTimer(): void {
		if (this._contextMenuVisible) {
			return;
		}
		this._clearTimer();
		this._timer = setTimeout(() => {
			this._hideCursor();
		}, this._delay);
	}

	/** Cancels the pending inactivity timer if one is active. */
	private _clearTimer(): void {
		clearTimeout(this._timer);
		this._timer = undefined;
	}

	/** Adds the CSS class that hides the cursor, if not already hidden. Also dismisses any visible hover. */
	private _hideCursor(): void {
		if (!this._isHidden) {
			mainWindow.document.body.classList.add(CURSOR_HIDDEN_CLASS);
			this._isHidden = true;
			// Dismiss any visible hover (e.g. terminal link tooltip) when cursor auto-hides.
			// Alt-locked hovers are respected and will not be dismissed.
			this.hoverService.hideHover();
		}
	}

	/** Removes the CSS class that hides the cursor, if currently hidden. */
	private _showCursor(): void {
		if (this._isHidden) {
			mainWindow.document.body.classList.remove(CURSOR_HIDDEN_CLASS);
			this._isHidden = false;
		}
	}

	/** Cleans up the timer, restores the cursor, and disposes all listeners. */
	override dispose(): void {
		this._clearTimer();
		this._showCursor();
		mainWindow.document.body.classList.remove(HOVER_SUPPRESSED_CLASS);
		super.dispose();
	}
}

// #endregion

// #region Registration

registerWorkbenchContribution2(CursorAutoHideController.ID, CursorAutoHideController, WorkbenchPhase.AfterRestored);

// #endregion
