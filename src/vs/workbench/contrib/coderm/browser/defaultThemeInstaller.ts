/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Default theme installer for Coderm.
 *
 * On first application launch, installs the Solarized Deep theme extension
 * from the marketplace and applies it as the default color theme.
 *
 * Conditions for activation:
 * - Application storage is new (first launch)
 * - `workbench.colorTheme` has no user-configured value
 * - The installation has not been attempted before (storage flag)
 *
 * Failures (e.g., network errors) are silently logged without user-facing
 * notifications to avoid disrupting the first-run experience.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IExtensionGalleryService } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IWorkbenchExtensionManagementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

const EXTENSION_ID = 'j4rviscmd.solarized-deep';
const THEME_SETTINGS_ID = 'Solarized Deep';
const STORAGE_KEY = 'coderm.defaultTheme.installed';

export class DefaultThemeInstallerContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.coderm.defaultThemeInstaller';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IWorkbenchExtensionManagementService private readonly extensionManagementService: IWorkbenchExtensionManagementService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._installDefaultTheme();
	}

	private async _installDefaultTheme(): Promise<void> {
		// Guard: only on first application launch
		if (!this.storageService.isNew(StorageScope.APPLICATION)) {
			return;
		}

		// Guard: already attempted installation
		if (this.storageService.getBoolean(STORAGE_KEY, StorageScope.APPLICATION)) {
			return;
		}

		// Guard: user has already configured a color theme
		const themeInspect = this.configurationService.inspect<string>('workbench.colorTheme');
		if (themeInspect.userValue !== undefined) {
			return;
		}

		// Mark as attempted (even if installation fails, don't retry)
		this.storageService.store(STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);

		try {
			// Fetch extension from gallery
			const extensions = await this.galleryService.getExtensions([{ id: EXTENSION_ID }], CancellationToken.None);
			if (extensions.length === 0) {
				this.logService.warn(`[Coderm] Default theme extension '${EXTENSION_ID}' not found in gallery.`);
				return;
			}

			// Install the extension
			await this.extensionManagementService.installFromGallery(extensions[0]);
			this.logService.info(`[Coderm] Default theme extension '${EXTENSION_ID}' installed successfully.`);

			// Write the theme setting directly to user settings.
			// The theme registry may not have the extension's theme registered yet
			// (extension host restart required), so we write the setting value and
			// let the theme service pick it up once the extension is fully loaded.
			// When the theme registry fires onDidChange, restoreColorTheme() is
			// called automatically, which reads this setting and applies the theme.
			await this.configurationService.updateValue('workbench.colorTheme', THEME_SETTINGS_ID, ConfigurationTarget.USER);
			this.logService.info(`[Coderm] Default color theme setting written: '${THEME_SETTINGS_ID}'.`);
		} catch (error) {
			this.logService.warn(`[Coderm] Failed to install default theme: ${error}`);
		}
	}
}

registerWorkbenchContribution2(DefaultThemeInstallerContribution.ID, DefaultThemeInstallerContribution, WorkbenchPhase.AfterRestored);
