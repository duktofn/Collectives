use crate::application::domain::{
    Collection, CollectionMetadata, ContentSearchPage, ContentSearchResult, CustomFont, Entry,
    FileSnapshot, FsEntry, NoteLinkCandidate, ResolveCandidate, Settings, ZipConflict,
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResultDto {
    pub display_name: String,
    pub entry_id: String,
    pub path: String,
    pub snippet: String,
    pub line_number: usize,
    pub column_utf16: usize,
    pub match_start_utf16: usize,
    pub match_end_utf16: usize,
}
impl From<ContentSearchResult> for ContentSearchResultDto {
    fn from(value: ContentSearchResult) -> Self {
        Self {
            display_name: value.display_name,
            entry_id: value.entry_id,
            path: value.path,
            snippet: value.snippet,
            line_number: value.line_number,
            column_utf16: value.column_utf16,
            match_start_utf16: value.match_start_utf16,
            match_end_utf16: value.match_end_utf16,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchPageDto {
    pub results: Vec<ContentSearchResultDto>,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub has_more: bool,
    pub truncated: bool,
    pub scanned_files: usize,
    pub skipped_files: usize,
}
impl From<ContentSearchPage> for ContentSearchPageDto {
    fn from(value: ContentSearchPage) -> Self {
        Self {
            results: value.results.into_iter().map(Into::into).collect(),
            offset: value.offset,
            limit: value.limit,
            total: value.total,
            has_more: value.has_more,
            truncated: value.truncated,
            scanned_files: value.scanned_files,
            skipped_files: value.skipped_files,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDto {
    #[serde(flatten)]
    pub value: EntryDtoValue,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum EntryDtoValue {
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
        children: Vec<EntryDto>,
    },
}

impl From<Entry> for EntryDto {
    fn from(value: Entry) -> Self {
        Self {
            value: match value {
                Entry::File { id, path } => EntryDtoValue::File { id, path },
                Entry::FolderRef { id, path } => EntryDtoValue::FolderRef { id, path },
                Entry::Group { id, name, children } => EntryDtoValue::Group {
                    id,
                    name,
                    children: children.into_iter().map(Into::into).collect(),
                },
            },
        }
    }
}

impl From<EntryDto> for Entry {
    fn from(value: EntryDto) -> Self {
        match value.value {
            EntryDtoValue::File { id, path } => Entry::File { id, path },
            EntryDtoValue::FolderRef { id, path } => Entry::FolderRef { id, path },
            EntryDtoValue::Group { id, name, children } => Entry::Group {
                id,
                name,
                children: children.into_iter().map(Into::into).collect(),
            },
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMetadataDto {
    pub last_validated_at: Option<String>,
    pub broken_entry_ids: Vec<String>,
}

impl From<CollectionMetadata> for CollectionMetadataDto {
    fn from(value: CollectionMetadata) -> Self {
        Self {
            last_validated_at: value.last_validated_at,
            broken_entry_ids: value.broken_entry_ids,
        }
    }
}
impl From<CollectionMetadataDto> for CollectionMetadata {
    fn from(value: CollectionMetadataDto) -> Self {
        Self {
            last_validated_at: value.last_validated_at,
            broken_entry_ids: value.broken_entry_ids,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDto {
    pub id: String,
    pub schema_version: u32,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub entries: Vec<EntryDto>,
    pub metadata: Option<CollectionMetadataDto>,
}

impl From<Collection> for CollectionDto {
    fn from(value: Collection) -> Self {
        Self {
            id: value.id,
            schema_version: value.schema_version,
            name: value.name,
            created_at: value.created_at,
            updated_at: value.updated_at,
            entries: value.entries.into_iter().map(Into::into).collect(),
            metadata: value.metadata.map(Into::into),
        }
    }
}
impl From<CollectionDto> for Collection {
    fn from(value: CollectionDto) -> Self {
        Self {
            id: value.id,
            schema_version: value.schema_version,
            name: value.name,
            created_at: value.created_at,
            updated_at: value.updated_at,
            entries: value.entries.into_iter().map(Into::into).collect(),
            metadata: value.metadata.map(Into::into),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MutationOperationDto {
    AddEntry {
        parent_path: Vec<usize>,
        entry: EntryDto,
    },
    RemoveEntry {
        entry_id: String,
    },
    MoveEntry {
        entry_id: String,
        parent_path: Vec<usize>,
        new_index: usize,
    },
    RenameGroup {
        group_id: String,
        name: String,
    },
    RelinkEntry {
        entry_id: String,
        path: String,
    },
    DeleteGroupAndPromote {
        group_id: String,
    },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataMutationRequestDto {
    pub collection_id: String,
    pub expected_revision: i64,
    pub mutation_id: String,
    pub operation: MutationOperationDto,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataMutationResultDto {
    pub collection_id: String,
    pub revision: i64,
    pub mutation_id: String,
    pub changes: serde_json::Value,
    pub idempotent_replay: bool,
    pub metrics: crate::metadata::MutationMetrics,
}

impl From<MetadataMutationRequestDto> for crate::metadata::MutationRequest {
    fn from(value: MetadataMutationRequestDto) -> Self {
        let operation = match value.operation {
            MutationOperationDto::AddEntry { parent_path, entry } => {
                crate::metadata::MutationOperation::AddEntry {
                    parent_path,
                    entry: entry.into(),
                }
            }
            MutationOperationDto::RemoveEntry { entry_id } => {
                crate::metadata::MutationOperation::RemoveEntry { entry_id }
            }
            MutationOperationDto::MoveEntry {
                entry_id,
                parent_path,
                new_index,
            } => crate::metadata::MutationOperation::MoveEntry {
                entry_id,
                parent_path,
                new_index,
            },
            MutationOperationDto::RenameGroup { group_id, name } => {
                crate::metadata::MutationOperation::RenameGroup { group_id, name }
            }
            MutationOperationDto::RelinkEntry { entry_id, path } => {
                crate::metadata::MutationOperation::RelinkEntry { entry_id, path }
            }
            MutationOperationDto::DeleteGroupAndPromote { group_id } => {
                crate::metadata::MutationOperation::DeleteGroupAndPromote { group_id }
            }
        };
        Self {
            collection_id: value.collection_id,
            expected_revision: value.expected_revision,
            mutation_id: value.mutation_id,
            operation,
        }
    }
}

impl From<crate::metadata::MutationResult> for MetadataMutationResultDto {
    fn from(value: crate::metadata::MutationResult) -> Self {
        Self {
            collection_id: value.collection_id,
            revision: value.revision,
            mutation_id: value.mutation_id,
            changes: value.changes,
            idempotent_replay: value.idempotent_replay,
            metrics: value.metrics,
        }
    }
}

impl From<crate::metadata::MigrationStatus> for serde_json::Value {
    fn from(value: crate::metadata::MigrationStatus) -> Self {
        serde_json::to_value(value).unwrap_or(serde_json::Value::Null)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemChangeV2 {
    pub kind: String,
    pub entry_id: Option<String>,
    pub path: String,
    pub old_path: Option<String>,
    pub changed_file_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemChangesV2 {
    pub collection_id: String,
    pub stream_id: String,
    pub subscription_epoch: String,
    pub sequence: u64,
    pub overflow: bool,
    pub changes: Vec<FilesystemChangeV2>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDeltaV2 {
    pub collection_id: String,
    pub revision: i64,
    pub mutation_id: String,
    pub changes: serde_json::Value,
    pub origin: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSpecDto {
    pub path: String,
    pub entry_id: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchCursorDto {
    pub stream_id: String,
    pub subscription_epoch: String,
    pub sequence: u64,
}

impl From<crate::fs_layer::watcher::WatchCursor> for WatchCursorDto {
    fn from(value: crate::fs_layer::watcher::WatchCursor) -> Self {
        Self {
            stream_id: value.stream_id,
            subscription_epoch: value.subscription_epoch,
            sequence: value.sequence,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSnapshotDto {
    pub collection: CollectionDto,
    pub revision: i64,
    pub cursor: WatchCursorDto,
}

impl From<crate::metadata::MetadataSnapshot> for MetadataSnapshotDto {
    fn from(value: crate::metadata::MetadataSnapshot) -> Self {
        Self {
            collection: value.collection.into(),
            revision: value.revision,
            cursor: value.cursor.into(),
        }
    }
}

impl From<WatchSpecDto> for crate::fs_layer::watcher::WatchSpec {
    fn from(value: WatchSpecDto) -> Self {
        Self {
            path: std::path::PathBuf::from(value.path),
            entry_id: value.entry_id,
            recursive: value.recursive,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntryDto {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub is_text: Option<bool>,
}
impl From<FsEntry> for FsEntryDto {
    fn from(value: FsEntry) -> Self {
        Self {
            name: value.name,
            path: value.path,
            is_dir: value.is_dir,
            size: value.size,
            is_text: value.is_text,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenEntryDto {
    pub id: String,
    pub path: String,
    pub reason: String,
}
impl From<crate::application::domain::BrokenEntry> for BrokenEntryDto {
    fn from(value: crate::application::domain::BrokenEntry) -> Self {
        Self {
            id: value.id,
            path: value.path,
            reason: value.reason,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshotDto {
    pub content: String,
    pub version_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub had_utf8_bom: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_ending: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_size: Option<u64>,
}
impl From<FileSnapshot> for FileSnapshotDto {
    fn from(value: FileSnapshot) -> Self {
        Self {
            content: value.content,
            version_token: value.version_token,
            file_kind: value.file_kind,
            had_utf8_bom: value.had_utf8_bom,
            line_ending: value.line_ending,
            byte_size: value.byte_size,
        }
    }
}
impl From<FileSnapshotDto> for FileSnapshot {
    fn from(value: FileSnapshotDto) -> Self {
        Self {
            content: value.content,
            version_token: value.version_token,
            file_kind: value.file_kind,
            had_utf8_bom: value.had_utf8_bom,
            line_ending: value.line_ending,
            byte_size: value.byte_size,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveCandidateDto {
    pub display_name: String,
    pub entry_id: String,
    pub path: String,
    pub entry_type: String,
}
impl From<ResolveCandidate> for ResolveCandidateDto {
    fn from(value: ResolveCandidate) -> Self {
        Self {
            display_name: value.display_name,
            entry_id: value.entry_id,
            path: value.path,
            entry_type: value.entry_type,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinkCandidateDto {
    pub display_name: String,
    pub entry_id: String,
    pub path: String,
    pub entry_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_ref_entry_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_ref_root_path: Option<String>,
}
impl From<NoteLinkCandidate> for NoteLinkCandidateDto {
    fn from(value: NoteLinkCandidate) -> Self {
        Self {
            display_name: value.display_name,
            entry_id: value.entry_id,
            path: value.path,
            entry_type: value.entry_type,
            folder_ref_entry_id: value.folder_ref_entry_id,
            folder_ref_root_path: value.folder_ref_root_path,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFontDto {
    pub family: String,
    pub file_name: String,
    pub weight: String,
    pub style: String,
}
impl From<CustomFont> for CustomFontDto {
    fn from(value: CustomFont) -> Self {
        Self {
            family: value.family,
            file_name: value.file_name,
            weight: value.weight,
            style: value.style,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CodeColorsDto {
    pub text: Option<String>,
    pub background: Option<String>,
    pub keyword: Option<String>,
    pub modifier: Option<String>,
    pub r#type: Option<String>,
    pub function: Option<String>,
    pub variable: Option<String>,
    pub property: Option<String>,
    pub string: Option<String>,
    pub number: Option<String>,
    pub comment: Option<String>,
    pub annotation: Option<String>,
    pub r#macro: Option<String>,
    pub line_number: Option<String>,
    pub active_line_number: Option<String>,
}
impl From<crate::settings::CodeColors> for CodeColorsDto {
    fn from(value: crate::settings::CodeColors) -> Self {
        Self {
            text: value.text,
            background: value.background,
            keyword: value.keyword,
            modifier: value.modifier,
            r#type: value.r#type,
            function: value.function,
            variable: value.variable,
            property: value.property,
            string: value.string,
            number: value.number,
            comment: value.comment,
            annotation: value.annotation,
            r#macro: value.r#macro,
            line_number: value.line_number,
            active_line_number: value.active_line_number,
        }
    }
}
impl From<CodeColorsDto> for crate::settings::CodeColors {
    fn from(value: CodeColorsDto) -> Self {
        Self {
            text: value.text,
            background: value.background,
            keyword: value.keyword,
            modifier: value.modifier,
            r#type: value.r#type,
            function: value.function,
            variable: value.variable,
            property: value.property,
            string: value.string,
            number: value.number,
            comment: value.comment,
            annotation: value.annotation,
            r#macro: value.r#macro,
            line_number: value.line_number,
            active_line_number: value.active_line_number,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ThemeColorsDto {
    pub background: Option<String>,
    pub surface: Option<String>,
    pub border: Option<String>,
    pub text: Option<String>,
    pub secondary_text: Option<String>,
    pub hover: Option<String>,
    pub active: Option<String>,
}
impl From<crate::settings::ThemeColors> for ThemeColorsDto {
    fn from(value: crate::settings::ThemeColors) -> Self {
        Self {
            background: value.background,
            surface: value.surface,
            border: value.border,
            text: value.text,
            secondary_text: value.secondary_text,
            hover: value.hover,
            active: value.active,
        }
    }
}
impl From<ThemeColorsDto> for crate::settings::ThemeColors {
    fn from(value: ThemeColorsDto) -> Self {
        Self {
            background: value.background,
            surface: value.surface,
            border: value.border,
            text: value.text,
            secondary_text: value.secondary_text,
            hover: value.hover,
            active: value.active,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    #[serde(default)]
    pub sidebar_hover_reveal: Option<bool>,
    #[serde(default)]
    pub note_layout: Option<String>,
    #[serde(default)]
    pub note_width: Option<f32>,
    #[serde(default)]
    pub highlight_code_occurrences: Option<bool>,
    #[serde(default)]
    pub highlight_markdown_occurrences: Option<bool>,
    #[serde(default)]
    pub custom_themes: Option<Vec<crate::settings::CustomTheme>>,
    #[serde(default)]
    pub active_theme_id: Option<String>,
    pub theme: String,
    pub font_body: Option<String>,
    pub font_mono: Option<String>,
    pub font_scale: f32,
    pub size_h1: Option<f32>,
    pub size_h2: Option<f32>,
    pub size_h3: Option<f32>,
    pub size_h4: Option<f32>,
    pub color_h1: Option<String>,
    pub color_body: Option<String>,
    #[serde(default)]
    pub color_accent: Option<String>,
    #[serde(default)]
    pub code_colors: Option<CodeColorsDto>,
    #[serde(default)]
    pub theme_colors: Option<ThemeColorsDto>,
    pub color_h2: Option<String>,
    pub color_h3: Option<String>,
    pub color_h4: Option<String>,
    pub color_code_bg: Option<String>,
    pub color_code_text: Option<String>,
    pub color_selection: Option<String>,
    pub color_link: Option<String>,
    pub color_link_hover: Option<String>,
    pub line_height: Option<f32>,
    pub custom_fonts: Option<Vec<CustomFontDto>>,
}
impl From<Settings> for SettingsDto {
    fn from(value: Settings) -> Self {
        Self {
            sidebar_hover_reveal: value.sidebar_hover_reveal,
            note_layout: value.note_layout,
            note_width: value.note_width,
            highlight_code_occurrences: value.highlight_code_occurrences,
            highlight_markdown_occurrences: value.highlight_markdown_occurrences,
            custom_themes: value.custom_themes,
            active_theme_id: value.active_theme_id,
            theme: value.theme,
            font_body: value.font_body,
            font_mono: value.font_mono,
            font_scale: value.font_scale,
            size_h1: value.size_h1,
            size_h2: value.size_h2,
            size_h3: value.size_h3,
            size_h4: value.size_h4,
            color_h1: value.color_h1,
            color_body: value.color_body,
            color_accent: value.color_accent,
            code_colors: value.code_colors.map(Into::into),
            theme_colors: value.theme_colors.map(Into::into),
            color_h2: value.color_h2,
            color_h3: value.color_h3,
            color_h4: value.color_h4,
            color_code_bg: value.color_code_bg,
            color_code_text: value.color_code_text,
            color_selection: value.color_selection,
            color_link: value.color_link,
            color_link_hover: value.color_link_hover,
            line_height: value.line_height,
            custom_fonts: value
                .custom_fonts
                .map(|fonts| fonts.into_iter().map(Into::into).collect()),
        }
    }
}
impl From<SettingsDto> for Settings {
    fn from(value: SettingsDto) -> Self {
        Self {
            sidebar_hover_reveal: value.sidebar_hover_reveal,
            note_layout: value.note_layout,
            note_width: value.note_width,
            highlight_code_occurrences: value.highlight_code_occurrences,
            highlight_markdown_occurrences: value.highlight_markdown_occurrences,
            custom_themes: value.custom_themes,
            active_theme_id: value.active_theme_id,
            theme: value.theme,
            font_body: value.font_body,
            font_mono: value.font_mono,
            font_scale: value.font_scale,
            size_h1: value.size_h1,
            size_h2: value.size_h2,
            size_h3: value.size_h3,
            size_h4: value.size_h4,
            color_h1: value.color_h1,
            color_body: value.color_body,
            color_accent: value.color_accent,
            code_colors: value.code_colors.map(Into::into),
            theme_colors: value.theme_colors.map(Into::into),
            color_h2: value.color_h2,
            color_h3: value.color_h3,
            color_h4: value.color_h4,
            color_code_bg: value.color_code_bg,
            color_code_text: value.color_code_text,
            color_selection: value.color_selection,
            color_link: value.color_link,
            color_link_hover: value.color_link_hover,
            line_height: value.line_height,
            custom_fonts: value.custom_fonts.map(|fonts| {
                fonts
                    .into_iter()
                    .map(|font| CustomFont {
                        family: font.family,
                        file_name: font.file_name,
                        weight: font.weight,
                        style: font.style,
                    })
                    .collect()
            }),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipConflictDto {
    pub conflict_id: String,
    pub entry_id: String,
    pub display_name: String,
    pub target_path: String,
    pub origin_members: Vec<String>,
    pub allowed_resolutions: Vec<String>,
    pub kind: String,
}
impl From<ZipConflict> for ZipConflictDto {
    fn from(value: ZipConflict) -> Self {
        Self {
            conflict_id: value.conflict_id,
            entry_id: value.entry_id,
            display_name: value.display_name,
            target_path: value.target_path,
            origin_members: value.origin_members,
            allowed_resolutions: value.allowed_resolutions,
            kind: value.kind,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEventPayload {
    pub entry_id: String,
    pub path: String,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameEventPayload {
    pub entry_id: String,
    pub old_path: String,
    pub new_path: String,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEventPayload {
    pub entry_id: String,
    pub path: String,
    pub changed_file_path: String,
}
