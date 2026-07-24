// Coderm Language Host (Phase 0: simple echo stub).
//
// Wire format: [4 bytes LE length][raw payload]. Echoes the payload back verbatim.
// Why simple (no FlatBuffers yet): VS Code 1.122 renderer does not support static npm
// imports, so FlatBuffers cannot be used on the renderer side without deep build changes.
// FlatBuffers will be introduced in Phase 1, likely hosted on the main-process side
// (renderer <-> main over VSBuffer, main <-> Rust over FlatBuffers). The Rust FlatBuffers
// scaffolding (schemas/message.fbs) is kept for that future step.

use std::io::{self, Read, Write};

fn main() -> io::Result<()> {
    let mut buffer = vec![0u8; 65536];

    loop {
        // Frame: [4 bytes LE length][payload]
        let mut length_bytes = [0u8; 4];
        if io::stdin().read_exact(&mut length_bytes).is_err() {
            break; // EOF (parent closed stdin) or read error
        }

        let length = u32::from_le_bytes(length_bytes) as usize;
        if length == 0 || length > buffer.len() {
            // Drain the oversized payload to keep the stream framed; otherwise the next
            // length read would consume payload bytes and silently desync the protocol.
            io::copy(&mut io::stdin().take(length as u64), &mut io::sink())?;
            continue;
        }

        io::stdin().read_exact(&mut buffer[..length])?;

        // Echo the payload back with the same length-prefix framing.
        io::stdout().write_all(&length_bytes)?;
        io::stdout().write_all(&buffer[..length])?;
        io::stdout().flush()?;
    }

    Ok(())
}
