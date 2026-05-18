/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { mkdir, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { Delayer, ProcessTimeRunOnceScheduler, timeout } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { hash } from '../../../base/common/hash.js';
import * as path from '../../../base/common/path.js';
import { basename } from '../../../base/common/path.js';
import { transform } from '../../../base/common/stream.js';
import { URI } from '../../../base/common/uri.js';
import { checksum } from '../../../base/node/crypto.js';
import * as pfs from '../../../base/node/pfs.js';
import { killTree } from '../../../base/node/processes.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IFileService } from '../../files/common/files.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { AbstractUpdateService, IUpdateURLOptions, UpdateErrorClassification } from './abstractUpdateService.js';
import { checkForGitHubReleaseUpdate } from './codermGitHubReleases.js';

interface IAvailableUpdate {
	packagePath: string;
	updateFilePath?: string;
	cancelFilePath?: string;
	updateProcess?: ChildProcess;
}

let _updateType: UpdateType | undefined = undefined;
function getUpdateType(): UpdateType {
	if (typeof _updateType === 'undefined') {
		_updateType = existsSync(path.join(path.dirname(process.execPath), 'unins000.exe'))
			? UpdateType.Setup
			: UpdateType.Archive;
	}

	return _updateType;
}

/**
 * Windows update service for Coderm that uses GitHub Releases API.
 *
 * For Inno Setup installs, downloads the .exe and runs the installer
 * silently in the background (same pattern as upstream Win32UpdateService).
 * For archive installs, opens the browser to download.
 */
export class CodermWin32UpdateService extends AbstractUpdateService implements IRelaunchHandler {

	private availableUpdate: IAvailableUpdate | undefined;
	private updateCancellationTokenSource: CancellationTokenSource | undefined;

	@memoize
	get cachePath(): Promise<string> {
		const result = path.join(tmpdir(), `coderm-${this.productService.quality}-${process.arch}`);
		return mkdir(result, { recursive: true }).then(() => result);
	}

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
		@IProductService productService: IProductService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, true);

		lifecycleMainService.setRelaunchHandler(this);
	}

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false;
		}

		if (this.state.type !== StateType.Ready || !this.availableUpdate) {
			return false;
		}

		this.logService.trace('coderm-update#handleRelaunch(): running raw#quitAndInstall()');
		this.doQuitAndInstall();

		return true;
	}

	protected buildUpdateFeedUrl(_quality: string, _commit: string, _options?: IUpdateURLOptions): string {
		return `${this.productService.updateUrl}/releases/latest`;
	}

	protected doCheckForUpdates(explicit: boolean, _pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}

		if (this.state.type !== StateType.Overwriting) {
			this.setState(State.CheckingForUpdates(explicit));
		}

		checkForGitHubReleaseUpdate(
			this.requestService,
			this.productService,
			this.logService,
			'win32',
			process.arch,
			this.updateCancellationTokenSource?.token ?? CancellationToken.None
		).then(update => {
			const updateType = getUpdateType();

			if (!update || !update.url || !update.productVersion) {
				if (this.state.type === StateType.Overwriting) {
					this._overwrite = false;
					this.setState(State.Ready(this.state.update, this.state.explicit, false));
				} else {
					this.setState(State.Idle(updateType, undefined, explicit || undefined));
				}
				return;
			}

			this.logService.info(`coderm-update#doCheckForUpdates - update available: ${update.productVersion}`);

			if (updateType === UpdateType.Archive) {
				this.setState(State.AvailableForDownload(update));
				return;
			}

			if (!explicit && this.meteredConnectionService.isConnectionMetered) {
				this.logService.info('coderm-update#doCheckForUpdates - update available but skipping download because connection is metered');
				this.setState(State.AvailableForDownload(update));
				return;
			}

			const startTime = Date.now();
			this.setState(State.Downloading(update, explicit, this._overwrite, 0, undefined, startTime));

			this.cleanup(update.version).then(() => {
				return this.getUpdatePackagePath(update.version).then(updatePackagePath => {
					return pfs.Promises.exists(updatePackagePath).then(exists => {
						if (exists) {
							return Promise.resolve(updatePackagePath);
						}

						const downloadPath = `${updatePackagePath}.tmp`;

						return this.requestService.request({ url: update.url, callSite: 'codermUpdateService.win32.downloadUpdate' }, CancellationToken.None)
							.then(context => {
								const contentLengthHeader = context.res.headers['content-length'];
								const contentLength = typeof contentLengthHeader === 'string' ? contentLengthHeader : undefined;
								const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;

								let downloadedBytes = 0;
								const progressDelayer = new Delayer<void>(500);
								const progressStream = transform<VSBuffer, VSBuffer>(
									context.stream,
									{
										data: data => {
											downloadedBytes += data.byteLength;
											progressDelayer.trigger(() => {
												this.setState(State.Downloading(update, explicit, this._overwrite, downloadedBytes, totalBytes, startTime));
											});
											return data;
										}
									},
									chunks => VSBuffer.concat(chunks)
								);

								return this.fileService.writeFile(URI.file(downloadPath), progressStream)
									.finally(() => progressDelayer.dispose());
							})
							.then(update.sha256hash ? () => checksum(downloadPath, update.sha256hash) : () => undefined)
							.then(() => pfs.Promises.rename(downloadPath, updatePackagePath, false))
							.then(() => updatePackagePath);
					});
				}).then(packagePath => {
					this.availableUpdate = { packagePath };
					this.setState(State.Downloaded(update, explicit, this._overwrite));

					const fastUpdatesEnabled = this.configurationService.getValue('update.enableWindowsBackgroundUpdates');
					if (fastUpdatesEnabled && this.productService.target === 'user') {
						this.doApplyUpdate();
					} else {
						this.setState(State.Ready(update, explicit, this._overwrite));
					}
				});
			});
		}).then(undefined, err => {
			this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
			this.logService.error('coderm-update#doCheckForUpdates - error', err);

			const message: string | undefined = explicit ? (err.message || err) : undefined;

			if (this.state.type === StateType.Overwriting) {
				this._overwrite = false;
				this.setState(State.Ready(this.state.update, this.state.explicit, false));
			} else {
				this.setState(State.Idle(getUpdateType(), message));
			}
		});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		if (this.productService.downloadUrl) {
			this.nativeHostMainService.openExternal(undefined, this.productService.downloadUrl);
		} else if (state.update.url) {
			this.nativeHostMainService.openExternal(undefined, state.update.url);
		}
		this.setState(State.Idle(getUpdateType()));
	}

	private async getUpdatePackagePath(version: string): Promise<string> {
		const cachePath = await this.cachePath;
		return path.join(cachePath, `CodermSetup-${this.productService.quality}-${version}.exe`);
	}

	private async cleanup(exceptVersion: string | null = null): Promise<void> {
		const filter = exceptVersion ? (one: string) => !(new RegExp(`${this.productService.quality}-${exceptVersion}\\.exe$`).test(one)) : () => true;

		const cachePath = await this.cachePath;
		const versions = await pfs.Promises.readdir(cachePath);

		const promises = versions.filter(filter).map(one => this.unlink(path.join(cachePath, one)));
		await Promise.all(promises);
	}

	protected override async doApplyUpdate(): Promise<void> {
		if (this.state.type !== StateType.Downloaded) {
			return;
		}

		if (!this.availableUpdate) {
			return;
		}

		const update = this.state.update;
		const explicit = this.state.explicit;
		this.setState(State.Updating(update, explicit));

		const cachePath = await this.cachePath;
		const sessionEndFlagPath = path.join(cachePath, 'session-ending.flag');
		const cancelFilePath = path.join(cachePath, `cancel.flag`);
		await this.unlink(cancelFilePath);

		const progressFilePath = path.join(cachePath, `update-progress`);
		await this.unlink(progressFilePath);

		this.availableUpdate.updateFilePath = path.join(cachePath, `CodermSetup-${this.productService.quality}-${update.version}.flag`);
		this.availableUpdate.cancelFilePath = cancelFilePath;

		await pfs.Promises.writeFile(this.availableUpdate.updateFilePath, 'flag');
		const child = spawn(this.availableUpdate.packagePath,
			[
				'/verysilent',
				'/log',
				`/update="${this.availableUpdate.updateFilePath}"`,
				`/progress="${progressFilePath}"`,
				`/sessionend="${sessionEndFlagPath}"`,
				`/cancel="${cancelFilePath}"`,
				'/nocloseapplications',
				'/mergetasks=runcode,!desktopicon,!quicklaunchicon'
			],
			{
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore'],
				windowsVerbatimArguments: true,
				env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' }
			}
		);

		this.availableUpdate.updateProcess = child;

		child.once('exit', () => {
			this.availableUpdate = undefined;
			this.setState(State.Idle(getUpdateType()));
		});

		const readyMutexName = `${this.productService.win32MutexName}-ready`;
		const mutex = await import('@vscode/windows-mutex');

		this.updateCancellationTokenSource?.dispose(true);
		const cts = this.updateCancellationTokenSource = new CancellationTokenSource();
		const token = cts.token;

		const poll = async () => {
			while (this.state.type === StateType.Updating && !token.isCancellationRequested) {
				if (mutex.isActive(readyMutexName)) {
					this.setState(State.Ready(update, explicit, this._overwrite));
					return;
				}

				try {
					const progressContent = await readFile(progressFilePath, 'utf8');
					if (!token.isCancellationRequested) {
						const [currentStr, maxStr] = progressContent.split(',');
						const currentProgress = parseInt(currentStr, 10);
						const maxProgress = parseInt(maxStr, 10);
						if (!isNaN(currentProgress) && !isNaN(maxProgress) && this.state.type === StateType.Updating) {
							if (this.state.currentProgress !== currentProgress || this.state.maxProgress !== maxProgress) {
								this.setState(State.Updating(update, explicit, currentProgress, maxProgress));
							}
						}
					}
				} catch {
					// Progress file may not exist yet or be locked
				}

				await timeout(500);
			}
		};

		const cancelTimeout = new ProcessTimeRunOnceScheduler(() => {
			this.logService.warn('coderm-update#doApplyUpdate: polling timed out waiting for update to be ready');
			this.setState(State.Idle(getUpdateType(), 'Update did not complete within expected time'));
		}, 60 * 60 * 1000);

		cancelTimeout.schedule();
		poll().finally(() => {
			cancelTimeout.dispose();
			if (this.updateCancellationTokenSource === cts) {
				this.updateCancellationTokenSource = undefined;
			}
			cts.dispose();
		});
	}

	protected override async cancelPendingUpdate(): Promise<void> {
		if (!this.availableUpdate) {
			return;
		}

		this.updateCancellationTokenSource?.dispose(true);
		this.updateCancellationTokenSource = undefined;

		this.logService.trace('coderm-update#cancelPendingUpdate: cancelling pending update');
		const { updateProcess, updateFilePath, cancelFilePath } = this.availableUpdate;

		if (updateProcess && updateProcess.exitCode === null) {
			updateProcess.removeAllListeners();
			const exitPromise = new Promise<boolean>(resolve => updateProcess.once('exit', () => resolve(true)));

			if (cancelFilePath) {
				try {
					await pfs.Promises.writeFile(cancelFilePath, 'cancel');
				} catch (err) {
					this.logService.warn('coderm-update#cancelPendingUpdate: failed to write cancel file', err);
				}
			}

			const pid = updateProcess.pid;
			const exited = await Promise.race([exitPromise, timeout(30 * 1000).then(() => false)]);
			if (pid && !exited) {
				this.logService.trace('coderm-update#cancelPendingUpdate: killing process tree');
				await killTree(pid, true);
			}
		}

		await this.unlink(updateFilePath);
		await this.unlink(cancelFilePath);
		this.availableUpdate = undefined;
	}

	protected override doQuitAndInstall(): void {
		if ((this.state.type !== StateType.Ready && this.state.type !== StateType.Restarting) || !this.availableUpdate) {
			return;
		}

		this.logService.trace('coderm-update#quitAndInstall(): running raw#quitAndInstall()');

		if (this.availableUpdate.updateFilePath) {
			try {
				unlinkSync(this.availableUpdate.updateFilePath);
			} catch {
				// ignore
			}
		} else {
			spawn(this.availableUpdate.packagePath, ['/silent', '/log', '/mergetasks=runcode,!desktopicon,!quicklaunchicon'], {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore'],
				env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' }
			});
		}
	}

	protected override getUpdateType(): UpdateType {
		return getUpdateType();
	}

	override async _applySpecificUpdate(packagePath: string): Promise<void> {
		if (this.state.type !== StateType.Idle) {
			return;
		}

		const update: IUpdate = { version: 'unknown', productVersion: 'unknown' };

		this.setState(State.Downloading(update, true, false));
		this.availableUpdate = { packagePath };
		this.setState(State.Downloaded(update, true, false));

		const fastUpdatesEnabled = this.configurationService.getValue('update.enableWindowsBackgroundUpdates');
		if (fastUpdatesEnabled && this.productService.target === 'user') {
			this.doApplyUpdate();
		} else {
			this.setState(State.Ready(update, true, false));
		}
	}

	private async unlink(path: string | undefined): Promise<void> {
		if (path) {
			try {
				await unlink(path);
			} catch (err) {
				const error = err as NodeJS.ErrnoException;
				if (error && error.code === 'ENOENT') {
					return;
				}
				this.logService.warn(`coderm-update#unlink: failed to unlink ${basename(path)}`, err);
			}
		}
	}
}
