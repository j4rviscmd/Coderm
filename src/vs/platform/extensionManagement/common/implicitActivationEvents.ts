/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from '../../../base/common/collections.js';
import { onUnexpectedError } from '../../../base/common/errors.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../extensions/common/extensions.js';

/**
 * A function that maps extension contribution values to their corresponding
 * implicit activation event strings (e.g. `onCommand:...`, `onLanguage:...`).
 *
 * @typeParam T - The concrete contribution type for a given extension point.
 */
export interface IActivationEventsGenerator<T> {
	(contributions: readonly T[]): Iterable<string>;
}

/**
 * Manages implicit activation events for extensions.
 *
 * VS Code extensions declare activation events in `package.json`, but certain
 * extension contributions (e.g. commands, languages, views) implicitly trigger
 * activation. This class collects those implicit events by iterating registered
 * generators for each extension point found in an extension's `contributes` field.
 *
 * Must be used on the **renderer process** where all extension points and their
 * generators are known.
 */
export class ImplicitActivationEventsImpl {

	/** Maps extension point names to their implicit activation event generators. */
	private readonly _generators = new Map<string, IActivationEventsGenerator<unknown>>();

	/** Per-extension cache of resolved activation event arrays. */
	private readonly _cache = new WeakMap<IExtensionDescription, string[]>();

	/**
	 * Coderm: extension IDs that should activate eagerly (treated as `*`).
	 * Populated from the `coderm.extensions.eagerActivation` setting.
	 */
	private _eagerExtensions = new Set<string>();

	/**
	 * Coderm: Register extension IDs whose activation events should include `*`,
	 * forcing eager (startup) activation regardless of their package.json declaration.
	 *
	 * The cache is intentionally not cleared here because `IExtensionDescription`
	 * objects are stable for a given extension lifecycle. Callers that need a
	 * fresh read (e.g. after a setting change) should invalidate via a new
	 * extension scan rather than expecting this method to re-evaluate cached
	 * entries.
	 */
	public setEagerExtensions(ids: ReadonlySet<string>): void {
		this._eagerExtensions = new Set(ids);
	}

	/**
	 * Register a generator that produces implicit activation events for a given
	 * extension point.
	 *
	 * @param extensionPointName - The `contributes` key (e.g. `"commands"`, `"languages"`).
	 * @param generator - Function that receives the contribution values and returns
	 *   the corresponding activation event strings.
	 */
	public register<T>(extensionPointName: string, generator: IActivationEventsGenerator<T>): void {
		this._generators.set(extensionPointName, generator as IActivationEventsGenerator<unknown>);
	}

	/**
	 * This can run correctly only on the renderer process because that is the only place
	 * where all extension points and all implicit activation events generators are known.
	 */
	public readActivationEvents(extensionDescription: IExtensionDescription): string[] {
		if (!this._cache.has(extensionDescription)) {
			this._cache.set(extensionDescription, this._readActivationEvents(extensionDescription));
		}
		return this._cache.get(extensionDescription)!;
	}

	/**
	 * This can run correctly only on the renderer process because that is the only place
	 * where all extension points and all implicit activation events generators are known.
	 */
	public createActivationEventsMap(extensionDescriptions: IExtensionDescription[]): { [extensionId: string]: string[] } {
		const result: { [extensionId: string]: string[] } = Object.create(null);
		for (const extensionDescription of extensionDescriptions) {
			const activationEvents = this.readActivationEvents(extensionDescription);
			if (activationEvents.length > 0) {
				result[ExtensionIdentifier.toKey(extensionDescription.identifier)] = activationEvents;
			}
		}
		return result;
	}

	/**
	 * Build the full activation event list for a single extension.
	 *
	 * Combines events from:
	 * 1. `activationEvents` in `package.json` (with `onUri` expansion)
	 * 2. Implicit events from registered generators for each contribution key
	 * 3. Coderm: `*` injected for extensions listed in {@link _eagerExtensions}
	 *
	 * Non-host extensions (no `main`/`browser`) get an empty array.
	 */
	private _readActivationEvents(desc: IExtensionDescription): string[] {
		if (typeof desc.main === 'undefined' && typeof desc.browser === 'undefined') {
			return [];
		}

		const activationEvents: string[] = (Array.isArray(desc.activationEvents) ? desc.activationEvents.slice(0) : []);

		for (let i = 0; i < activationEvents.length; i++) {
			// TODO@joao: there's no easy way to contribute this
			if (activationEvents[i] === 'onUri') {
				activationEvents[i] = `onUri:${ExtensionIdentifier.toKey(desc.identifier)}`;
			}
		}

		if (!desc.contributes) {
			// no implicit activation events
			return activationEvents;
		}

		for (const extPointName in desc.contributes) {
			const generator = this._generators.get(extPointName);
			if (!generator) {
				// There's no generator for this extension point
				continue;
			}
			const contrib = (desc.contributes as IStringDictionary<unknown>)[extPointName];
			const contribArr = Array.isArray(contrib) ? contrib : [contrib];
			try {
				activationEvents.push(...generator(contribArr));
			} catch (err) {
				onUnexpectedError(err);
			}
		}

		// Coderm: inject `*` for eager extensions to force startup activation
		if (this._eagerExtensions.has(ExtensionIdentifier.toKey(desc.identifier)) && !activationEvents.includes('*')) {
			activationEvents.push('*');
		}

		return activationEvents;
	}
}

/**
 * Singleton instance shared across the renderer process.
 * Extension points register their generators here during startup.
 */
export const ImplicitActivationEvents: ImplicitActivationEventsImpl = new ImplicitActivationEventsImpl();
