/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, IAction2Options, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { Direction } from '../../../../base/common/direction.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

// #region Configuration

/**
 * Coderm-specific configuration keys used by the resize-pane feature.
 */
const CodermSettings = {
	/** Pixel amount each resize command moves the pane border. */
	RESIZE_INCREMENT: 'coderm.workbench.editor.resizeIncrement',
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'coderm.resize',
	order: 100,
	title: localize('codermConfigurationTitle', 'Coderm'),
	type: 'object',
	properties: {
		[CodermSettings.RESIZE_INCREMENT]: {
			type: 'number',
			default: 60,
			minimum: 1,
			maximum: 500,
			scope: ConfigurationScope.APPLICATION,
			description: localize('coderm.workbench.editor.resizeIncrement',
				'The number of pixels to resize a pane by when using directional resize commands (coderm.workbench.editor.resizePaneUp/Down/Left/Right).'),
		},
	},
});

// #endregion

// #region Actions

/**
 * Base class for the four directional pane-resize actions exposed by Coderm.
 *
 * Each concrete subclass binds to a specific {@link Direction} and, when
 * executed, delegates to {@link IWorkbenchLayoutService.resizePaneBorder}.
 *
 * The pixel increment is read from the
 * `coderm.workbench.editor.resizeIncrement` setting (default `60`).
 */
abstract class BaseResizePaneAction extends Action2 {
	constructor(
		desc: Readonly<IAction2Options>,
		private readonly direction: Direction,
	) {
		super(desc);
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.resizePaneBorder(this.direction);
	}
}

/** Resizes the active pane border upward by the configured increment. */
class ResizePaneUpAction extends BaseResizePaneAction {
	static readonly ID = 'coderm.workbench.editor.resizePaneUp';
	constructor() {
		super({ id: ResizePaneUpAction.ID, title: localize2('coderm.workbench.editor.resizePaneUp', 'Resize Pane Up'), f1: true, category: Categories.View }, Direction.Up);
	}
}

/** Resizes the active pane border downward by the configured increment. */
class ResizePaneDownAction extends BaseResizePaneAction {
	static readonly ID = 'coderm.workbench.editor.resizePaneDown';
	constructor() {
		super({ id: ResizePaneDownAction.ID, title: localize2('coderm.workbench.editor.resizePaneDown', 'Resize Pane Down'), f1: true, category: Categories.View }, Direction.Down);
	}
}

/** Resizes the active pane border to the left by the configured increment. */
class ResizePaneLeftAction extends BaseResizePaneAction {
	static readonly ID = 'coderm.workbench.editor.resizePaneLeft';
	constructor() {
		super({ id: ResizePaneLeftAction.ID, title: localize2('coderm.workbench.editor.resizePaneLeft', 'Resize Pane Left'), f1: true, category: Categories.View }, Direction.Left);
	}
}

/** Resizes the active pane border to the right by the configured increment. */
class ResizePaneRightAction extends BaseResizePaneAction {
	static readonly ID = 'coderm.workbench.editor.resizePaneRight';
	constructor() {
		super({ id: ResizePaneRightAction.ID, title: localize2('coderm.workbench.editor.resizePaneRight', 'Resize Pane Right'), f1: true, category: Categories.View }, Direction.Right);
	}
}

registerAction2(ResizePaneUpAction);
registerAction2(ResizePaneDownAction);
registerAction2(ResizePaneLeftAction);
registerAction2(ResizePaneRightAction);

// #endregion
