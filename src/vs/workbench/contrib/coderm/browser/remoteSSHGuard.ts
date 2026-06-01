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
 * Extensions blocked in Coderm because they depend on proprietary
 * VS Code infrastructure not available in this fork, or because they
 * require gray-zone workarounds that have been removed.
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
	'ms-python.vscode-pylance',
]);

/** Per-extension alternative suggestions; missing entries fall back to DEFAULT_ALTERNATIVE. */
const ALTERNATIVE_EXTENSIONS: Record<string, typeof DEFAULT_ALTERNATIVE> = {
	'ms-python.vscode-pylance': {
		id: 'detachhead.basedpyright',
		message: localize('coderm.pylanceGuard.message', "PylanceはCodermではサポートされていません。代わりに BasedPyright をご利用ください。"),
		label: localize('coderm.pylanceGuard.openAlternative', "BasedPyright を確認する"),
	},
};

/** Default alternative for Microsoft Remote extensions. */
const DEFAULT_ALTERNATIVE = {
	id: 'jeanp413.open-remote-ssh',
	message: localize('coderm.remoteSSHGuard.message', "Microsoft Remote系拡張機能はCodermではサポートされていません。代わりに Open Remote SSH をご利用ください。"),
	label: localize('coderm.remoteSSHGuard.openAlternative', "Open Remote SSH を確認する"),
};

/**
 * Workbench contribution that detects blocked extensions and shows a
 * one-time warning notification suggesting an open-source alternative.
 */
export class RemoteSSHGuardContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.coderm.remoteSSHGuard';

	/** Whether the warning notification has already been shown (once-only). */
	private notified = false;

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

		const blocked = this.extensionsWorkbenchService.local.find(
			e => BLOCKED_EXTENSIONS.has(e.identifier.id.toLowerCase())
				&& e.enablementState === EnablementState.DisabledByAllowlist
		);

		if (!blocked) {
			return;
		}

		this.notified = true;
		const id = blocked.identifier.id.toLowerCase();
		const alt = ALTERNATIVE_EXTENSIONS[id] ?? DEFAULT_ALTERNATIVE;
		this.notificationService.prompt(
			Severity.Warning,
			alt.message,
			[{
				label: alt.label,
				run: () => this.commandService.executeCommand('extension.open', alt.id),
			}],
			{ neverShowAgain: { id: 'coderm.remoteSSHGuard.neverShow', isSecondary: true } },
		);
	}
}

registerWorkbenchContribution2(RemoteSSHGuardContribution.ID, RemoteSSHGuardContribution, WorkbenchPhase.AfterRestored);
