/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { localize } from '../../../../nls.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { IHostService } from '../../../services/host/browser/host.js';

// #region Configuration

/**
 * Coderm configuration keys used by the inactive-overlay feature.
 */
const CodermSettings = {
	/** Display mode for the inactive overlay (`on` | `off` | `blur-off`). */
	MODE: 'coderm.inactiveOverlay.mode',
	/** Delay in milliseconds before showing the overlay after the window loses focus. */
	DELAY: 'coderm.inactiveOverlay.delay',
	/** Whether the centered "Not Active" card is shown on the overlay. */
	LABEL: 'coderm.inactiveOverlay.label',
	/** Backdrop darkness of the overlay (0-1), applies to both `on`/`blur-off`. */
	DIMMING: 'coderm.inactiveOverlay.dimming',
};

/** Display mode of the inactive overlay. */
export type CodermInactiveOverlayMode = 'on' | 'off' | 'blur-off';

// Constraint: APPLICATION scope is intentional because the inactive overlay is
// a host-level visual cue; per-workspace overrides would fragment the behavior
// across windows (sibling pattern: cursorAutoHide.ts).
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.inactiveOverlay',
	// Note: order=107 reserves a stable slot after existing Coderm settings
	// (activePaneBorder=100, cursorAutoHide=101, ..., titleBar=106) so the
	// Settings UI renders this section predictably relative to siblings.
	order: 107,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermSettings.MODE]: {
			type: 'string',
			enum: ['on', 'off', 'blur-off'],
			enumDescriptions: [
				localize('coderm.inactiveOverlay.mode.on', "Show the overlay with a blurred backdrop when the window is inactive."),
				localize('coderm.inactiveOverlay.mode.off', "Disable the inactive overlay entirely."),
				localize('coderm.inactiveOverlay.mode.blurOff', "Show the overlay with a translucent backdrop but without blur."),
			],
			default: 'on',
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.inactiveOverlay.mode', "Controls the behavior of the modal overlay shown when the application window loses focus. The overlay blurs and dims the workbench so it is obvious keystrokes are no longer reaching this window."),
		},
		[CodermSettings.DELAY]: {
			type: 'number',
			default: 300,
			minimum: 0,
			maximum: 5000,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.inactiveOverlay.delay', "Controls the delay in milliseconds before the inactive overlay is shown after the window loses focus. Prevents flicker during brief focus changes (e.g. Cmd+Tab)."),
		},
		[CodermSettings.LABEL]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.inactiveOverlay.label', "Controls whether the centered \"Not Active\" card (icon + label) is shown on the inactive overlay. Disable for a plain dimmed/blurred overlay with no center content."),
		},
		[CodermSettings.DIMMING]: {
			type: 'number',
			default: 0.45,
			minimum: 0,
			maximum: 1,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.inactiveOverlay.dimming', "Controls how dark the inactive overlay backdrop is (0-1). Applies to both `on` and `blur-off` modes."),
		},
	},
});

// #endregion

// #region Controller

/** CSS class on the overlay element. */
const OVERLAY_CLASS = 'coderm-inactive-overlay';
/** CSS class applied to `<body>` when the overlay should be visible. */
const VISIBLE_CLASS = 'coderm-inactive-overlay-visible';
/** Modifier class on the overlay element to disable backdrop blur (blur-off mode). */
const NO_BLUR_CLASS = 'coderm-inactive-overlay-no-blur';
/** Modifier class on the overlay element to hide the centered card (label off). */
const NO_LABEL_CLASS = 'coderm-inactive-overlay-no-label';
/** CSS class of the centered glass card. */
const CARD_CLASS = 'coderm-inactive-overlay__card';
/** CSS class of the leading codicon inside the card. */
const ICON_CLASS = 'coderm-inactive-overlay__icon';
/** CSS class of the centered label element. */
const LABEL_CLASS = 'coderm-inactive-overlay__label';
/** CSS custom property holding the backdrop darkness (alpha 0-1). */
const DIMMING_VAR = '--coderm-inactive-overlay-dimming';

/**
 * Workbench contribution that displays a full-screen modal overlay when the
 * application window loses focus. The overlay blurs and dims the workbench
 * behind a centered "Not Active" card so the user can tell at a glance that
 * keystrokes are no longer reaching this window — preventing accidental
 * shortcut input into the actually-focused window.
 *
 * Why: Neovimmer/Vimmer workflows are keyboard-centric; losing the active
 * window is easy to miss and shortcuts then fire into another app.
 */
export class InactiveOverlayController extends Disposable implements IWorkbenchContribution {

	/** Unique identifier used for lazy workbench contribution registration. */
	static readonly ID = 'workbench.contrib.coderm.inactiveOverlay';

	private _mode: CodermInactiveOverlayMode = 'on';
	private _delay: number = 300;
	private _label: boolean = true;
	private _dimming: number = 0.45;
	private _timer: ReturnType<typeof setTimeout> | undefined;
	private _overlay: HTMLDivElement | undefined;

	constructor(
		@IHostService private readonly hostService: IHostService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		// Inject overlay CSS (disposed via this._store).
		createStyleSheet(undefined, s => {
			s.textContent = `
				.${OVERLAY_CLASS} {
					position: fixed;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					// Why: 10000 deliberately sits above every standard VS Code layer
					// (modal editor backdrop=2540, notifications=2545, quick input=2550,
					// dialogs=2575) so the overlay covers all of them when the window is
					// inactive — including a dialog or quick pick that happens to be open
					// at the moment focus is lost.
					z-index: 10000;
					display: none;
					align-items: center;
					justify-content: center;
					background-color: rgba(0, 0, 0, var(${DIMMING_VAR}, 0.45));
					backdrop-filter: blur(8px);
					-webkit-backdrop-filter: blur(8px);
					opacity: 0;
					transition: opacity 120ms ease-out;
					user-select: none;
					/* Absorb clicks so underlying UI is never triggered by an
					accidental click on the inactive window. The element holds
					no focusable child, so focus is never stolen and the OS-level
					focus change is left to happen naturally. */
					pointer-events: auto;
				}
				.${VISIBLE_CLASS} .${OVERLAY_CLASS} {
					display: flex;
					opacity: 1;
				}
				.${OVERLAY_CLASS}.${NO_BLUR_CLASS} {
					backdrop-filter: none;
					-webkit-backdrop-filter: none;
				}
				/* Glass card lifts the label off the dimmed backdrop so it
				stays legible on any theme. Fixed light-on-dark palette to
				avoid the previous theme-dependent low-contrast issue. */
				.${CARD_CLASS} {
					display: flex;
					flex-direction: column;
					align-items: center;
					gap: 14px;
					padding: 32px 56px;
					border-radius: 18px;
					background-color: rgba(28, 28, 32, 0.6);
					border: 1px solid rgba(255, 255, 255, 0.14);
					backdrop-filter: blur(16px);
					-webkit-backdrop-filter: blur(16px);
					box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
					user-select: none;
					pointer-events: none;
				}
				.${OVERLAY_CLASS}.${NO_BLUR_CLASS} .${CARD_CLASS} {
					backdrop-filter: none;
					-webkit-backdrop-filter: none;
					background-color: rgba(28, 28, 32, 0.78);
				}
				/* Hide the centered card entirely when label is disabled,
				leaving a plain dimmed/blurred overlay. */
				.${OVERLAY_CLASS}.${NO_LABEL_CLASS} .${CARD_CLASS} {
					display: none;
				}
				.${ICON_CLASS} {
					font-size: 34px;
					color: rgba(255, 255, 255, 0.78);
				}
				.${LABEL_CLASS} {
					font-size: 26px;
					font-weight: 300;
					letter-spacing: 0.14em;
					text-transform: uppercase;
					color: rgba(255, 255, 255, 0.9);
					user-select: none;
					pointer-events: none;
				}
			`;
		}, this._store);

		// Build the overlay DOM once. No tabindex / no focusable element keeps
		// focus from landing on the overlay and re-triggering onDidChangeFocus
		// (focus recursion). Visibility is driven purely by a body class below.
		const overlay = mainWindow.document.createElement('div');
		overlay.classList.add(OVERLAY_CLASS);
		// Constraint: aria-hidden + no focusable child keeps the overlay out of the
		// accessibility tree and the Tab sequence. The overlay is a purely visual
		// inactive-state cue; exposing it would trap screen-reader users in a
		// non-interactive element.
		overlay.setAttribute('aria-hidden', 'true');
		const card = mainWindow.document.createElement('div');
		card.classList.add(CARD_CLASS);
		const icon = mainWindow.document.createElement('div');
		icon.classList.add(ICON_CLASS, 'codicon', 'codicon-eye-closed');
		const label = mainWindow.document.createElement('div');
		label.classList.add(LABEL_CLASS);
		// TODO[i18n]: Coderm owns this key, so VS Code language packs do not
		// translate it; the label stays English ("Not Active") for now. Swap to
		// a locale-aware lookup if Coderm grows its own translation layer.
		label.textContent = localize('coderm.inactiveOverlay.notActive', "Not Active");
		card.appendChild(icon);
		card.appendChild(label);
		overlay.appendChild(card);
		mainWindow.document.body.appendChild(overlay);
		this._overlay = overlay;
		this._store.add(toDisposable(() => overlay.remove()));

		// Re-read and re-apply on any inactiveOverlay setting change (idempotent).
		// Why prefix-match: every property feeds _apply(), so a single guard
		// covers mode/delay/label/dimming without enumerating each key.
		this._store.add(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('coderm.inactiveOverlay')) {
				this._readConfiguration();
				this._apply();
			}
		}));

		// Why hostService.onDidChangeFocus only (never raw document blur/focus):
		// it already integrates main + auxiliary windows and is debounced via
		// Event.latch, which structurally avoids focus-recursion flicker.
		this._store.add(hostService.onDidChangeFocus(focused => this._onFocusChanged(focused)));

		// Initialize from current settings + focus state.
		this._readConfiguration();
		this._apply();
	}

	/** Reads the current configuration values. */
	private _readConfiguration(): void {
		this._mode = this.configurationService.getValue<CodermInactiveOverlayMode>(CodermSettings.MODE) ?? 'on';
		this._delay = this.configurationService.getValue<number>(CodermSettings.DELAY) ?? 300;
		this._label = this.configurationService.getValue<boolean>(CodermSettings.LABEL) ?? true;
		this._dimming = this.configurationService.getValue<number>(CodermSettings.DIMMING) ?? 0.45;
	}

	/**
	 * Idempotently reflects the current settings onto the overlay element
	 * (blur modifier, label visibility, backdrop darkness) and visibility.
	 * Safe to call repeatedly from focus events and config changes.
	 */
	private _apply(): void {
		if (this._overlay) {
			this._overlay.classList.toggle(NO_BLUR_CLASS, this._mode === 'blur-off');
			this._overlay.classList.toggle(NO_LABEL_CLASS, !this._label);
			this._overlay.style.setProperty(DIMMING_VAR, String(this._dimming));
		}
		if (this._mode === 'off') {
			this._hide();
			return;
		}
		// Feature enabled: reflect current focus state.
		this._onFocusChanged(this.hostService.hasFocus);
	}

	/** Handles window focus changes. Hides immediately on focus; schedules a
	 *  delayed show on blur to avoid flicker during brief focus switches.
	 *  No-op when the feature is disabled (`off` mode). */
	private readonly _onFocusChanged = (focused: boolean): void => {
		if (focused) {
			this._hide();
		} else if (this._mode !== 'off') {
			this._scheduleShow();
		}
	};

	/** Clears any pending show timer and arms a new one with the current delay. */
	private _scheduleShow(): void {
		this._clearTimer();
		this._timer = setTimeout(() => this._show(), this._delay);
	}

	/** Cancels the pending show timer if one is active. */
	private _clearTimer(): void {
		clearTimeout(this._timer);
		this._timer = undefined;
	}

	/** Reveals the overlay (idempotent). */
	private _show(): void {
		this._timer = undefined;
		mainWindow.document.body.classList.add(VISIBLE_CLASS);
	}

	/** Hides the overlay and cancels any pending show (idempotent). */
	private _hide(): void {
		this._clearTimer();
		mainWindow.document.body.classList.remove(VISIBLE_CLASS);
	}

	/** Cleans up the timer, hides the overlay, and removes the DOM element. */
	override dispose(): void {
		this._clearTimer();
		mainWindow.document.body.classList.remove(VISIBLE_CLASS);
		super.dispose();
	}
}

// #endregion

// #region Registration

// Why: AfterRestored (not BlockBeforeRestored) so the workbench container and
// the body element are present when the overlay is appended and _apply() runs
// the first time; earlier phases would race the layout restore.
registerWorkbenchContribution2(InactiveOverlayController.ID, InactiveOverlayController, WorkbenchPhase.AfterRestored);

// #endregion
