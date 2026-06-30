/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { EditorActivation } from '../../../../platform/editor/common/editor.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorInputWithOptions, isEditorInputWithOptions, IUntypedEditorInput, isEditorInput, EditorInputCapabilities } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, GroupsOrder, preferredSideBySideGroupDirection, IEditorGroupsService, IModalEditorPart } from './editorGroupsService.js';
import { AUX_WINDOW_GROUP, AUX_WINDOW_GROUP_TYPE, MODAL_GROUP, MODAL_GROUP_TYPE, PreferredGroup, SIDE_GROUP } from './editorService.js';
// --- Coderm start: Issue #219 ---
import { Schemas } from '../../../../base/common/network.js';
// --- Coderm end ---

type FindGroupResult = Promise<[IEditorGroup, EditorActivation | undefined]> | [IEditorGroup, EditorActivation | undefined];

/**
 * Finds the target `IEditorGroup` given the instructions provided
 * that is best for the editor and matches the preferred group if
 * possible.
 */
export function findGroup(accessor: ServicesAccessor, editor: IUntypedEditorInput, preferredGroup: Exclude<PreferredGroup, AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE> | undefined): FindGroupResult;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions, preferredGroup: Exclude<PreferredGroup, AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE> | undefined): FindGroupResult;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: Exclude<PreferredGroup, AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE> | undefined): FindGroupResult;
export function findGroup(accessor: ServicesAccessor, editor: IUntypedEditorInput, preferredGroup: AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE): Promise<[IEditorGroup, EditorActivation | undefined]>;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions, preferredGroup: AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE): Promise<[IEditorGroup, EditorActivation | undefined]>;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE): Promise<[IEditorGroup, EditorActivation | undefined]>;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): FindGroupResult;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): FindGroupResult {
	const editorGroupService = accessor.get(IEditorGroupsService);
	const configurationService = accessor.get(IConfigurationService);

	const group = doFindGroup(editor, preferredGroup, editorGroupService, configurationService);
	if (group instanceof Promise) {
		return group.then(group => handleGroupResult(group, editor, preferredGroup, editorGroupService, configurationService));
	}

	return handleGroupResult(group, editor, preferredGroup, editorGroupService, configurationService);
}

function handleGroupResult(group: IEditorGroup, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined, editorGroupService: IEditorGroupsService, configurationService: IConfigurationService): FindGroupResult {
	const modalEditorPart = editorGroupService.activeModalEditorPart;
	const modalEditorMode = configurationService.getValue<string>('workbench.editor.useModal');
	const editorInput = isEditorInputWithOptions(editor) ? editor.editor : isEditorInput(editor) ? editor : undefined;
	const requiresModal = editorInput instanceof EditorInput && editorInput.hasCapability(EditorInputCapabilities.RequiresModal);
	// Why: Coderm lets users summon an EMPTY modal editor pane
	// (coderm.workbench.modalEditor.open) and open editors into it via Quick
	// Open, the terminal, etc. By default (useModal !== 'all') upstream closes
	// the modal and redirects the editor to the main part (see
	// handleModalEditorPart below). When coderm.modal.captureContent is enabled
	// we skip that redirect so the incoming editor flows into the modal's active
	// group. RequiresModal editors (e.g. Settings UI) stay protected by the
	// requiresModal check above, so they are never affected.
	const codermCaptureContent = configurationService.getValue<boolean>('coderm.modal.captureContent') !== false;
	if (modalEditorPart && preferredGroup !== MODAL_GROUP && modalEditorMode !== 'all' && !requiresModal && !codermCaptureContent) {
		// Only allow to open in modal group if MODAL_GROUP is explicitly requested
		// or when the setting is configured to open all editors modal or when the
		// editor has the RequiresModal capability.
		return handleModalEditorPart(group, editor, modalEditorPart, editorGroupService, preferredGroup);
	}

	return handleGroupActivation(group, editor, preferredGroup, editorGroupService);
}

async function handleModalEditorPart(group: IEditorGroup, editor: EditorInputWithOptions | IUntypedEditorInput, modalEditorPart: IModalEditorPart, editorGroupService: IEditorGroupsService, preferredGroup: PreferredGroup | undefined): Promise<[IEditorGroup, EditorActivation | undefined]> {
	const options = editor.options;

	// If the resolved group is part of the modal, redirect
	// to the main window active group instead
	if (modalEditorPart.groups.some(modalGroup => modalGroup.id === group.id)) {
		group = editorGroupService.mainPart.activeGroup;
	}

	// Try to close the modal editor part unless preserveFocus is set
	if (!options?.preserveFocus) {
		await modalEditorPart.close();
	}

	return handleGroupActivation(group, editor, preferredGroup, editorGroupService);
}

function handleGroupActivation(group: IEditorGroup, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined, editorGroupService: IEditorGroupsService): [IEditorGroup, EditorActivation | undefined] {

	// Resolve editor activation strategy
	let activation: EditorActivation | undefined = undefined;
	if (
		editorGroupService.activeGroup !== group && 		// only if target group is not already active
		editor.options && !editor.options.inactive &&		// never for inactive editors
		editor.options.preserveFocus &&						// only if preserveFocus
		typeof editor.options.activation !== 'number' &&	// only if activation is not already defined (either true or false)
		preferredGroup !== SIDE_GROUP						// never for the SIDE_GROUP
	) {
		// If the resolved group is not the active one, we typically
		// want the group to become active. There are a few cases
		// where we stay away from encorcing this, e.g. if the caller
		// is already providing `activation`.
		//
		// Specifically for historic reasons we do not activate a
		// group is it is opened as `SIDE_GROUP` with `preserveFocus:true`.
		// repeated Alt-clicking of files in the explorer always open
		// into the same side group and not cause a group to be created each time.
		activation = EditorActivation.ACTIVATE;
	}

	return [group, activation];
}

function doFindGroup(input: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined, editorGroupService: IEditorGroupsService, configurationService: IConfigurationService): Promise<IEditorGroup> | IEditorGroup {
	let group: Promise<IEditorGroup> | IEditorGroup | undefined;
	const editor = isEditorInputWithOptions(input) ? input.editor : input;
	const options = input.options;

	// Group: Force modal if the editor has the RequiresModal capability
	if (isEditorInput(editor) && editor.hasCapability(EditorInputCapabilities.RequiresModal)) {
		group = editorGroupService.createModalEditorPart(options?.modal)
			.then(part => part.activeGroup);
	}

	// Group: Instance of Group
	else if (preferredGroup && typeof preferredGroup !== 'number') {
		group = preferredGroup;
	}

	// Group: Specific Group
	else if (typeof preferredGroup === 'number' && preferredGroup >= 0) {
		group = editorGroupService.getGroup(preferredGroup);
	}

	// Group: Side by Side
	else if (preferredGroup === SIDE_GROUP) {
		const direction = preferredSideBySideGroupDirection(configurationService);

		let candidateGroup = editorGroupService.findGroup({ direction });
		if (!candidateGroup || isGroupLockedForEditor(candidateGroup, editor)) {
			// Create new group either when the candidate group
			// is locked or was not found in the direction
			candidateGroup = editorGroupService.addGroup(editorGroupService.activeGroup, direction);
		}

		group = candidateGroup;
	}

	// Group: Aux Window
	else if (preferredGroup === AUX_WINDOW_GROUP) {
		group = editorGroupService.createAuxiliaryEditorPart(options?.auxiliary)
			.then(group => group.activeGroup);
	}

	// Group: Modal (gated behind a setting)
	else if (preferredGroup === MODAL_GROUP && configurationService.getValue<string>('workbench.editor.useModal') !== 'off') {
		group = editorGroupService.createModalEditorPart(options?.modal)
			.then(part => part.activeGroup);
	}

	// Group: Unspecified without a specific index to open
	else if (!options || typeof options.index !== 'number') {
		const groupsByLastActive = editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);

		// Respect option to reveal an editor if it is already visible in any group
		if (options?.revealIfVisible) {
			for (const lastActiveGroup of groupsByLastActive) {
				if (isActive(lastActiveGroup, editor)) {
					group = lastActiveGroup;
					break;
				}
			}
		}

		// Respect option to reveal an editor if it is open (not necessarily visible)
		// Still prefer to reveal an editor in a group where the editor is active though.
		// We also try to reveal an editor if it has the `ForceReveal` or `Singleton`
		// capability which indicates that editor prefers to be revealed.
		if (!group) {
			if (options?.revealIfOpened || configurationService.getValue<boolean>('workbench.editor.revealIfOpen') || (isEditorInput(editor) && (editor.hasCapability(EditorInputCapabilities.ForceReveal) || editor.hasCapability(EditorInputCapabilities.Singleton)))) {
				let groupWithInputActive: IEditorGroup | undefined = undefined;
				let groupWithInputOpened: IEditorGroup | undefined = undefined;

				for (const group of groupsByLastActive) {
					if (isOpened(group, editor)) {
						if (!groupWithInputOpened) {
							groupWithInputOpened = group;
						}

						if (!groupWithInputActive && group.isActive(editor)) {
							groupWithInputActive = group;
						}
					}

					if (groupWithInputOpened && groupWithInputActive) {
						break; // we found all groups we wanted
					}
				}

				// Prefer a target group where the input is visible
				group = groupWithInputActive || groupWithInputOpened;
			}
		}
	}

	// Force modal editor part: redirect to the modal group when setting is 'on'
	if (!group && configurationService.getValue<string>('workbench.editor.useModal') === 'all') {
		group = editorGroupService.createModalEditorPart(options?.modal)
			.then(part => part.activeGroup);
	}

	// Fallback to active group if target not valid but avoid
	// locked editor groups unless editor is already opened there
	if (!group) {
		let candidateGroup = editorGroupService.activeGroup;

		// Locked group: find the next non-locked group
		// going up the neigbours of the group or create
		// a new group otherwise
		if (isGroupLockedForEditor(candidateGroup, editor)) {
			for (const group of editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
				if (isGroupLockedForEditor(group, editor)) {
					continue;
				}

				candidateGroup = group;
				break;
			}

			if (isGroupLockedForEditor(candidateGroup, editor)) {
				// Group is still locked, so we have to create a new
				// group to the side of the candidate group
				group = editorGroupService.addGroup(candidateGroup, preferredSideBySideGroupDirection(configurationService));
			} else {
				group = candidateGroup;
			}
		}

		// Non-locked group: take as is
		else {
			group = candidateGroup;
		}
	}

	// --- Coderm start: terminal/text editor separation (Issue #219) ---
	// Why: tmux-like pane model — terminal and text editors never share a group
	// via implicit open paths, and each group holds at most one terminal editor.
	// Quick Open, the terminal editor service, and every openEditor(ACTIVE_GROUP)
	// caller funnel through this fallback, so a single hook covers both
	// directions. Explicit paths (SIDE_GROUP, AUX_WINDOW_GROUP, MODAL_GROUP,
	// numeric GroupIdentifier, IEditorGroup) resolve `group` earlier above and
	// never reach here, satisfying the "explicit user action is exempt" rule.
	const codermSeparate = configurationService.getValue<boolean>('coderm.workbench.editor.separateTerminalEditors') !== false;
	const codermSingleTerminal = configurationService.getValue<boolean>('coderm.workbench.editor.singleTerminalEditorPerGroup') !== false;
	if (!(group instanceof Promise) && (codermSeparate || codermSingleTerminal)) {
		const codermOptions = { separate: codermSeparate, singleTerminal: codermSingleTerminal };
		if (codermShouldAvoidGroup(group, editor, codermOptions)) {
			const alternative = codermFindAcceptableGroup(
				editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE),
				editor,
				group,
				codermOptions
			);
			group = alternative ?? editorGroupService.addGroup(group, preferredSideBySideGroupDirection(configurationService));
		}
	}
	// --- Coderm end ---

	return group;
}

function isGroupLockedForEditor(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput): boolean {
	if (!group.isLocked) {
		// only relevant for locked editor groups
		return false;
	}

	if (isOpened(group, editor)) {
		// special case: the locked group contains
		// the provided editor. in that case we do not want
		// to open the editor in any different group.
		return false;
	}

	// group is locked for this editor
	return true;
}

function isActive(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput): boolean {
	if (!group.activeEditor) {
		return false;
	}

	return group.activeEditor.matches(editor);
}

function isOpened(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput): boolean {
	for (const typedEditor of group.editors) {
		if (typedEditor.matches(editor)) {
			return true;
		}
	}

	return false;
}

// --- Coderm start: Issue #219 helpers ---
// Why: these implement the terminal/text editor separation policies
// (coderm.workbench.editor.separateTerminalEditors and
// coderm.workbench.editor.singleTerminalEditorPerGroup). They live inline in
// this common-layer file rather than in contrib/coderm because VSCode's
// layering rules forbid services/common from importing contrib/*.

function codermIsTerminalEditor(editor: EditorInput | IUntypedEditorInput): boolean {
	const resource = (editor as { resource?: { scheme?: string } }).resource;

	return resource?.scheme === Schemas.vscodeTerminal;
}

interface ICodermEditorGroupPolicyOptions {
	readonly separate: boolean;
	readonly singleTerminal: boolean;
}

function codermShouldAvoidGroup(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput, options: ICodermEditorGroupPolicyOptions): boolean {
	if (group.editors.length === 0) {
		return false;
	}

	const editorIsTerminal = codermIsTerminalEditor(editor);
	const groupHasTerminal = group.editors.some(e => codermIsTerminalEditor(e));
	const groupHasText = group.editors.some(e => !codermIsTerminalEditor(e));

	if (editorIsTerminal) {
		// Opening a terminal: avoid text groups (separation) and existing
		// terminal groups (single-per-group).
		if (options.separate && groupHasText) {
			return true;
		}
		if (options.singleTerminal && groupHasTerminal) {
			return true;
		}
	} else {
		// Opening a text editor: avoid terminal groups (separation) only.
		if (options.separate && groupHasTerminal) {
			return true;
		}
	}

	return false;
}

function codermFindAcceptableGroup(groups: readonly IEditorGroup[], editor: EditorInput | IUntypedEditorInput, excludeGroup: IEditorGroup, options: ICodermEditorGroupPolicyOptions): IEditorGroup | undefined {
	for (const group of groups) {
		if (group === excludeGroup) {
			continue;
		}

		if (!codermShouldAvoidGroup(group, editor, options)) {
			return group;
		}
	}

	return undefined;
}
// --- Coderm end ---
