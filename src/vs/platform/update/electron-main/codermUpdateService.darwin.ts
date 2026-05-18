/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { spawn } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { Delayer } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { hash } from '../../../base/common/hash.js';
import * as path from '../../../base/common/path.js';
import { transform } from '../../../base/common/stream.js';
import { URI } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IFileService } from '../../files/common/files.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { AbstractUpdateService, IUpdateURLOptions, UpdateErrorClassification } from './abstractUpdateService.js';
import { checkForGitHubReleaseUpdate } from './codermGitHubReleases.js';

/**
 * macOS update service for Coderm.
 *
 * Uses GitHub Releases API for update checks and a custom DMG download & install flow:
 *
 *  1. Check for updates via GitHub Releases API
 *  2. Download DMG via HTTP
 *  3. Mount with hdiutil
 *  4. Copy .app to staging directory
 *  5. On quit: replace current .app bundle and relaunch
 */
export class CodermDarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	/** Holds the staged application bundle path and name when an update is ready to apply. */
	private pendingUpdate: { stagingPath: string; appName: string } | undefined;

	/**
	 * Lazily-created directory used to store downloaded DMG files and
	 * extracted `.app` bundles while an update is in progress.
	 *
	 * Located under `<userDataPath>/coderm-update-staging`.
	 */
	@memoize
	private get stagingDir(): string {
		const dir = path.join(this.environmentMainService.userDataPath, 'coderm-update-staging');
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEnvironmentMainService protected override readonly environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
		@IFileService private readonly fileService: IFileService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, true);

		lifecycleMainService.setRelaunchHandler(this);
	}

	/**
	 * Intercepts the application relaunch to apply a pending DMG-based update.
	 *
	 * When the update state is `Ready` and a staged update exists, this handler
	 * spawns a background shell script that waits for the current process to exit,
	 * replaces the application bundle, and re-launches it.
	 *
	 * @param options - Relaunch options. If `addArgs` or `removeArgs` are provided
	 *   the handler delegates back to the default relaunch behaviour.
	 * @returns `true` if the relaunch was handled (update applied), `false` otherwise.
	 */
	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false;
		}

		if (this.state.type !== StateType.Ready || !this.pendingUpdate) {
			return false;
		}

		this.logService.trace('coderm-update#handleRelaunch(): applying DMG update on quit');
		this.applyDmgUpdateOnQuit();

		return true;
	}

	/**
	 * Performs platform-specific initialisation for the Darwin update service.
	 * Logs the use of the GitHub Releases API and delegates to the base class.
	 *
	 * TODO(dev-only): temporarily bypasses the isBuilt check so that the
	 * update flow can be tested from a dev build. Remove before release.
	 */
	protected override async initialize(): Promise<void> {
		this.logService.info('coderm-update#initialize - using GitHub Releases API');

		const isDev = !this.environmentMainService.isBuilt;
		if (isDev) {
			this.logService.info('coderm-update#initialize - dev mode: temporarily bypassing isBuilt check');
			Object.defineProperty(this.environmentMainService, 'isBuilt', { value: true, configurable: true });
		}

		try {
			await super.initialize();
		} finally {
			if (isDev) {
				Object.defineProperty(this.environmentMainService, 'isBuilt', { value: false, configurable: true });
			}
		}
	}

	/**
	 * Returns a placeholder update feed URL so that the base class validation passes.
	 * Actual update checks are performed via the GitHub Releases API in
	 * {@link CodermDarwinUpdateService.doCheckForUpdates}.
	 *
	 * @param _quality - Unused quality channel identifier.
	 * @param _commit - Unused current commit hash.
	 * @param _options - Unused URL-building options.
	 * @returns A URL derived from the product's `updateUrl` with `/releases/latest` appended.
	 */
	protected buildUpdateFeedUrl(_quality: string, _commit: string, _options?: IUpdateURLOptions): string | undefined {
		// Return placeholder so AbstractUpdateService.initialize() passes validation
		return `${this.productService.updateUrl}/releases/latest`;
	}

	/**
	 * Checks for a newer release via the GitHub Releases API.
	 *
	 * On success the state transitions to either `AvailableForDownload` (update
	 * found) or `Idle` (already up-to-date).  On failure the state is set to
	 * `Idle` with the error message (only for user-initiated checks) and an
	 * error telemetry event is logged.
	 *
	 * @param explicit - Whether this check was triggered by the user.
	 * @param _pendingCommit - Unused pending commit hash.
	 */
	protected doCheckForUpdates(explicit: boolean, _pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));

		checkForGitHubReleaseUpdate(
			this.requestService,
			this.productService,
			this.logService,
			'darwin',
			process.arch,
			CancellationToken.None
		).then(update => {
			if (!update || !update.url || !update.productVersion) {
				this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
			} else {
				this.logService.info(`coderm-update#doCheckForUpdates - update available: ${update.productVersion}`);
				this.setState(State.AvailableForDownload(update));
			}
		}).catch(err => {
			this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
			this.logService.error('coderm-update#doCheckForUpdates - error', err);
			const message: string | undefined = explicit ? (err.message || err) : undefined;
			this.setState(State.Idle(UpdateType.Archive, message));
		});
	}

	/**
	 * Downloads the DMG for the available update, mounts it, extracts the
	 * `.app` bundle to the staging directory, and transitions to the `Ready`
	 * state so the update can be applied on the next relaunch.
	 *
	 * @param state - The current `AvailableForDownload` state containing the update metadata.
	 */
	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		const update = state.update;
		const startTime = Date.now();
		this.setState(State.Downloading(update, true, false, 0, undefined, startTime));

		try {
			const dmgPath = path.join(this.stagingDir, `Coderm-${update.productVersion}.dmg`);
			await this.downloadFile(update.url!, dmgPath, update, startTime);

			this.logService.info('coderm-update#doDownloadUpdate - DMG downloaded, mounting...');
			this.setState(State.Downloaded(update, true, false));

			const appPath = await this.extractAppFromDmg(dmgPath);
			if (!appPath) {
				this.setState(State.Idle(UpdateType.Archive, 'Failed to extract app from DMG'));
				return;
			}

			this.pendingUpdate = { stagingPath: appPath, appName: path.basename(appPath) };
			this.setState(State.Ready(update, true, false));
		} catch (err) {
			this.logService.error('coderm-update#doDownloadUpdate - error', err);
			this.setState(State.Idle(UpdateType.Archive, String(err.message || err)));
		}
	}

	/**
	 * Downloads `url` to `destPath` while reporting progress through the state machine.
	 *
	 * A transforming stream is used so that each chunk increments the
	 * downloaded-byte counter and updates the `Downloading` state (throttled
	 * to at most once every 500 ms).
	 *
	 * @param url - The remote URL of the DMG file.
	 * @param destPath - Absolute local path where the file should be written.
	 * @param update - The update object used to construct progress state.
	 * @param startTime - Timestamp (ms) when the download started, used for progress display.
	 */
	private async downloadFile(url: string, destPath: string, update: IUpdate, startTime: number): Promise<void> {
		const context = await this.requestService.request({ url, callSite: 'codermUpdateService.darwin.downloadDmg' }, CancellationToken.None);
		const contentLengthHeader = context.res.headers['content-length'];
		const totalBytes = typeof contentLengthHeader === 'string' ? parseInt(contentLengthHeader, 10) : undefined;

		let downloadedBytes = 0;
		const progressDelayer = new Delayer<void>(500);
		const progressStream = transform<VSBuffer, VSBuffer>(
			context.stream,
			{
				data: data => {
					downloadedBytes += data.byteLength;
					progressDelayer.trigger(() => {
						this.setState(State.Downloading(update, true, false, downloadedBytes, totalBytes, startTime));
					});
					return data;
				}
			},
			chunks => VSBuffer.concat(chunks)
		);

		await this.fileService.writeFile(URI.file(destPath), progressStream)
			.finally(() => progressDelayer.dispose());
	}

	/**
	 * Mounts a DMG, copies the enclosed `.app` bundle to the staging
	 * directory, and unmounts the volume.
	 *
	 * Security: the `.app` entry name is validated against `^[\w\s.\-]+\.app$`
	 * before being used in any file operation to mitigate path-traversal risks.
	 *
	 * @param dmgPath - Absolute path to the downloaded DMG file.
	 * @returns The absolute path of the staged `.app` bundle, or `undefined`
	 *   if mounting or extraction failed.
	 */
	private async extractAppFromDmg(dmgPath: string): Promise<string | undefined> {
		const mountOutput = await this.runCommand('hdiutil', ['attach', '-nobrowse', dmgPath]);
		const mountPoint = mountOutput.split('\n').find(l => l.includes('/Volumes/'))?.trim().split(/\s+/).pop();
		if (!mountPoint) {
			this.logService.error('coderm-update#extractAppFromDmg - could not find mount point');
			return undefined;
		}

		try {
			const entries = await this.runCommand('ls', [mountPoint]);
			const appName = entries.split('\n').find(e => e.endsWith('.app'));
			if (!appName || !/^[\w\s.\-]+\.app$/.test(appName)) {
				this.logService.error('coderm-update#extractAppFromDmg - no valid .app found in DMG');
				return undefined;
			}

			const sourceApp = path.join(mountPoint, appName);
			const stagedApp = path.join(this.stagingDir, appName);

			rmSync(stagedApp, { recursive: true, force: true });

			await this.runCommand('cp', ['-R', sourceApp, stagedApp]);

			this.logService.info(`coderm-update#extractAppFromDmg - staged: ${stagedApp}`);
			return stagedApp;
		} finally {
			await this.runCommand('hdiutil', ['detach', mountPoint, '-quiet']).catch(err => {
				this.logService.warn('coderm-update#extractAppFromDmg - failed to detach', err);
			});
		}
	}

	/**
	 * Writes a shell script to disk and spawns it as a detached process.
	 *
	 * The script waits for all Coderm processes to exit, replaces the
	 * current `.app` bundle with the staged one, re-launches the
	 * application, and cleans up the script and DMG files.
	 *
	 * Must only be called when {@link pendingUpdate} is set.
	 */
	private applyDmgUpdateOnQuit(): void {
		if (!this.pendingUpdate) {
			return;
		}

		const { stagingPath, appName } = this.pendingUpdate;

		const currentAppPath = electron.app.getAppPath().split('.app')[0] + '.app';
		const parentDir = path.dirname(path.dirname(currentAppPath));
		const targetAppPath = path.join(parentDir, appName);

		const scriptPath = path.join(this.stagingDir, 'apply-update.sh');
		const script = [
			'#!/bin/bash',
			'while pgrep -f "Coderm" > /dev/null 2>&1; do',
			'\tsleep 0.5',
			'done',
			'sleep 1',
			`rm -rf "${targetAppPath}"`,
			`mv "${stagingPath}" "${targetAppPath}"`,
			`open "${targetAppPath}"`,
			`rm -f "${scriptPath}"`,
			`rm -f "${stagingPath}/../Coderm-"*.dmg`,
		].join('\n') + '\n';
		writeFileSync(scriptPath, script, { mode: 0o755 });

		this.logService.info(`coderm-update#applyDmgUpdateOnQuit - launching update script: ${scriptPath}`);
		spawn('/bin/bash', [scriptPath], {
			detached: true,
			stdio: 'ignore',
			env: { ...process.env }
		}).unref();
	}

	/**
	 * Triggers the DMG update application when the user chooses "Quit and Install".
	 * Delegates to {@link applyDmgUpdateOnQuit} which spawns a background script.
	 */
	protected override doQuitAndInstall(): void {
		if (this.pendingUpdate) {
			this.logService.trace('coderm-update#quitAndInstall(): applying DMG update');
			this.applyDmgUpdateOnQuit();
		}
	}

	/**
	 * Returns the archive update type used by the base class for state tracking.
	 * On macOS the DMG-based flow is classified as an archive-style update.
	 *
	 * @returns Always {@link UpdateType.Archive}.
	 */
	protected override getUpdateType(): UpdateType {
		return UpdateType.Archive;
	}

	/**
	 * Spawns a child process and collects its stdout output.
	 *
	 * @param command - The executable to run (e.g. `hdiutil`, `cp`).
	 * @param args - Arguments passed to the command.
	 * @returns The combined stdout output on success (exit code 0).
	 * @throws {Error} If the process exits with a non-zero code, including
	 *   the command, exit code, and captured stderr in the message.
	 */
	private runCommand(command: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args);
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', data => stdout += data.toString());
			child.stderr.on('data', data => stderr += data.toString());
			child.once('exit', code => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(`${command} ${args.join(' ')} exited with code ${code}: ${stderr}`));
				}
			});
			child.once('error', reject);
		});
	}
}
