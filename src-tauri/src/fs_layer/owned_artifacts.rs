use std::path::Path;

/// Only names produced by document staging/publication are app-owned.
/// Similar user names without a canonical v4 UUID must remain visible.
pub fn is_owned_document_artifact(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let hidden = name.strip_prefix('.');
    let candidates = [
        name.rsplit_once(".tmp-"),
        hidden.and_then(|name| name.rsplit_once(".collectives-backup-")),
        hidden
            .and_then(|name| name.strip_suffix(".tmp"))
            .and_then(|name| name.rsplit_once(".collectives-")),
    ];
    candidates.into_iter().flatten().any(|(document, id)| {
        !document.is_empty()
            && uuid::Uuid::parse_str(id).is_ok_and(|uuid| {
                uuid.get_version_num() == 4 && uuid.hyphenated().to_string() == id
            })
    })
}
