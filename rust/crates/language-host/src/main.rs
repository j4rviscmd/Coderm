// Coderm Language Host (Phase 1: request-id multiplexer + document sync + tree-sitter features).
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
//
// Caution: tree-sitter positions are 0-indexed byte offsets; VS Code DocumentSymbol
// line/column are 1-indexed. Phase 1 converts with a simple +1 — columns coincide for
// ASCII but drift for non-ASCII identifiers (UTF-8 byte offset vs UTF-16 code unit).
// Reconciliation is TODO for Phase 2.

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
        }
    }
}

fn parse_source(language_id: &str, content: &str) -> Result<tree_sitter::Tree, String> {
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
// for the non-ASCII column caveat.
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
    // SymbolKind numeric values mirror VS Code's SymbolKind enum.
    let kind_num = match node.kind() {
        "function_declaration" | "generator_function_declaration" | "function_signature" => 12, // Function
        "class_declaration" | "abstract_class_declaration" => 5, // Class
        "method_definition" | "method_signature" | "abstract_method_signature" => 6, // Method
        "interface_declaration" => 11,                           // Interface
        "enum_declaration" => 10,                                // Enum
        "type_alias_declaration" => 26,                          // TypeParameter
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
