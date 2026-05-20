/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { EnablementState } from '../../../services/extensionManagement/common/extensionManagement.js';
import { localize } from '../../../../nls.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';

/**
 * Microsoft Remote extensions that are blocked in Coderm because they depend
 * on proprietary VS Code server infrastructure not available in this fork.
 * These extensions are disabled via the `extensions.allowed` configuration
 * and this guard notifies the user when any of them are detected.
 */
const BLOCKED_EXTENSIONS = new Set([
	'ms-vscode-remote.remote-ssh',
	'ms-vscode-remote.remote-ssh-edit',
	'ms-vscode.remote-explorer',
	'ms-vscode-remote.remote-containers',
	'ms-vscode-remote.remote-wsl',
	'ms-vscode.remote-tunnels',
]);

/** Extension ID of the recommended open-source alternative for Remote SSH. */
const ALTERNATIVE_EXTENSION_ID = 'jeanp413.open-remote-ssh';

/**
 * Workbench contribution that detects blocked Microsoft Remote extensions and
 * shows a one-time warning notification suggesting an open-source alternative.
 *
 * Blocked extensions (e.g. Remote SSH, Remote Containers) rely on proprietary
 * VS Code server infrastructure that is not available in Coderm.  This guard
 * listens for extension state changes so it can notify the user as soon as a
 * blocked extension is discovered with {@link EnablementState.DisabledByAllowlist}.
 */
export class RemoteSSHGuardContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.coderm.remoteSSHGuard';

	/** Whether the warning notification has already been shown (once-only). */
	private notified = false;

	/**
	 * @param notificationService - Used to display the warning prompt.
	 * @param extensionsWorkbenchService - Provides access to local extensions and change events.
	 * @param commandService - Used to open the alternative extension detail page.
	 */
	constructor(
		@INotificationService private readonly notificationService: INotificationService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this.check();
		this._register(this.extensionsWorkbenchService.onChange(() => this.check()));
	}

	/**
	 * Checks local extensions for any blocked extension that has been disabled
	 * by the allowlist.  When one is found, shows a one-time notification with
	 * an action to open the alternative extension page.
	 */
	private check(): void {
		if (this.notified) {
			return;
		}

		const hasBlocked = this.extensionsWorkbenchService.local.some(
			e => BLOCKED_EXTENSIONS.has(e.identifier.id.toLowerCase())
				&& e.enablementState === EnablementState.DisabledByAllowlist
		);

		if (!hasBlocked) {
			return;
		}

		this.notified = true;
		this.notificationService.prompt(
			Severity.Warning,
			// allow-any-unicode-next-line
			localize('coderm.remoteSSHGuard.message', "Microsoft Remote系拡張機能はCodermではサポートされていません。代わりに Open Remote SSH をご利用ください。"),
			[{
				// allow-any-unicode-next-line
				label: localize('coderm.remoteSSHGuard.openAlternative', "Open Remote SSH を確認する"),
				run: () => this.commandService.executeCommand('extension.open', ALTERNATIVE_EXTENSION_ID),
			}],
			{ neverShowAgain: { id: 'coderm.remoteSSHGuard.neverShow', isSecondary: true } },
		);
	}
}

registerWorkbenchContribution2(RemoteSSHGuardContribution.ID, RemoteSSHGuardContribution, WorkbenchPhase.AfterRestored);
