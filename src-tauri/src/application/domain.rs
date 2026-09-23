pub use crate::collection::archive::ZipConflict;
pub use crate::collection::model::{Collection, CollectionMetadata, Entry};
pub use crate::fs_ops::FsEntry;
pub use crate::repositories::documents::DocumentSnapshot as FileSnapshot;
pub use crate::settings::{CustomFont, Settings};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrokenEntry {
    pub id: String,
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveCandidate {
    pub display_name: String,
    pub entry_id: String,
    pub path: String,
    pub entry_type: String,
}
