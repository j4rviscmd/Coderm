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
import { URI } from '../../../../base/common/uri.js';
import {
	DocumentSymbol,
	DocumentSymbolProvider,
	Definition,
	DefinitionProvider,
	Location,
	FoldingContext,
	FoldingRange,
	FoldingRangeProvider,
	Hover,
	HoverProvider,
	ReferenceContext,
	ReferenceProvider,
	DocumentHighlight,
	DocumentHighlightKind,
	DocumentHighlightProvider,
	SymbolKind,
} from '../../../../editor/common/languages.js';
import { IMarkdownString, MarkdownString } from '../../../../base/common/htmlContent.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILanguageHostService } from './languageHost.js';

// Shapes returned by the Rust host (camelCase, matching the renderer's DocumentSymbol/IRange).
// `range` fields reuse the editor's IRange since the host emits the identical shape.
interface DocumentSymbolResponse {
	name: string;
	kind: number;
	range: IRange;
	selectionRange: IRange;
	children?: DocumentSymbolResponse[];
}

interface FoldingRangeResponse {
	start: number;
	end: number;
}

interface HoverResponse {
	signature: string;
	documentation: string;
	range: IRange;
}

interface DefinitionResponse {
	locations: Array<{ uri: string; range: IRange }>;
}

interface DocumentHighlightsResponse {
	highlights: Array<{ range: IRange; kind: number }>;
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

class CodermHoverProvider implements HoverProvider {
	readonly displayName = 'Coderm Language Host';

	constructor(private readonly languageHostService: ILanguageHostService) { }

	async provideHover(model: ITextModel, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}
		try {
			const json = await this.languageHostService.requestHover(
				model.uri.toString(),
				position.lineNumber,
				position.column
			);
			return parseHover(json);
		} catch (err) {
			console.error('[CodermHoverProvider] request failed', err);
			return undefined;
		}
	}
}

class CodermDefinitionProvider implements DefinitionProvider {
	readonly displayName = 'Coderm Language Host';

	constructor(private readonly languageHostService: ILanguageHostService) { }

	async provideDefinition(model: ITextModel, position: Position, token: CancellationToken): Promise<Definition | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}
		try {
			const json = await this.languageHostService.requestDefinition(
				model.uri.toString(),
				position.lineNumber,
				position.column
			);
			return parseLocations(json);
		} catch (err) {
			console.error('[CodermDefinitionProvider] request failed', err);
			return undefined;
		}
	}
}

class CodermReferenceProvider implements ReferenceProvider {
	readonly displayName = 'Coderm Language Host';

	constructor(private readonly languageHostService: ILanguageHostService) { }

	async provideReferences(model: ITextModel, position: Position, context: ReferenceContext, token: CancellationToken): Promise<Location[] | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}
		try {
			const json = await this.languageHostService.requestReferences(
				model.uri.toString(),
				position.lineNumber,
				position.column,
				context.includeDeclaration
			);
			return parseLocations(json);
		} catch (err) {
			console.error('[CodermReferenceProvider] request failed', err);
			return undefined;
		}
	}
}

class CodermDocumentHighlightProvider implements DocumentHighlightProvider {
	readonly displayName = 'Coderm Language Host';

	constructor(private readonly languageHostService: ILanguageHostService) { }

	async provideDocumentHighlights(model: ITextModel, position: Position, token: CancellationToken): Promise<DocumentHighlight[] | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}
		try {
			const json = await this.languageHostService.requestDocumentHighlights(
				model.uri.toString(),
				position.lineNumber,
				position.column
			);
			return parseDocumentHighlights(json);
		} catch (err) {
			console.error('[CodermDocumentHighlightProvider] request failed', err);
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

// Note: the host's "no result" sentinel for hover/definition is the literal string "null"
// (see hover_json/definition_json in rust/crates/language-host/src/main.rs), unlike
// documentSymbol/foldingRange which fall back to "[]". Treat both "null" and empty as
// no-result so a null reply never renders as a "```typescript undefined```" tooltip.
function parseJsonObject<T extends object>(json: string): T | undefined {
	if (json === 'null' || json === '') {
		return undefined;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return undefined;
	}
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	return raw as T;
}

function parseHover(json: string): Hover | undefined {
	const response = parseJsonObject<HoverResponse>(json);
	if (!response) {
		return undefined;
	}
	// Wrap signature in a ```typescript code block; render JSDoc as a second markdown string.
	// Why renderer-side shaping: keeps markdown construction out of Rust and matches the
	// built-in TS hover (appendCodeblock + documentation markdown).
	const contents: IMarkdownString[] = [
		new MarkdownString('```typescript\n' + response.signature + '\n```'),
	];
	if (response.documentation) {
		contents.push(new MarkdownString(response.documentation));
	}
	return { contents, range: response.range };
}

// Definition and references share the same wire shape (a DefinitionResponse with a
// `locations` array), so one parser covers both. Returns Location[] — also a valid Definition.
function parseLocations(json: string): Location[] | undefined {
	const response = parseJsonObject<DefinitionResponse>(json);
	if (!response) {
		return undefined;
	}
	return response.locations.map((loc): Location => ({
		uri: URI.parse(loc.uri),
		range: loc.range,
	}));
}

// Note: kind mirrors VS Code's DocumentHighlightKind (Text=0, Read=1, Write=2). The host sends
// numbers directly (no enum on the wire), so a plain cast is sufficient.
function parseDocumentHighlights(json: string): DocumentHighlight[] | undefined {
	const response = parseJsonObject<DocumentHighlightsResponse>(json);
	if (!response) {
		return undefined;
	}
	return response.highlights.map((h): DocumentHighlight => ({
		range: h.range,
		kind: h.kind as DocumentHighlightKind,
	}));
}

export function registerLanguageFeatureProviders(
	languageHostService: ILanguageHostService,
	languages: string[],
	languageFeaturesService: ILanguageFeaturesService,
): IDisposable {
	const documentSymbolProvider = new CodermDocumentSymbolProvider(languageHostService);
	const foldingRangeProvider = new CodermFoldingRangeProvider(languageHostService);
	const hoverProvider = new CodermHoverProvider(languageHostService);
	const definitionProvider = new CodermDefinitionProvider(languageHostService);
	const referenceProvider = new CodermReferenceProvider(languageHostService);
	const documentHighlightProvider = new CodermDocumentHighlightProvider(languageHostService);

	// Why a flat string[] selector: each entry is a language id; VS Code invokes the provider
	// only for models whose language matches, so no extra in-provider filtering is needed.
	return combinedDisposable(
		languageFeaturesService.documentSymbolProvider.register(languages, documentSymbolProvider),
		languageFeaturesService.foldingRangeProvider.register(languages, foldingRangeProvider),
		languageFeaturesService.hoverProvider.register(languages, hoverProvider),
		languageFeaturesService.definitionProvider.register(languages, definitionProvider),
		languageFeaturesService.referenceProvider.register(languages, referenceProvider),
		languageFeaturesService.documentHighlightProvider.register(languages, documentHighlightProvider),
	);
}
