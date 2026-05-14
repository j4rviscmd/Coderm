/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { Event } from '../../../base/common/event.js';
import { isMacintosh } from '../../../base/common/platform.js';
import * as path from '../../../base/common/path.js';
import { Delayer } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
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
import { AbstractUpdateService, getUpdateRequestHeaders, IUpdateURLOptions, UpdateErrorClassification } from './abstractUpdateService.js';
import { checkForGitHubReleaseUpdate } from './codermGitHubReleases.js';
import { transform } from '../../../base/common/stream.js';
import { hash } from '../../../base/common/hash.js';

/**
 * macOS update service for Coderm.
 *
 * Attempts to use Electron's autoUpdater (Squirrel.Mac) first.
 * If the app is unsigned (ad-hoc), autoUpdater.setFeedURL() will throw,
 * and the service falls back to a custom DMG download & install flow:
 *
 *  1. Download DMG via HTTP
 *  2. Mount with hdiutil
 *  3. Copy .app to staging directory
 *  4. On quit: replace current .app bundle and relaunch
 */
export class CodermDarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	private readonly disposables = new DisposableStore();
	private useAutoUpdater = true;
	private pendingUpdate: { stagingPath: string; appName: string } | undefined;

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

	protected override async initialize(): Promise<void> {
		// Probe whether autoUpdater is usable (app is code-signed)
		if (isMacintosh) {
			try {
				const headers = getUpdateRequestHeaders(this.productService.version);
				electron.autoUpdater.setFeedURL({ url: 'https://localhost', headers });
				this.useAutoUpdater = true;
				this.logService.info('coderm-update#initialize - autoUpdater available (app is signed)');
			} catch {
				this.useAutoUpdater = false;
				this.logService.info('coderm-update#initialize - autoUpdater unavailable (app is unsigned), using DMG fallback');
			}
		}

		await super.initialize();

		if (this.useAutoUpdater) {
			const onError = Event.fromNodeEventEmitter<string>(electron.autoUpdater, 'error', (_, message) => message);
			const onUpdateDownloaded = Event.fromNodeEventEmitter<IUpdate>(electron.autoUpdater, 'update-downloaded', (_, version: string, productVersion: string, releaseDate: Date | number) => ({
				version,
				productVersion,
				timestamp: releaseDate instanceof Date ? releaseDate.getTime() || undefined : releaseDate
			}));

			this.disposables.add(onError(msg => this.onAutoUpdaterError(msg)));
			this.disposables.add(onUpdateDownloaded(update => this.onAutoUpdaterDownloaded(update)));
		}
	}

	private onAutoUpdaterError(err: string): void {
		this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
		this.logService.error('coderm-update error:', err);

		const message = (this.state.type === StateType.CheckingForUpdates && this.state.explicit) ? err : undefined;
		this.setState(State.Idle(UpdateType.Archive, message));
	}

	private onAutoUpdaterDownloaded(update: IUpdate): void {
		if (this.state.type !== StateType.Downloading) {
			return;
		}

		this.logService.info(`coderm-update: update downloaded via autoUpdater: ${JSON.stringify(update)}`);
		this.setState(State.Downloaded(update, this.state.explicit, this._overwrite));
		this.setState(State.Ready(update, this.state.explicit, this._overwrite));
	}

	protected buildUpdateFeedUrl(quality: string, commit: string, _options?: IUpdateURLOptions): string | undefined {
		if (this.useAutoUpdater) {
			// NOTE: This path is unreachable for unsigned (ad-hoc) builds.
			// If code signing is added in the future, replace with a Coderm-specific update server.
			const assetID = this.productService.darwinUniversalAssetId ?? (process.arch === 'x64' ? 'darwin' : 'darwin-arm64');
			const url = `https://update.code.visualstudio.com/api/update/${assetID}/${quality}/${commit}`;
			const headers = getUpdateRequestHeaders(this.productService.version);
			try {
				electron.autoUpdater.setFeedURL({ url, headers });
			} catch {
				this.logService.error('coderm-update#buildUpdateFeedUrl - failed to set autoUpdater feed URL');
				return undefined;
			}
			return url;
		}

		// DMG fallback: return placeholder so AbstractUpdateService.initialize() passes validation
		return `${this.productService.updateUrl}/releases/latest`;
	}

	protected doCheckForUpdates(explicit: boolean, _pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));

		if (this.useAutoUpdater) {
			if (!explicit && this.meteredConnectionService.isConnectionMetered) {
				this.logService.info('coderm-update#doCheckForUpdates - skipping autoUpdater on metered connection');
				this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				return;
			}
			electron.autoUpdater.checkForUpdates();
			return;
		}

		// Unsigned fallback: use GitHub Releases API
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
		}).then(undefined, err => {
			this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
			this.logService.error('coderm-update#doCheckForUpdates - error', err);
			const message: string | undefined = explicit ? (err.message || err) : undefined;
			this.setState(State.Idle(UpdateType.Archive, message));
		});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		if (this.useAutoUpdater) {
			this.buildUpdateFeedUrl(this.quality!, state.update.version, { internalOrg: this.getInternalOrg() });
			this.setState(State.CheckingForUpdates(true));
			electron.autoUpdater.checkForUpdates();
			return;
		}

		// DMG fallback: download and extract
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

	private async extractAppFromDmg(dmgPath: string): Promise<string | undefined> {
		const mountOutput = await this.runCommand('hdiutil', ['attach', '-nobrowse', '-quiet', dmgPath]);
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

			if (existsSync(stagedApp)) {
				rmSync(stagedApp, { recursive: true, force: true });
			}

			await this.runCommand('cp', ['-R', sourceApp, stagedApp]);

			this.logService.info(`coderm-update#extractAppFromDmg - staged: ${stagedApp}`);
			return stagedApp;
		} finally {
			await this.runCommand('hdiutil', ['detach', mountPoint, '-quiet']).catch(err => {
				this.logService.warn('coderm-update#extractAppFromDmg - failed to detach', err);
			});
		}
	}

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

	protected override doQuitAndInstall(): void {
		if (this.useAutoUpdater) {
			this.logService.trace('coderm-update#quitAndInstall(): using autoUpdater');
			electron.autoUpdater.quitAndInstall();
			return;
		}

		if (this.pendingUpdate) {
			this.logService.trace('coderm-update#quitAndInstall(): applying DMG update');
			this.applyDmgUpdateOnQuit();
		}
	}

	protected override getUpdateType(): UpdateType {
		return UpdateType.Archive;
	}

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

	dispose(): void {
		this.disposables.dispose();
	}
}
