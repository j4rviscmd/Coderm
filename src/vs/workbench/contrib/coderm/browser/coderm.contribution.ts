/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point for Coderm-specific contributions.
 *
 * Side-effect imports register:
 * - Directional pane-resize commands (`coderm.workbench.editor.resizeIncrement`)
 * - Auto-maximize on focus configuration (`coderm.workbench.editor.autoMaximizeOnFocus`)
 */
import './resizePaneActions.js';
import './autoMaximizeActions.js';
