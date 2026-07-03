/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { NEW_UNTITLED_FILE_COMMAND_ID } from '../../files/browser/fileConstants.js';

/**
 * Action that opens the workspace root's README.md, falling back to a new
 * untitled file when it is absent.
 *
 * Registered as a command-palette action (`coderm.workbench.openReadme`).
 */
class OpenReadmeAction extends Action2 {
	/** Unique command identifier for this action. */
	static readonly ID = 'coderm.workbench.openReadme';

	constructor() {
		super({
			id: OpenReadmeAction.ID,
			title: localize2('coderm.workbench.openReadme', 'Open README'),
			f1: true,
			category: Categories.File,
		});
	}

	/**
	 * Executes the open README action.
	 *
	 * Best-effort resolves the first workspace folder's README.md: if present
	 * it is opened, otherwise the upstream "New Untitled Text File" command is
	 * invoked.
	 *
	 * @param accessor - Service accessor for dependency injection.
	 */
	override async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);
		const commandService = accessor.get(ICommandService);

		// Constraint: only the first workspace folder is consulted to keep
		// resolution cheap and predictable; multi-root workspaces do not scan
		// every folder (decided trade-off: simplicity over coverage).
		const workspaceRoot = workspaceContextService.getWorkspace().folders[0]?.uri;
		const readmeUri = workspaceRoot ? URI.joinPath(workspaceRoot, 'README.md') : undefined;

		// Why executeCommand instead of re-implementing: delegating to the real
		// upstream command means behavior changes (e.g. language/viewType args)
		// are tracked for free, and the no-workspace / missing-README cases
		// share a single fallback path.
		if (!readmeUri || !await fileService.exists(readmeUri)) {
			await commandService.executeCommand(NEW_UNTITLED_FILE_COMMAND_ID);
			return;
		}

		await editorService.openEditor({
			resource: readmeUri,
			options: { pinned: true },
		});
	}
}

registerAction2(OpenReadmeAction);
