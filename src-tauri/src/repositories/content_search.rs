use crate::application::domain::CONTENT_SEARCH_MAX_INDEX_ENTRIES;
const CONTENT_SEARCH_MAX_FILES: usize = 2_000;
const CONTENT_SEARCH_MAX_DIRECTORIES: usize = 2_000;
const CONTENT_SEARCH_MAX_DIRECTORY_ENTRIES: usize = 10_000;
const CONTENT_SEARCH_MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const CONTENT_SEARCH_MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

pub fn search_note_content(
    indexed: Vec<crate::link_index::IndexEntry>,
    query: &str,
    offset: usize,
    limit: usize,
) -> Result<crate::application::domain::ContentSearchPage, String> {
    use crate::application::domain::{ContentSearchPage, ContentSearchResult};
    use std::path::Path;

    let query = query.trim();
    if query.is_empty() {
        return Ok(ContentSearchPage {
            results: Vec::new(),
            offset,
            limit: limit.clamp(1, 100),
            total: 0,
            has_more: false,
            truncated: false,
            scanned_files: 0,
            skipped_files: 0,
        });
    }
    if query.encode_utf16().count() > 512 {
        return Err("Search query is too long (maximum 512 characters)".into());
    }

    let mut paths: Vec<(String, String, String)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut skipped_files = 0usize;
    let mut truncated = indexed.len() == CONTENT_SEARCH_MAX_INDEX_ENTRIES;
    let mut visited_directories = 0usize;

    fn collect_folder_markdown(
        folder: &Path,
        output: &mut Vec<(String, String, String)>,
        seen: &mut std::collections::HashSet<String>,
        skipped: &mut usize,
        truncated: &mut bool,
        depth: usize,
        visited: &mut usize,
    ) {
        if depth > 32
            || output.len() >= CONTENT_SEARCH_MAX_FILES
            || *visited >= CONTENT_SEARCH_MAX_DIRECTORIES
        {
            *truncated = true;
            return;
        }
        *visited += 1;
        let children = match std::fs::read_dir(folder) {
            Ok(children) => children,
            Err(_) => {
                *skipped += 1;
                return;
            }
        };
        let mut children: Vec<_> = children
            .take(CONTENT_SEARCH_MAX_DIRECTORY_ENTRIES + 1)
            .collect();
        if children.len() > CONTENT_SEARCH_MAX_DIRECTORY_ENTRIES {
            *truncated = true;
            children.truncate(CONTENT_SEARCH_MAX_DIRECTORY_ENTRIES);
        }
        children.sort_by_key(|child| child.as_ref().ok().map(|entry| entry.file_name()));
        for child in children {
            if output.len() >= CONTENT_SEARCH_MAX_FILES {
                *truncated = true;
                break;
            }
            let child = match child {
                Ok(child) => child,
                Err(_) => {
                    *skipped += 1;
                    continue;
                }
            };
            let kind = match child.file_type() {
                Ok(kind) => kind,
                Err(_) => {
                    *skipped += 1;
                    continue;
                }
            };
            let path = child.path();
            if kind.is_dir() {
                collect_folder_markdown(
                    &path,
                    output,
                    seen,
                    skipped,
                    truncated,
                    depth + 1,
                    visited,
                );
            } else if kind.is_file()
                && crate::file_capabilities_generated::classify_path(&path)
                    == Some(crate::file_capabilities_generated::FileKind::Markdown)
            {
                let path_string = path.to_string_lossy().into_owned();
                if seen.insert(path_string.to_lowercase()) {
                    let name = path
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .unwrap_or("Untitled note")
                        .to_string();
                    output.push((path_string.clone(), path_string, name));
                }
            }
        }
    }

    for entry in indexed {
        if entry.entry_type == "file" {
            let path = Path::new(&entry.path);
            if crate::file_capabilities_generated::classify_path(path)
                == Some(crate::file_capabilities_generated::FileKind::Markdown)
                && seen.insert(entry.path.to_lowercase())
            {
                paths.push((entry.entry_id, entry.path.clone(), entry.display_name));
            }
        } else if entry.entry_type == "folder-ref" {
            collect_folder_markdown(
                Path::new(&entry.path),
                &mut paths,
                &mut seen,
                &mut skipped_files,
                &mut truncated,
                0,
                &mut visited_directories,
            );
        }
    }
    if paths.len() > CONTENT_SEARCH_MAX_FILES {
        paths.truncate(CONTENT_SEARCH_MAX_FILES);
        truncated = true;
    }

    let folded_query = query.to_lowercase();
    let mut results = Vec::new();
    let mut scanned_files = 0usize;
    let mut scanned_bytes = 0u64;
    for (entry_id, path, display_name) in paths {
        let metadata = match std::fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped_files += 1;
                continue;
            }
        };
        if metadata.len() > CONTENT_SEARCH_MAX_FILE_BYTES {
            skipped_files += 1;
            continue;
        }
        if scanned_bytes.saturating_add(metadata.len()) > CONTENT_SEARCH_MAX_TOTAL_BYTES {
            truncated = true;
            break;
        }
        let snapshot = match super::documents::read_file(path.clone()) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                skipped_files += 1;
                continue;
            }
        };
        scanned_bytes = scanned_bytes.saturating_add(snapshot.byte_size.unwrap_or(0));
        if scanned_bytes > CONTENT_SEARCH_MAX_TOTAL_BYTES {
            truncated = true;
            break;
        }
        let content = snapshot.content;
        scanned_files += 1;
        if let Some((snippet, line_number, column_utf16, match_start_utf16, match_end_utf16)) =
            find_content_match(&content, &folded_query)
        {
            results.push(ContentSearchResult {
                display_name,
                entry_id: if entry_id.is_empty() {
                    path.clone()
                } else {
                    entry_id
                },
                path,
                snippet,
                line_number,
                column_utf16,
                match_start_utf16,
                match_end_utf16,
            });
        }
    }
    results.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then_with(|| left.path.cmp(&right.path))
    });
    let total = results.len();
    let limit = limit.clamp(1, 100);
    let safe_offset = offset.min(total);
    let page: Vec<_> = results.into_iter().skip(safe_offset).take(limit).collect();
    let has_more = safe_offset.saturating_add(page.len()) < total;
    Ok(ContentSearchPage {
        results: page,
        offset: safe_offset,
        limit,
        total,
        has_more,
        truncated,
        scanned_files,
        skipped_files,
    })
}

fn find_content_match(
    content: &str,
    folded_query: &str,
) -> Option<(String, usize, usize, usize, usize)> {
    if folded_query.is_empty() {
        return None;
    }
    for (line_index, line) in content.lines().enumerate() {
        let mut folded = String::new();
        let mut original_ranges = Vec::new();
        for (byte_index, character) in line.char_indices() {
            let byte_end = byte_index + character.len_utf8();
            for lowered in character.to_lowercase() {
                folded.push(lowered);
                original_ranges.push((byte_index, byte_end));
            }
        }
        let Some(folded_index) = folded.find(folded_query) else {
            continue;
        };
        let folded_start = folded[..folded_index].chars().count();
        let query_char_count = folded_query.chars().count();
        let start_byte = original_ranges.get(folded_start)?.0;
        let end_byte = original_ranges.get(folded_start + query_char_count - 1)?.1;
        let match_start_line_utf16 = line[..start_byte].encode_utf16().count();
        let match_end_line_utf16 = line[..end_byte].encode_utf16().count();
        let start_char = line[..start_byte].chars().count().saturating_sub(64);
        let end_char = (line[..end_byte].chars().count() + 96).min(line.chars().count());
        let snippet: String = line
            .chars()
            .skip(start_char)
            .take(end_char - start_char)
            .collect();
        let snippet_start_utf16 = line
            .chars()
            .take(start_char)
            .collect::<String>()
            .encode_utf16()
            .count();
        return Some((
            snippet,
            line_index + 1,
            match_start_line_utf16,
            match_start_line_utf16 - snippet_start_utf16,
            match_end_line_utf16 - snippet_start_utf16,
        ));
    }
    None
}

#[cfg(test)]
mod content_search_tests {
    use super::{find_content_match, search_note_content};
    use crate::link_index::IndexEntry;

    #[test]
    fn search_includes_all_markdown_extensions_and_skips_unreadable_documents() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("first.md"), "first\nHello 😀 target").unwrap();
        std::fs::write(root.path().join("second.MARKDOWN"), "Another TARGET").unwrap();
        std::fs::write(root.path().join("binary.md"), b"target\0binary").unwrap();
        std::fs::write(root.path().join("source.txt"), "target").unwrap();
        let folder = || {
            vec![IndexEntry {
                display_name: "Notes".into(),
                collection_id: "collection".into(),
                entry_id: "folder".into(),
                path: root.path().to_string_lossy().into_owned(),
                entry_type: "folder-ref".into(),
            }]
        };
        let first = search_note_content(folder(), "target", 0, 1).unwrap();
        assert_eq!(first.total, 2);
        assert_eq!(first.scanned_files, 2);
        assert_eq!(first.skipped_files, 1);
        assert!(first.has_more);
        assert_eq!(first.results[0].line_number, 2);
        assert_eq!(first.results[0].column_utf16, 9);
        let second = search_note_content(folder(), "target", 1, 1).unwrap();
        assert_eq!(second.results[0].display_name, "second");
        assert!(!second.has_more);
        assert!(!second.truncated);
    }

    #[test]
    fn content_match_returns_line_and_utf16_offsets_for_highlighting_and_navigation() {
        assert_eq!(
            find_content_match("first\nHello 😀 world", "😀"),
            Some(("Hello 😀 world".into(), 2, 6, 6, 8)),
        );
    }

    #[test]
    fn content_match_is_case_insensitive_for_non_ascii_text() {
        assert_eq!(
            find_content_match("Straße", "straße"),
            Some(("Straße".into(), 1, 0, 0, 6)),
        );
    }
}
