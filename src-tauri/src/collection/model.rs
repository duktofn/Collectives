use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Entry {
    File {
        id: String,
        path: String,
    },
    #[serde(rename = "folder-ref")]
    FolderRef {
        id: String,
        path: String,
    },
    Group {
        id: String,
        name: String,
        children: Vec<Entry>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMetadata {
    pub last_validated_at: Option<String>,
    pub broken_entry_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub schema_version: u32,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub metadata: Option<CollectionMetadata>,
}
