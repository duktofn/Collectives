use crate::application::domain::CONTENT_SEARCH_MAX_INDEX_ENTRIES;
#[cfg(test)]
use std::cell::Cell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
const CONTENT_SEARCH_MAX_FILES: usize = 2_000;
const CONTENT_SEARCH_MAX_DIRECTORIES: usize = 2_000;
const CONTENT_SEARCH_MAX_DIRECTORY_ENTRIES: usize = 10_000;
const CONTENT_SEARCH_MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const CONTENT_SEARCH_MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone)]
struct CachedFileMatch {
    version_token: String,
    result: Option<crate::application::domain::ContentSearchResult>,
}

struct CachedSearch {
    identity: [u8; 32],
    files: HashMap<[u8; 32], CachedFileMatch>,
}

// Each request still reads current snapshots; this only reuses per-file match results.
static CONTENT_SEARCH_CACHE: OnceLock<Mutex<Option<Arc<CachedSearch>>>> = OnceLock::new();

#[cfg(test)]
thread_local! {
    static FIND_CONTENT_MATCH_CALLS: Cell<usize> = const { Cell::new(0) };
}

#[cfg(test)]
static CONTENT_SEARCH_TEST_LOCK: Mutex<()> = Mutex::new(());

fn update_search_identity(hasher: &mut blake3::Hasher, value: &str) {
    hasher.update(&(value.len() as u64).to_le_bytes());
    hasher.update(value.as_bytes());
}

fn search_identity(
    indexed: &[crate::link_index::IndexEntry],
    paths: &[(String, String, String)],
    query: &str,
) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    update_search_identity(&mut hasher, "content-search-cache-v1");
    update_search_identity(&mut hasher, query);
    // The SQLite link index query has no ORDER BY, so cache identity is set-like.
    let mut index_keys: Vec<_> = indexed
        .iter()
        .map(|entry| {
            (
                entry.collection_id.as_str(),
                entry.entry_id.as_str(),
                entry.path.as_str(),
                entry.display_name.as_str(),
                entry.entry_type.as_str(),
            )
        })
        .collect();
    index_keys.sort_unstable();
    hasher.update(&(index_keys.len() as u64).to_le_bytes());
    for (collection_id, entry_id, path, display_name, entry_type) in index_keys {
        update_search_identity(&mut hasher, collection_id);
        update_search_identity(&mut hasher, entry_id);
        update_search_identity(&mut hasher, path);
        update_search_identity(&mut hasher, display_name);
        update_search_identity(&mut hasher, entry_type);
    }
    let mut path_keys: Vec<_> = paths
        .iter()
        .map(|(entry_id, path, display_name)| {
            (entry_id.as_str(), path.as_str(), display_name.as_str())
        })
        .collect();
    path_keys.sort_unstable();
    hasher.update(&(path_keys.len() as u64).to_le_bytes());
    for (entry_id, path, display_name) in path_keys {
        update_search_identity(&mut hasher, entry_id);
        update_search_identity(&mut hasher, path);
        update_search_identity(&mut hasher, display_name);
    }
    *hasher.finalize().as_bytes()
}

fn candidate_key(entry_id: &str, path: &str, display_name: &str) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    update_search_identity(&mut hasher, "content-search-candidate-v1");
    update_search_identity(&mut hasher, entry_id);
    update_search_identity(&mut hasher, path);
    update_search_identity(&mut hasher, display_name);
    *hasher.finalize().as_bytes()
}

fn cached_search(identity: [u8; 32], file_count: usize) -> Option<Arc<CachedSearch>> {
    let cache = CONTENT_SEARCH_CACHE.get_or_init(|| Mutex::new(None));
    cache
        .lock()
        .ok()?
        .as_ref()
        .filter(|entry| entry.identity == identity && entry.files.len() == file_count)
        .map(Arc::clone)
}

fn remember_search(search: CachedSearch) {
    if let Ok(mut cache) = CONTENT_SEARCH_CACHE.get_or_init(|| Mutex::new(None)).lock() {
        *cache = Some(Arc::new(search));
    }
}

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

    for entry in &indexed {
        if entry.entry_type == "file" {
            let path = Path::new(&entry.path);
            if crate::file_capabilities_generated::classify_path(path)
                == Some(crate::file_capabilities_generated::FileKind::Markdown)
                && seen.insert(entry.path.to_lowercase())
            {
                paths.push((
                    entry.entry_id.clone(),
                    entry.path.clone(),
                    entry.display_name.clone(),
                ));
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

    let cache_identity = search_identity(&indexed, &paths, query);
    let candidate_count = paths.len();
    let cache_usable = !truncated && skipped_files == 0;
    let previous_cache = cache_usable
        .then(|| cached_search(cache_identity, candidate_count))
        .flatten();
    let mut cacheable = cache_usable;
    let mut cached_files =
        (cacheable && previous_cache.is_none()).then(|| HashMap::with_capacity(paths.len()));
    let folded_query = query.to_lowercase();
    let mut results = Vec::new();
    let mut scanned_files = 0usize;
    let mut scanned_bytes = 0u64;
    for (entry_id, path, display_name) in paths {
        let metadata = match std::fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped_files += 1;
                cacheable = false;
                continue;
            }
        };
        if metadata.len() > CONTENT_SEARCH_MAX_FILE_BYTES {
            skipped_files += 1;
            cacheable = false;
            continue;
        }
        if scanned_bytes.saturating_add(metadata.len()) > CONTENT_SEARCH_MAX_TOTAL_BYTES {
            truncated = true;
            cacheable = false;
            break;
        }
        let snapshot = match super::documents::read_file(path.clone()) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                skipped_files += 1;
                cacheable = false;
                continue;
            }
        };
        scanned_bytes = scanned_bytes.saturating_add(snapshot.byte_size.unwrap_or(0));
        if scanned_bytes > CONTENT_SEARCH_MAX_TOTAL_BYTES {
            truncated = true;
            cacheable = false;
            break;
        }
        scanned_files += 1;
        let candidate_key = candidate_key(&entry_id, &path, &display_name);
        let cached_match = previous_cache
            .as_ref()
            .and_then(|previous| previous.files.get(&candidate_key))
            .filter(|previous| previous.version_token == snapshot.version_token);
        let cache_miss = cached_match.is_none();
        let result = if let Some(previous) = cached_match {
            previous.result.clone()
        } else {
            find_content_match(&snapshot.content, &folded_query).map(
                |(snippet, line_number, column_utf16, match_start_utf16, match_end_utf16)| {
                    ContentSearchResult {
                        display_name: display_name.clone(),
                        entry_id: if entry_id.is_empty() {
                            path.clone()
                        } else {
                            entry_id.clone()
                        },
                        path: path.clone(),
                        snippet,
                        line_number,
                        column_utf16,
                        match_start_utf16,
                        match_end_utf16,
                    }
                },
            )
        };
        if let Some(result) = &result {
            results.push(result.clone());
        }
        if cacheable && (cached_files.is_some() || cache_miss) {
            let files = cached_files.get_or_insert_with(|| {
                previous_cache
                    .as_ref()
                    .map(|previous| previous.files.clone())
                    .unwrap_or_default()
            });
            files.insert(
                candidate_key,
                CachedFileMatch {
                    version_token: snapshot.version_token,
                    result,
                },
            );
        }
    }
    if cacheable
        && !truncated
        && skipped_files == 0
        && scanned_files == candidate_count
        && cached_files
            .as_ref()
            .is_some_and(|files| files.len() == candidate_count)
    {
        remember_search(CachedSearch {
            identity: cache_identity,
            files: cached_files.expect("complete cache was checked above"),
        });
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
    #[cfg(test)]
    FIND_CONTENT_MATCH_CALLS.with(|calls| calls.set(calls.get() + 1));
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
    use super::{
        find_content_match, search_note_content, CONTENT_SEARCH_TEST_LOCK, FIND_CONTENT_MATCH_CALLS,
    };
    use crate::link_index::IndexEntry;

    #[test]
    fn search_includes_all_markdown_extensions_and_skips_unreadable_documents() {
        let _cache_guard = CONTENT_SEARCH_TEST_LOCK.lock().unwrap();
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

    #[test]
    fn content_match_preserves_per_character_unicode_lowercase_and_utf16_ranges() {
        assert_eq!(
            find_content_match("xİy", "i\u{307}"),
            Some(("xİy".into(), 1, 1, 1, 2)),
        );
        assert_eq!(find_content_match("ΟΣ", "ος"), None);
        assert_eq!(
            find_content_match("ΟΣ", "οσ"),
            Some(("ΟΣ".into(), 1, 0, 0, 2)),
        );
    }

    #[test]
    fn repeated_page_reuses_positive_and_negative_file_matches() {
        let _cache_guard = CONTENT_SEARCH_TEST_LOCK.lock().unwrap();
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("first.md"), "verified-cache-target").unwrap();
        std::fs::write(root.path().join("second.md"), "no result here").unwrap();
        let indexed = || {
            vec![IndexEntry {
                display_name: "Notes".into(),
                collection_id: "cache-unit-collection".into(),
                entry_id: "folder".into(),
                path: root.path().to_string_lossy().into_owned(),
                entry_type: "folder-ref".into(),
            }]
        };
        FIND_CONTENT_MATCH_CALLS.with(|calls| calls.set(0));

        let first = search_note_content(indexed(), "verified-cache-target", 0, 1).unwrap();
        let first_match_calls = FIND_CONTENT_MATCH_CALLS.with(|calls| calls.get());
        assert_eq!(first.scanned_files, 2);
        assert_eq!(first.total, 1);
        assert_eq!(first_match_calls, 2);

        let repeated = search_note_content(indexed(), "verified-cache-target", 0, 1).unwrap();
        assert_eq!(repeated, first);
        assert_eq!(
            FIND_CONTENT_MATCH_CALLS.with(|calls| calls.get()),
            first_match_calls
        );
    }

    #[test]
    fn reordered_index_rows_reuse_matches_without_changing_result_order() {
        let _cache_guard = CONTENT_SEARCH_TEST_LOCK.lock().unwrap();
        let root = tempfile::tempdir().unwrap();
        let first_path = root.path().join("Alpha.md");
        let second_path = root.path().join("Beta.md");
        std::fs::write(&first_path, "verified-order-target").unwrap();
        std::fs::write(&second_path, "also verified-order-target").unwrap();
        let first_entry = || IndexEntry {
            display_name: "Alpha".into(),
            collection_id: "cache-order-collection".into(),
            entry_id: "alpha".into(),
            path: first_path.to_string_lossy().into_owned(),
            entry_type: "file".into(),
        };
        let second_entry = || IndexEntry {
            display_name: "Beta".into(),
            collection_id: "cache-order-collection".into(),
            entry_id: "beta".into(),
            path: second_path.to_string_lossy().into_owned(),
            entry_type: "file".into(),
        };
        FIND_CONTENT_MATCH_CALLS.with(|calls| calls.set(0));

        let first = search_note_content(
            vec![first_entry(), second_entry()],
            "verified-order-target",
            0,
            20,
        )
        .unwrap();
        let first_match_calls = FIND_CONTENT_MATCH_CALLS.with(|calls| calls.get());
        assert_eq!(first_match_calls, 2);

        let reordered = search_note_content(
            vec![second_entry(), first_entry()],
            "verified-order-target",
            0,
            20,
        )
        .unwrap();
        assert_eq!(reordered, first);
        assert_eq!(
            FIND_CONTENT_MATCH_CALLS.with(|calls| calls.get()),
            first_match_calls
        );
    }
}
