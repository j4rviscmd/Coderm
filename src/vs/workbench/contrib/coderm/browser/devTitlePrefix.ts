/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../services/environment/browser/environmentService.js';
import { ITitleService } from '../../../services/title/browser/titleService.js';

/**
 * Workbench contribution that prepends a `DEV@` prefix to the window title
 * when running in development mode (i.e. `isBuilt === false`). In production
 * builds the prefix is not applied, so the title remains unchanged.
 *
 * Registered in the {@link WorkbenchPhase.AfterRestored} phase to ensure the
 * title service is fully initialized before the prefix is set.
 */
export class DevTitlePrefixContribution {

	/** Unique identifier used for lazy workbench contribution registration. */
	static readonly ID = 'workbench.contrib.devTitlePrefix';

	/**
	 * @param environmentService - Provides the `isBuilt` flag that distinguishes
	 *   development from production environments.
	 * @param titleService - The title service used to update the window title prefix.
	 */
	constructor(
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
		@ITitleService titleService: ITitleService
	) {
		if (!environmentService.isBuilt) {
			titleService.updateProperties({ prefix: 'DEV@' });
		}
	}
}

registerWorkbenchContribution2(DevTitlePrefixContribution.ID, DevTitlePrefixContribution, WorkbenchPhase.AfterRestored);