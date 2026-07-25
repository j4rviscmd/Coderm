// Coderm Language Host (Phase 2: hover + Phase 1.5 robustness).
//
// Wire format: [4 bytes LE request_id][4 bytes LE length][payload(JSON)].
//   request_id == 0  → notification (no response). Used for document sync.
//   request_id  > 0  → request (response expected). Used for language features.
// Payload is JSON tagged by "type":
//   - document/open:    {type:"document/open",    uri, version, languageId, text}
//   - document/change:  {type:"document/change",  uri, version, text}      // full-text replace
//   - document/close:   {type:"document/close",   uri}
//   - documentSymbol:   {type:"documentSymbol",   uri}  → [DocumentSymbol]
//   - foldingRange:     {type:"foldingRange",     uri}  → [FoldingRange]
//   - hover:            {type:"hover",            uri, line, column} → HoverResponse | null
//
// Phase 2 additions:
//   - hover: function/method/class/interface/type/typed-variable signatures with JSDoc
//   - UTF-16 column reconciliation for hover positions (Phase 1.5)
//
// Caution: tree-sitter positions are 0-indexed byte offsets; VS Code positions are
// 1-indexed. Phase 1 documentSymbol/foldingRange convert with byte-column + 1 (drifts on
// non-ASCII selectionRange columns — TODO retained). Phase 2 reconciles UTF-8 byte offsets
// to UTF-16 code units for hover only, since hover receives a renderer (line, column).

use std::collections::HashMap;
use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use tree_sitter::{Language, Node, Parser, Point};

#[derive(Deserialize)]
#[serde(tag = "type")]
enum Message {
    // Why rename_all on the variant (not the enum): a container-level rename_all on an enum
    // renames VARIANT names, not struct-variant fields. Field camelCase (languageId) must be set
    // per-variant, or the TS camelCase payload fails to deserialize and silently kills the host
    // process (every later request then times out).
    #[serde(rename = "document/open", rename_all = "camelCase")]
    DocumentOpen {
        uri: String,
        #[allow(dead_code)]
        version: u32, // reserved for Phase 2 incremental sync
        language_id: String,
        text: String,
    },
    #[serde(rename = "document/change", rename_all = "camelCase")]
    DocumentChange {
        uri: String,
        #[allow(dead_code)]
        version: u32, // reserved for Phase 2 incremental sync
        text: String,
    },
    #[serde(rename = "document/close")]
    DocumentClose { uri: String },
    #[serde(rename = "documentSymbol")]
    DocumentSymbol { uri: String },
    #[serde(rename = "foldingRange")]
    FoldingRange { uri: String },
    // line/column are the renderer's Position (1-indexed; column is UTF-16 code units).
    #[serde(rename = "hover")]
    Hover { uri: String, line: u32, column: u32 },
}

struct Document {
    language_id: String,
    content: String,
}

// VS Code DocumentSymbol (subset). camelCase serialization matches the renderer's
// DocumentSymbol shape (startLineNumber, selectionRange, ...).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentSymbol {
    name: String,
    kind: u32,
    range: Range,
    selection_range: Range,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Range {
    start_line_number: u32,
    start_column: u32,
    end_line_number: u32,
    end_column: u32,
}

#[derive(Serialize)]
struct FoldingRange {
    start: u32,
    end: u32,
}

// Phase 2 hover response. The renderer wraps `signature` in a ```typescript MarkdownString
// code block and renders `documentation` as a second MarkdownString (matching the built-in TS
// hover). Keeping markdown shaping on the renderer side avoids markdown pitfalls in Rust.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HoverResponse {
    signature: String,
    documentation: String,
    range: Range, // name-token range, so the highlight matches the hovered identifier
}

struct LanguageHost {
    documents: HashMap<String, Document>,
}

impl LanguageHost {
    fn new() -> Self {
        Self {
            documents: HashMap::new(),
        }
    }

    fn document(&self, uri: &str) -> Result<&Document, String> {
        self.documents
            .get(uri)
            .ok_or_else(|| format!("unknown document: {}", uri))
    }

    // Returns Some(json) for requests (caller emits a response frame) and None for
    // notifications (no response). On handler error, callers emit an empty result for
    // requests so the renderer does not wait until timeout.
    fn handle_message(&mut self, message: Message) -> Result<Option<String>, String> {
        match message {
            Message::DocumentOpen {
                uri,
                language_id,
                text,
                ..
            } => {
                self.documents.insert(
                    uri,
                    Document {
                        language_id,
                        content: text,
                    },
                );
                Ok(None)
            }
            // Constraint: Phase 1 replaces the whole content on every change rather than
            // applying incremental TextChange edits. This sidesteps a range-merge engine
            // (and the row/column reconciliation it would force) at the cost of re-sending
            // the full buffer from the renderer — an acceptable trade for Phase 1.
            Message::DocumentChange { uri, text, .. } => {
                if let Some(doc) = self.documents.get_mut(&uri) {
                    doc.content = text;
                }
                Ok(None)
            }
            Message::DocumentClose { uri } => {
                self.documents.remove(&uri);
                Ok(None)
            }
            Message::DocumentSymbol { uri } => {
                let doc = self.document(&uri)?;
                let symbols = document_symbols(&doc.language_id, &doc.content)?;
                Ok(Some(
                    serde_json::to_string(&symbols).map_err(|e| e.to_string())?,
                ))
            }
            Message::FoldingRange { uri } => {
                let doc = self.document(&uri)?;
                let ranges = folding_ranges(&doc.language_id, &doc.content)?;
                Ok(Some(
                    serde_json::to_string(&ranges).map_err(|e| e.to_string())?,
                ))
            }
            Message::Hover { uri, line, column } => Ok(Some(self.hover_json(&uri, line, column))),
        }
    }

    // Hover always emits a JSON string: the serialized response on success, or "null" on
    // any failure. Why not bubble up via `?`: document() / hover_at_position() /
    // to_string() errors must resolve to "null" here, not bubble to the main loop's
    // generic `b"[]"` fallback — `[]` is a valid DocumentSymbol/FoldingRange shape but
    // breaks hover (the renderer would build a "```typescript undefined```" tooltip).
    fn hover_json(&self, uri: &str, line: u32, column: u32) -> String {
        let doc = match self.document(uri) {
            Ok(doc) => doc,
            Err(e) => {
                eprintln!("[languageHost] hover error (unknown uri): {}", e);
                return "null".to_string();
            }
        };
        match hover_at_position(&doc.language_id, &doc.content, line, column) {
            Ok(Some(response)) => serde_json::to_string(&response).unwrap_or_else(|e| {
                eprintln!("[languageHost] hover serialization error: {}", e);
                "null".to_string()
            }),
            Ok(None) => "null".to_string(),
            Err(e) => {
                eprintln!("[languageHost] hover error: {}", e);
                "null".to_string()
            }
        }
    }
}

fn parse_source(language_id: &str, content: &str) -> Result<tree_sitter::Tree, String> {
    // Note: tree-sitter-typescript 0.23 exposes LANGUAGE_TYPESCRIPT / LANGUAGE_TSX as LanguageFn
    // constants (NOT callable functions); `.into()` converts each to a Language. The 0.22 form is
    // absent from crates.io, so 0.23 is the baseline (rust/crates/language-host/Cargo.toml).
    let language: Language = match language_id {
        "typescript" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "tsx" => tree_sitter_typescript::LANGUAGE_TSX.into(),
        other => return Err(format!("unsupported language: {}", other)),
    };
    let mut parser = Parser::new();
    parser.set_language(&language).map_err(|e| e.to_string())?;
    parser
        .parse(content, None)
        .ok_or_else(|| "parse returned None".to_string())
}

fn document_symbols(language_id: &str, content: &str) -> Result<Vec<DocumentSymbol>, String> {
    let tree = parse_source(language_id, content)?;
    let mut symbols = Vec::new();
    collect_symbols(tree.root_node(), content, &mut symbols);
    Ok(symbols)
}

fn folding_ranges(language_id: &str, content: &str) -> Result<Vec<FoldingRange>, String> {
    let tree = parse_source(language_id, content)?;
    let mut ranges = Vec::new();
    collect_folds(tree.root_node(), &mut ranges);
    Ok(ranges)
}

// tree-sitter Point is 0-indexed; VS Code line/column are 1-indexed. See file header
// for the non-ASCII column caveat (Phase 1 symbol/fold remain byte-column + 1).
fn range_from_points(start: Point, end: Point) -> Range {
    Range {
        start_line_number: start.row as u32 + 1,
        start_column: start.column as u32 + 1,
        end_line_number: end.row as u32 + 1,
        end_column: end.column as u32 + 1,
    }
}

fn node_text<'a>(node: Node, source: &'a str) -> &'a str {
    // tree-sitter guarantees start_byte/end_byte land on UTF-8 boundaries.
    &source[node.start_byte()..node.end_byte()]
}

// Phase 1 emits a flat symbol list. VS Code re-hierarchizes by range overlap, so a flat
// list renders correctly in the Outline view. TODO(Phase 2): emit nested children.
fn collect_symbols(node: Node, source: &str, symbols: &mut Vec<DocumentSymbol>) {
    if let Some(sym) = symbol_for_node(node, source) {
        symbols.push(sym);
    }
    let count = node.named_child_count();
    for i in 0..count {
        if let Some(child) = node.named_child(i) {
            collect_symbols(child, source, symbols);
        }
    }
}

fn symbol_for_node(node: Node, source: &str) -> Option<DocumentSymbol> {
    // SymbolKind numeric values mirror VS Code's SymbolKind enum (languages.ts:1595).
    // Why these exact numbers: languageFeatures.ts casts `kind` straight to SymbolKind via
    // `as SymbolKind` (no LSP conversion layer), so the values must already be VS Code's enum
    // (Class=4, Method=5, Enum=9, Interface=10, Function=11, TypeParameter=25) — NOT LSP's
    // off-by-one numbers, or outline icons would render one slot off.
    let kind_num = match node.kind() {
        "function_declaration" | "generator_function_declaration" | "function_signature" => 11, // Function
        "class_declaration" | "abstract_class_declaration" => 4, // Class
        "method_definition" | "method_signature" | "abstract_method_signature" => 5, // Method
        "interface_declaration" => 10,                           // Interface
        "enum_declaration" => 9,                                 // Enum
        "type_alias_declaration" => 25,                          // TypeParameter
        _ => return None,
    };
    let name_node = node.child_by_field_name("name")?;
    let name = node_text(name_node, source).to_string();
    Some(DocumentSymbol {
        name,
        kind: kind_num,
        range: range_from_points(node.start_position(), node.end_position()),
        selection_range: range_from_points(name_node.start_position(), name_node.end_position()),
    })
}

fn collect_folds(node: Node, ranges: &mut Vec<FoldingRange>) {
    if is_foldable(node.kind()) {
        let start = node.start_position().row;
        let end = node.end_position().row;
        // Only foldable when the block spans more than one line.
        if end > start {
            ranges.push(FoldingRange {
                start: start as u32 + 1,
                end: end as u32 + 1,
            });
        }
    }
    let count = node.named_child_count();
    for i in 0..count {
        if let Some(child) = node.named_child(i) {
            collect_folds(child, ranges);
        }
    }
}

fn is_foldable(kind: &str) -> bool {
    matches!(
        kind,
        "statement_block"
            | "class_body"
            | "interface_body"
            | "enum_body"
            | "switch_body"
            | "object"
            | "formal_parameters"
            | "block"
            | "named_imports"
    )
}

// Phase 2: hover provider. Returns signature + JSDoc for function/method/class/interface/
// type/typed-variable declarations. Resolves the renderer's (line, UTF-16 column) to a
// tree-sitter Point, finds the deepest node, walks up to the enclosing declaration, and
// only emits a hover when the point is on the declaration's name token (matches TS behavior).
fn hover_at_position(
    language_id: &str,
    content: &str,
    line_1: u32,
    column_1: u32,
) -> Result<Option<HoverResponse>, String> {
    let tree = parse_source(language_id, content)?;
    let row_0 = line_1.saturating_sub(1) as usize;
    let column_0_utf8 = utf16_column_to_utf8_byte(content, row_0, column_1)?;
    let point = Point {
        row: row_0,
        column: column_0_utf8,
    };

    // Deepest named node at the point, then walk up to the enclosing declaration.
    let leaf = match tree
        .root_node()
        .named_descendant_for_point_range(point, point)
    {
        Some(n) => n,
        None => return Ok(None),
    };
    let decl = match walk_up_to_declaration(leaf) {
        Some(d) => d,
        None => return Ok(None),
    };

    // Gate on the name token: hover only fires on the identifier, not on the body. This
    // mirrors the built-in TS hover (hovering inside a function body returns nothing).
    let name_node = match decl.child_by_field_name("name") {
        Some(n) => n,
        None => return Ok(None),
    };
    if !point_in_node_range(point, name_node) {
        return Ok(None);
    }

    // variable_declarator / public_field_definition are only useful with a type annotation
    // (`const x = 1` has nothing to say; `const x: number` does).
    if matches!(
        decl.kind(),
        "variable_declarator" | "public_field_definition"
    ) && decl.child_by_field_name("type").is_none()
    {
        return Ok(None);
    }

    Ok(Some(HoverResponse {
        signature: signature_slice(decl, content),
        documentation: collect_jsdoc(decl, content),
        range: range_from_points(name_node.start_position(), name_node.end_position()),
    }))
}

// Reconcile a renderer (row_0, column_1) to a tree-sitter UTF-8 byte column on that row.
// Why per-row walk: tree-sitter Point.column is a UTF-8 byte offset relative to the row,
// while the renderer's Position.column is 1-indexed UTF-16 code units. For non-ASCII
// (emoji/CJK) the two diverge, so we count UTF-16 units char-by-char until column_1 - 1.
fn utf16_column_to_utf8_byte(content: &str, row_0: usize, column_1: u32) -> Result<usize, String> {
    let line_str = content
        .lines()
        .nth(row_0)
        .ok_or_else(|| format!("row {} out of range", row_0))?;
    let target = column_1.saturating_sub(1) as usize; // renderer column is 1-indexed
    let mut utf16_seen = 0usize;
    let mut byte_offset = 0usize;
    for c in line_str.chars() {
        if utf16_seen >= target {
            break;
        }
        utf16_seen += c.len_utf16();
        byte_offset += c.len_utf8();
    }
    Ok(byte_offset)
}

fn walk_up_to_declaration<'a>(start: Node<'a>) -> Option<Node<'a>> {
    let mut cursor = Some(start);
    while let Some(n) = cursor {
        if is_hover_declaration_kind(n.kind()) {
            return Some(n);
        }
        cursor = n.parent();
    }
    None
}

fn is_hover_declaration_kind(kind: &str) -> bool {
    matches!(
        kind,
        "function_declaration"
            | "generator_function_declaration"
            | "function_signature"
            | "method_definition"
            | "method_signature"
            | "abstract_method_signature"
            | "class_declaration"
            | "abstract_class_declaration"
            | "interface_declaration"
            | "type_alias_declaration"
            | "variable_declarator"
            | "public_field_definition"
    )
}

fn point_in_node_range(point: Point, node: Node) -> bool {
    let s = node.start_position();
    let e = node.end_position();
    !(point.row < s.row
        || point.row > e.row
        || (point.row == s.row && point.column < s.column)
        || (point.row == e.row && point.column >= e.column))
}

// Signature slice: source[decl.start_byte() .. body.start_byte()) for kinds with a body;
// whole node for type_alias_declaration / *_signature. Trim trailing whitespace. This keeps
// async/generics/params/return-type verbatim as the author wrote them (no reconstruction).
fn signature_slice(decl: Node, source: &str) -> String {
    let end_byte = if decl.kind() == "type_alias_declaration" || decl.kind().ends_with("signature")
    {
        decl.end_byte()
    } else {
        decl.child_by_field_name("body")
            .map(|b| b.start_byte())
            .unwrap_or(decl.end_byte())
    };
    source[decl.start_byte()..end_byte].trim_end().to_string()
}

// Walk prev_sibling collecting consecutive `comment` nodes whose text starts with `/**`.
// Comments are named siblings (not children), so prev_sibling (not prev_named_sibling) is
// correct. Returns the stripped JSDoc text, or empty if no leading JSDoc.
fn collect_jsdoc(decl: Node, source: &str) -> String {
    let mut blocks: Vec<&str> = Vec::new();
    let mut cursor = decl.prev_sibling();
    while let Some(c) = cursor {
        let text = node_text(c, source);
        if c.kind() != "comment" || !text.starts_with("/**") {
            break;
        }
        blocks.push(text);
        cursor = c.prev_sibling();
    }
    if blocks.is_empty() {
        return String::new();
    }
    blocks.reverse();
    strip_jsdoc(&blocks.join("\n"))
}

// Strip the `/** ... */` markers and per-line `* ` prefixes from a JSDoc block.
fn strip_jsdoc(combined: &str) -> String {
    let trimmed = combined
        .strip_prefix("/**")
        .and_then(|s| s.strip_suffix("*/"))
        .unwrap_or(combined);
    trimmed
        .lines()
        .map(|line| {
            let stripped = line.trim();
            match stripped.strip_prefix('*') {
                // After stripping `*` and an optional leading space, re-trim to drop any
                // trailing whitespace (e.g. "* foo  " → "foo").
                Some(rest) => rest.strip_prefix(' ').unwrap_or(rest).trim(),
                None => stripped,
            }
        })
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

// Emits one [reqId(4)][length(4)][payload] frame to stdout.
fn write_frame(request_id: u32, payload: &[u8]) -> io::Result<()> {
    let mut header = [0u8; 8];
    header[0..4].copy_from_slice(&request_id.to_le_bytes());
    header[4..8].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    io::stdout().write_all(&header)?;
    io::stdout().write_all(payload)?;
    io::stdout().flush()
}

fn main() -> io::Result<()> {
    let mut host = LanguageHost::new();
    let mut buffer = vec![0u8; 1024 * 1024]; // 1 MiB max payload

    loop {
        // Frame: [4 bytes LE request_id][4 bytes LE length][payload]
        let mut header = [0u8; 8];
        if io::stdin().read_exact(&mut header).is_err() {
            break; // EOF (parent closed stdin) or read error → exit cleanly
        }

        let request_id = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;

        if length == 0 || length > buffer.len() {
            // Drain the oversized/zero-length payload to keep the stream framed.
            io::copy(&mut io::stdin().take(length as u64), &mut io::sink())?;
            continue;
        }

        io::stdin().read_exact(&mut buffer[..length])?;

        let json_str = match std::str::from_utf8(&buffer[..length]) {
            Ok(s) => s,
            Err(e) => {
                // Skip the malformed frame but keep the stream framed: read_exact already
                // consumed exactly `length` bytes. Logging surfaces the cause instead of
                // letting the host die and stall every pending request until its timeout.
                eprintln!("[languageHost] UTF-8 error (frame skipped): {}", e);
                continue;
            }
        };

        let message: Message = match serde_json::from_str(json_str) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[languageHost] JSON parse error (frame skipped): {}", e);
                continue;
            }
        };

        let handled = host.handle_message(message);

        // Notifications (request_id == 0) never receive a response frame, even on error —
        // the renderer does not await them. Requests always receive a frame (real result or
        // empty fallback) so the multiplexer's pending entry is never orphaned.
        match handled {
            Ok(Some(json)) => {
                if request_id > 0 {
                    write_frame(request_id, json.as_bytes())?;
                }
            }
            Ok(None) => {}
            Err(e) => {
                eprintln!("[languageHost] handler error: {}", e);
                if request_id > 0 {
                    write_frame(request_id, b"[]")?;
                }
            }
        }
    }

    Ok(())
}
