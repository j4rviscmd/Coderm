/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProgressService, IProgress, IProgressStep, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IUpdateService, StateType, State } from '../../../../platform/update/common/update.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { localize } from '../../../../nls.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { computeProgressPercent } from '../../update/common/updateUtils.js';
import { isWeb } from '../../../../base/common/platform.js';

// #region Configuration

const CONFIG_ENABLED = 'coderm.updateDownloadProgress.enabled';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.updateDownloadProgress',
	order: 102,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CONFIG_ENABLED]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.updateDownloadProgress.enabled', "Controls whether a progress notification is shown during app update downloads."),
		},
	},
});

// #endregion

// #region Controller

/**
 * Workbench contribution that displays a notification progress bar during
 * application update downloads. Listens to the update service state and
 * translates download byte counts into a 0-100% progress indicator.
 *
 * Controlled by the `coderm.updateDownloadProgress.enabled` setting.
 * Disabled automatically on web platforms.
 */
export class UpdateDownloadProgressContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.coderm.updateDownloadProgress';

	/** Resolve callback for the internal promise that keeps the progress notification alive. */
	private _progressResolve: (() => void) | undefined;

	/** Progress reporter reference used to increment the notification bar. */
	private _progress: IProgress<IProgressStep> | undefined;

	/** Last reported percentage (0-100) used to compute incremental deltas. `-1` when idle. */
	private _lastPercent = -1;

	/** Whether the progress notification is currently visible. */
	private _showing = false;

	/**
	 * @param configurationService - Used to read the `coderm.updateDownloadProgress.enabled` setting.
	 * @param progressService      - Used to display the notification-based progress bar.
	 * @param updateService        - Source of update state change events (download progress).
	 */
	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProgressService private readonly progressService: IProgressService,
		@IUpdateService private readonly updateService: IUpdateService,
	) {
		super();

		if (isWeb) {
			return;
		}

		this._register(this.updateService.onStateChange(state => this._onStateChange(state)));
	}

	/**
	 * Handles update state changes. Starts, updates, or ends the progress
	 * notification depending on whether the current state is `Downloading`.
	 *
	 * @param state - The current update service state.
	 */
	private _onStateChange(state: State): void {
		if (!this.configurationService.getValue<boolean>(CONFIG_ENABLED)) {
			this._endProgress();
			return;
		}

		if (state.type === StateType.Downloading) {
			const percent = computeProgressPercent(state.downloadedBytes, state.totalBytes);

			if (!this._showing) {
				this._startProgress(percent);
			} else if (percent !== undefined) {
				this._updateProgress(percent);
			}
		} else {
			this._endProgress();
		}
	}

	/**
	 * Opens a notification-based progress bar and reports the initial percentage.
	 * The notification remains visible until {@link _endProgress} resolves the
	 * internal promise.
	 *
	 * @param initialPercent - The download percentage at the time the notification
	 *                         is first shown (0-100), or `undefined` if total size
	 *                         is unknown (defaults to 0).
	 */
	private _startProgress(initialPercent: number | undefined): void {
		this._showing = true;
		const startPercent = initialPercent ?? 0;
		this._lastPercent = startPercent;

		this.progressService.withProgress(
			{ location: ProgressLocation.Notification, title: localize('updateDownloading', "Downloading Coderm update...") },
			async (progress) => {
				this._progress = progress;
				progress.report({ increment: startPercent });

				await new Promise<void>(resolve => { this._progressResolve = resolve; });
			},
		);
	}

	/**
	 * Reports an incremental progress update to the visible notification.
	 * The increment is computed as the delta between the new percentage and
	 * the last reported value.
	 *
	 * @param percent - The current download percentage (0-100).
	 */
	private _updateProgress(percent: number): void {
		if (this._progress && percent !== this._lastPercent) {
			this._progress.report({ increment: percent - this._lastPercent });
			this._lastPercent = percent;
		}
	}

	/**
	 * Completes the progress notification. If the progress has not yet reached
	 * 100%, it first reports the remaining increment so the bar fills completely,
	 * then resolves the internal promise to dismiss the notification and resets
	 * all internal state.
	 */
	private _endProgress(): void {
		if (this._progressResolve) {
			if (this._progress && this._lastPercent < 100) {
				this._progress.report({ increment: 100 - this._lastPercent });
				this._lastPercent = 100;
			}
			this._progressResolve();
			this._progressResolve = undefined;
			this._progress = undefined;
			this._lastPercent = -1;
			this._showing = false;
		}
	}

	override dispose(): void {
		this._endProgress();
		super.dispose();
	}
}

// #endregion

// #region Registration

registerWorkbenchContribution2(UpdateDownloadProgressContribution.ID, UpdateDownloadProgressContribution, WorkbenchPhase.AfterRestored);

// #endregion
