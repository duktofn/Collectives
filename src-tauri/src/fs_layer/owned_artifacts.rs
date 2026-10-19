use std::path::Path;

/// Only names produced by document staging/publication are app-owned.
/// Similar user names without a canonical v4 UUID must remain visible.
pub fn is_owned_document_artifact(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let candidate = if let Some((document, id)) = name.rsplit_once(".tmp-") {
        (!document.is_empty()).then_some(id)
    } else if let Some(hidden) = name.strip_prefix('.') {
        if let Some((document, id)) = hidden.rsplit_once(".collectives-backup-") {
            (!document.is_empty()).then_some(id)
        } else if let Some(stage) = hidden.strip_suffix(".tmp") {
            stage
                .rsplit_once(".collectives-")
                .and_then(|(document, id)| (!document.is_empty()).then_some(id))
        } else {
            None
        }
    } else {
        None
    };
    candidate.is_some_and(|id| {
        uuid::Uuid::parse_str(id)
            .is_ok_and(|uuid| uuid.get_version_num() == 4 && uuid.hyphenated().to_string() == id)
    })
}
