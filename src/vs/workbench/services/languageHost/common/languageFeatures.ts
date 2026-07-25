/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Coderm: Language feature providers backed by the native Language Host. Registers
// documentSymbol and foldingRange providers for the configured language set. Filtering is
// done via the language selector (the provider only runs for models whose language matches).

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { combinedDisposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../editor/common/model.js';
import {
	DocumentSymbol,
	DocumentSymbolProvider,
	FoldingContext,
	FoldingRange,
	FoldingRangeProvider,
	SymbolKind,
} from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILanguageHostService } from './languageHost.js';

// Shapes returned by the Rust host (camelCase, matching the renderer's DocumentSymbol/IRange).
interface DocumentSymbolResponse {
	name: string;
	kind: number;
	range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
	selectionRange: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
	children?: DocumentSymbolResponse[];
}

interface FoldingRangeResponse {
	start: number;
	end: number;
}

class CodermDocumentSymbolProvider implements DocumentSymbolProvider {
	readonly displayName = 'Coderm Language Host';

	constructor(private readonly languageHostService: ILanguageHostService) { }

	async provideDocumentSymbols(model: ITextModel, token: CancellationToken): Promise<DocumentSymbol[] | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}
		try {
			const json = await this.languageHostService.requestDocumentSymbol(model.uri.toString());
			return parseDocumentSymbols(json);
		} catch (err) {
			console.error('[CodermDocumentSymbolProvider] request failed', err);
			return undefined;
		}
	}
}

class CodermFoldingRangeProvider implements FoldingRangeProvider {
	readonly displayName = 'Coderm Language Host';

	constructor(private readonly languageHostService: ILanguageHostService) { }

	async provideFoldingRanges(model: ITextModel, _context: FoldingContext, token: CancellationToken): Promise<FoldingRange[] | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}
		try {
			const json = await this.languageHostService.requestFoldingRange(model.uri.toString());
			return parseFoldingRanges(json);
		} catch (err) {
			console.error('[CodermFoldingRangeProvider] request failed', err);
			return undefined;
		}
	}
}

// Parses a JSON array from the host's response. Returns [] on parse failure or a
// non-array payload — a malformed host reply should not crash the provider.
function parseJsonArray<T>(json: string): T[] {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return [];
	}
	return Array.isArray(raw) ? raw as T[] : [];
}

function parseDocumentSymbols(json: string): DocumentSymbol[] {
	return parseJsonArray<DocumentSymbolResponse>(json).map(toDocumentSymbol);
}

function toDocumentSymbol(s: DocumentSymbolResponse): DocumentSymbol {
	// DocumentSymbol/FoldingRange are interfaces here, so build plain objects that satisfy
	// the shape rather than constructing a class instance.
	const sym: DocumentSymbol = {
		name: s.name,
		// Note: detail/tags are required DocumentSymbol fields (languages.ts:1753-1755), but the
		// Phase 1 Rust host does not compute them — defaulted empty until a later phase fills them.
		detail: '',
		kind: s.kind as SymbolKind,
		tags: [],
		range: s.range,
		selectionRange: s.selectionRange,
	};
	if (s.children && s.children.length > 0) {
		sym.children = s.children.map(toDocumentSymbol);
	}
	return sym;
}

function parseFoldingRanges(json: string): FoldingRange[] {
	return parseJsonArray<FoldingRangeResponse>(json).map((r): FoldingRange => ({ start: r.start, end: r.end }));
}

export function registerLanguageFeatureProviders(
	languageHostService: ILanguageHostService,
	languages: string[],
	languageFeaturesService: ILanguageFeaturesService,
): IDisposable {
	const documentSymbolProvider = new CodermDocumentSymbolProvider(languageHostService);
	const foldingRangeProvider = new CodermFoldingRangeProvider(languageHostService);

	// Why a flat string[] selector: each entry is a language id; VS Code invokes the provider
	// only for models whose language matches, so no extra in-provider filtering is needed.
	return combinedDisposable(
		languageFeaturesService.documentSymbolProvider.register(languages, documentSymbolProvider),
		languageFeaturesService.foldingRangeProvider.register(languages, foldingRangeProvider),
	);
}
