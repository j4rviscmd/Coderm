/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { RemoteNameContext } from '../../../common/contextkeys.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IListService } from '../../../../platform/list/browser/listService.js';
import { getResourceForCommand, IExplorerService } from '../../files/browser/files.js';
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ResourceFileEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { URI } from '../../../../base/common/uri.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { Schemas } from '../../../../base/common/network.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IsWebContext } from '../../../../platform/contextkey/common/contextkeys.js';

const CodermCategory = localize2('coderm', 'Coderm');

/** Storage key for persisting the last user-selected download directory across sessions. */
const LAST_USED_DOWNLOAD_PATH_STORAGE_KEY = 'workbench.explorer.downloadPath';

/**
 * Resolves the default URI for the save dialog based on the remote file stat.
 *
 * If a previously used download path is stored in application storage, it is
 * reused. Otherwise the platform default folder/file path is used. In both
 * cases the remote file or directory name is appended as the suggested name.
 *
 * @param stat - The resolved file stat of the remote resource to download.
 * @param storageService - Storage service used to retrieve the last used download path.
 * @param fileDialogService - File dialog service used to determine the platform default path.
 * @returns A URI representing the default location and name for the save dialog.
 */
async function resolveDefaultUri(
	stat: IFileStat,
	storageService: IStorageService,
	fileDialogService: IFileDialogService
): Promise<URI> {
	const lastUsedDownloadPath = storageService.get(LAST_USED_DOWNLOAD_PATH_STORAGE_KEY, StorageScope.APPLICATION);
	if (lastUsedDownloadPath) {
		return joinPath(URI.file(lastUsedDownloadPath), stat.name);
	}

	const basePath = stat.isDirectory
		? await fileDialogService.defaultFolderPath(Schemas.file)
		: await fileDialogService.defaultFilePath(Schemas.file);
	return joinPath(basePath, stat.name);
}

/**
 * Action that downloads a remote file or directory to the local filesystem.
 *
 * Registered as a command-palette action (`coderm.downloadFile`). It is only
 * available when the editor is connected to a remote (not web) and the
 * selected resource does not already use the `file` scheme.
 *
 * The action resolves the selected resource, prompts the user with a save
 * dialog, and uses a bulk file edit to copy the remote resource to the
 * chosen local destination.
 */
class DownloadFileAction extends Action2 {
	/** Unique command identifier for this action. */
	static readonly ID = 'coderm.downloadFile';
	constructor() {
		super({
			id: DownloadFileAction.ID,
			title: localize2('coderm.downloadFile', 'Download...'),
			f1: true,
			category: CodermCategory,
			precondition: ContextKeyExpr.and(
				IsWebContext.toNegated(),
				RemoteNameContext.notEqualsTo('')
			)
		});
	}

	/**
	 * Executes the download action.
	 *
	 * Resolves the resource from the active editor or explorer selection,
	 * skips local (`file` scheme) resources, resolves the remote file stat,
	 * shows a save dialog, persists the chosen directory for future use,
	 * and performs the download via a bulk edit.
	 *
	 * @param accessor - Service accessor for dependency injection.
	 * @param args - Optional arguments; the first element may contain the target resource.
	 */
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const listService = accessor.get(IListService);
		const explorerService = accessor.get(IExplorerService);
		const fileService = accessor.get(IFileService);
		const fileDialogService = accessor.get(IFileDialogService);
		const storageService = accessor.get(IStorageService);
		const notificationService = accessor.get(INotificationService);

		const resource = getResourceForCommand(args[0], editorService, listService);
		if (!resource || resource.scheme === Schemas.file) {
			return;
		}

		let stat;
		try {
			stat = await fileService.resolve(resource);
		} catch (error) {
			notificationService.error(error);
			return;
		}

		const defaultUri = await resolveDefaultUri(stat, storageService, fileDialogService);

		const destination = await fileDialogService.showSaveDialog({
			availableFileSystems: [Schemas.file],
			saveLabel: localize('downloadButton', "Download"),
			title: localize('chooseWhereToDownload', "Choose Where to Download"),
			defaultUri
		});

		if (!destination) {
			return;
		}

		storageService.store(LAST_USED_DOWNLOAD_PATH_STORAGE_KEY, dirname(destination).fsPath, StorageScope.APPLICATION, StorageTarget.MACHINE);

		try {
			await explorerService.applyBulkEdit(
				[new ResourceFileEdit(resource, destination, { overwrite: true, copy: true })],
				{
					undoLabel: localize('downloadBulkEdit', "Download {0}", stat.name),
					progressLabel: localize('downloadingBulkEdit', "Downloading {0}", stat.name),
					progressLocation: ProgressLocation.Window
				}
			);
		} catch (error) {
			notificationService.error(error);
		}
	}
}

registerAction2(DownloadFileAction);
