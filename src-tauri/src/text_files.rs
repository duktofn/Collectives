use std::io::Read;
use std::path::Path;

pub fn has_binary_controls(text: &str) -> bool {
    text.chars().any(|character| {
        character.is_control() && !matches!(character, '\t' | '\r' | '\n' | '\u{000c}' | '\u{001b}')
    })
}

/// Inspect a bounded prefix for directory listings. Full reads validate all bytes.
pub fn probe_text_file(path: &Path) -> Option<bool> {
    const PREFIX_BYTES: u64 = 8 * 1024;
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() {
        return Some(false);
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(PREFIX_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.contains(&0) {
        return Some(false);
    }
    let text = match std::str::from_utf8(&bytes) {
        Ok(text) => text,
        Err(error) if error.error_len().is_none() && metadata.len() > bytes.len() as u64 => {
            // A multibyte character may straddle the sampling boundary.
            std::str::from_utf8(&bytes[..error.valid_up_to()]).ok()?
        }
        Err(_) => return Some(false),
    };
    Some(!has_binary_controls(text))
}
