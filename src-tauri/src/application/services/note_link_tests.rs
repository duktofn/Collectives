#[cfg(test)]
mod note_link_tests {
    use super::super::*;

    fn scan_folder(
        root: &Path,
        note_name: &str,
        cap: usize,
    ) -> Result<Vec<NoteLinkCandidate>, String> {
        let mut scan_count = 0;
        let mut validation_bytes = 0;
        let mut seen_paths = HashSet::new();
        scan_folder_ref(
            "folder-ref-id",
            &root.to_string_lossy(),
            note_name,
            FolderRefScanState {
                scan_count: &mut scan_count,
                validation_bytes: &mut validation_bytes,
                seen_paths: &mut seen_paths,
                scan_cap: cap,
            },
            |root, directory, limit| {
                crate::fs_ops::read_folder_ref_children_bounded(
                    Path::new(root),
                    Path::new(directory),
                    limit,
                )
            },
            |root, path| {
                crate::fs_ops::note_link_file_identity(Path::new(path), Some(Path::new(root))).map(
                    |identity| {
                        identity.map(|(canonical_path, size)| NoteLinkFileIdentity {
                            canonical_path,
                            size,
                        })
                    },
                )
            },
            |root, path, size| {
                document_validation(
                    crate::repositories::documents::read_folderref_snapshot(
                        root.to_string(),
                        path.to_string(),
                    ),
                    size,
                )
            },
        )
    }

    #[test]
    fn resolves_nested_folder_ref_files_without_ui_expansion_and_keeps_root_paths() {
        let temp = tempfile::tempdir().unwrap();
        let nested = temp.path().join("collapsed").join("deep");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("Note.markdown"), "# Note\n").unwrap();

        let candidates = scan_folder(temp.path(), "note", 10).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(
            candidates[0].folder_ref_entry_id.as_deref(),
            Some("folder-ref-id")
        );
        assert_eq!(
            candidates[0].folder_ref_root_path.as_deref(),
            temp.path().to_str()
        );
        assert_eq!(
            candidates[0].path,
            crate::fs_ops::normalize_path(&nested.join("Note.markdown").to_string_lossy())
        );
    }

    #[test]
    fn note_name_is_compared_as_a_filename_and_binary_files_are_not_candidates() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("outside.md"), "text").unwrap();
        std::fs::write(temp.path().join("Binary.md"), [0u8, 1, 2]).unwrap();

        assert!(scan_folder(temp.path(), "../outside", 10)
            .unwrap()
            .is_empty());
        assert!(scan_folder(temp.path(), "Binary", 10).unwrap().is_empty());
    }

    #[test]
    fn nested_groups_contribute_folder_refs_independent_of_expansion_state() {
        let entries = vec![Entry::Group {
            id: "outer".into(),
            name: "Outer".into(),
            children: vec![Entry::Group {
                id: "inner".into(),
                name: "Inner".into(),
                children: vec![Entry::FolderRef {
                    id: "ref".into(),
                    path: "C:/notes".into(),
                }],
            }],
        }];
        let mut count = 0;
        let roots = collect_folder_ref_roots(&entries, &mut count).unwrap();
        assert_eq!(roots, vec![("ref".into(), "C:/notes".into())]);
    }

    #[test]
    fn traversal_cap_fails_before_candidate_content_is_read() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("Note.md"), "# Note\n").unwrap();
        let mut scan_count = 0;
        let mut validation_bytes = 0;
        let mut seen_paths = HashSet::new();
        let result = scan_folder_ref(
            "folder-ref-id",
            &temp.path().to_string_lossy(),
            "Note",
            FolderRefScanState {
                scan_count: &mut scan_count,
                validation_bytes: &mut validation_bytes,
                seen_paths: &mut seen_paths,
                scan_cap: 0,
            },
            |root, directory, limit| {
                crate::fs_ops::read_folder_ref_children_bounded(
                    Path::new(root),
                    Path::new(directory),
                    limit,
                )
            },
            |root, path| {
                crate::fs_ops::note_link_file_identity(Path::new(path), Some(Path::new(root))).map(
                    |identity| {
                        identity.map(|(canonical_path, size)| NoteLinkFileIdentity {
                            canonical_path,
                            size,
                        })
                    },
                )
            },
            |_root, _path, _size| panic!("content must not be read past the traversal cap"),
        );
        assert!(result.unwrap_err().contains("traversal limit"));
    }

    #[test]
    fn byte_budget_uses_snapshot_size_when_listed_size_is_stale() {
        let snapshot = crate::repositories::documents::DocumentSnapshot {
            content: "x".repeat(4096),
            version_token: "token".into(),
            file_kind: Some("markdown".into()),
            had_utf8_bom: Some(true),
            line_ending: Some("none".into()),
            byte_size: Some(2),
        };
        let (valid, bytes_read) = document_validation(Ok(snapshot), 1).unwrap();
        assert!(valid);
        assert_eq!(bytes_read, 4099);
    }

    #[test]
    fn unsupported_candidate_read_is_charged_conservatively() {
        let error = SafetyError::new("unsupported_file", "binary note")
            .with_details(serde_json::json!({ "reason": "nul" }));
        let result: Result<crate::repositories::documents::DocumentSnapshot, SafetyError> =
            Err(error);
        let (valid, bytes_read) = document_validation(result, 1).unwrap();
        assert!(!valid);
        assert_eq!(bytes_read, MAX_NOTE_LINK_READ_BYTES);

        let mut budget = MAX_NOTE_LINK_VALIDATION_BYTES - bytes_read + 1;
        assert!(charge_validation_bytes(&mut budget, bytes_read).is_err());
    }
}

#[cfg(test)]
mod note_link_service_tests {
    use super::super::*;
    use crate::collection::model::CollectionMetadata;
    use crate::repositories::ports::{
        ArchiveRepository, CollectionRepository, DocumentRepository, FilesystemRepository,
        NoteLinkFileIdentity, SettingsRepository,
    };

    #[derive(Clone)]
    struct TestRepositories {
        collection: Collection,
    }

    impl CollectionRepository for TestRepositories {
        fn get_all(&self) -> Result<Vec<Collection>, String> {
            Ok(vec![self.collection.clone()])
        }
        fn load(&self, id: &str) -> Result<Collection, String> {
            if id == self.collection.id {
                Ok(self.collection.clone())
            } else {
                Err("collection not found".into())
            }
        }
        fn save(&self, _collection: &Collection) -> Result<(), String> {
            unimplemented!()
        }
        fn delete(&self, _id: &str) -> Result<(), String> {
            unimplemented!()
        }
        fn add_entry(
            &self,
            _collection_id: &str,
            _parent_path: &[usize],
            _entry: Entry,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn remove_entry(&self, _collection_id: &str, _entry_id: &str) -> Result<Entry, String> {
            unimplemented!()
        }
        fn move_entry(
            &self,
            _collection_id: &str,
            _entry_id: &str,
            _parent_path: &[usize],
            _new_index: usize,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn delete_group_and_promote(
            &self,
            _collection_id: &str,
            _group_id: &str,
        ) -> Result<(), String> {
            unimplemented!()
        }
    }

    impl ArchiveRepository for TestRepositories {
        fn import_folder(&self, _path: &str, _name: &str) -> Result<Collection, String> {
            unimplemented!()
        }
        fn export_folder(&self, _collection_id: &str, _destination: &str) -> Result<(), String> {
            unimplemented!()
        }
        fn export_zip(&self, _collection_id: &str, _destination: &str) -> Result<(), String> {
            unimplemented!()
        }
        fn check_zip_conflicts(
            &self,
            _zip_path: &str,
            _destination: &str,
        ) -> Result<Vec<ZipConflict>, String> {
            unimplemented!()
        }
        fn import_zip(
            &self,
            _zip_path: &str,
            _destination: &str,
            _resolutions: std::collections::HashMap<String, String>,
        ) -> Result<Collection, String> {
            unimplemented!()
        }
    }

    impl DocumentRepository for TestRepositories {
        fn search_content(
            &self,
            _indexed: Vec<crate::link_index::IndexEntry>,
            _query: &str,
            _offset: usize,
            _limit: usize,
        ) -> Result<crate::application::domain::ContentSearchPage, String> {
            unimplemented!()
        }
        fn read(
            &self,
            path: &str,
        ) -> Result<crate::repositories::documents::DocumentSnapshot, SafetyError> {
            crate::repositories::documents::read_file(path.to_string())
        }
        fn read_folderref_snapshot(
            &self,
            root_path: &str,
            child_path: &str,
        ) -> Result<crate::repositories::documents::DocumentSnapshot, SafetyError> {
            crate::repositories::documents::read_folderref_snapshot(
                root_path.to_string(),
                child_path.to_string(),
            )
        }
        fn write(
            &self,
            _path: &str,
            _content: &str,
            _precondition: crate::repositories::documents::WritePrecondition,
        ) -> Result<crate::repositories::documents::DocumentWriteReceipt, SafetyError> {
            unimplemented!()
        }
        fn create_new(
            &self,
            _path: &str,
            _content: &str,
        ) -> Result<crate::repositories::documents::DocumentWriteReceipt, SafetyError> {
            unimplemented!()
        }
    }

    impl SettingsRepository for TestRepositories {
        fn load(&self) -> Settings {
            unimplemented!()
        }
        fn save(&self, _settings: Settings) -> Result<(), String> {
            unimplemented!()
        }
        fn import_font(
            &self,
            _source: &str,
            _family: &str,
            _weight: &str,
            _style: &str,
        ) -> Result<CustomFont, String> {
            unimplemented!()
        }
        fn import_font_base64(
            &self,
            _preferred_file_name: &str,
            _family: &str,
            _weight: &str,
            _style: &str,
            _data_base64: &str,
        ) -> Result<CustomFont, String> {
            unimplemented!()
        }
        fn delete_font(&self, _file_name: &str) -> Result<(), String> {
            unimplemented!()
        }
        fn fonts_dir(&self) -> Result<String, String> {
            unimplemented!()
        }
        fn export_theme(&self, _settings: &Settings, _destination: &str) -> Result<(), String> {
            unimplemented!()
        }
        fn import_theme(&self, _path: &str) -> Result<crate::theme_io::ImportedTheme, String> {
            unimplemented!()
        }
    }

    impl FilesystemRepository for TestRepositories {
        fn read_children(&self, path: &str) -> Result<Vec<FsEntry>, String> {
            crate::fs_ops::read_children(Path::new(path))
        }
        fn note_link_file_identity(
            &self,
            path: &str,
            folder_ref_root: Option<&str>,
        ) -> Result<Option<NoteLinkFileIdentity>, String> {
            crate::fs_ops::note_link_file_identity(Path::new(path), folder_ref_root.map(Path::new))
                .map(|identity| {
                    identity.map(|(canonical_path, size)| NoteLinkFileIdentity {
                        canonical_path,
                        size,
                    })
                })
        }
        fn read_folder_ref_children(
            &self,
            root_path: &str,
            directory_path: &str,
            limit: usize,
        ) -> Result<Vec<FsEntry>, String> {
            crate::fs_ops::read_folder_ref_children_bounded(
                Path::new(root_path),
                Path::new(directory_path),
                limit,
            )
        }
        fn normalize(&self, path: &str) -> String {
            crate::fs_ops::normalize_path(path)
        }
        fn exists(&self, path: &str) -> bool {
            Path::new(path).exists()
        }
        fn watch_entry(
            &self,
            _state: &crate::fs_layer::watcher::WatchState,
            _path: &str,
            _entry_id: &str,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn unwatch_entry(
            &self,
            _state: &crate::fs_layer::watcher::WatchState,
            _path: &str,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn watch_folder(
            &self,
            _state: &crate::fs_layer::watcher::WatchState,
            _path: &str,
            _entry_id: &str,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn unwatch_folder(
            &self,
            _state: &crate::fs_layer::watcher::WatchState,
            _path: &str,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn clear_watches(
            &self,
            _state: &crate::fs_layer::watcher::WatchState,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn sync_collection_watches(
            &self,
            _state: &crate::fs_layer::watcher::WatchState,
            _collection_id: &str,
            _specs: &[crate::fs_layer::watcher::WatchSpec],
        ) -> Result<crate::fs_layer::watcher::WatchCursor, String> {
            unimplemented!()
        }
        fn initialize_identity_cache(
            &self,
            _cache: &crate::fs_layer::file_identity::FileIdentityCache,
            _collection_id: &str,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn detect_moved_entry(
            &self,
            _cache: &crate::fs_layer::file_identity::FileIdentityCache,
            _collection_id: &str,
            _entry_id: &str,
            _old_path: &str,
        ) -> Result<Option<String>, String> {
            unimplemented!()
        }
    }

    #[test]
    fn resolve_wikilink_merges_group_and_unwatched_folder_ref_duplicates_stably() {
        let temp = tempfile::tempdir().unwrap();
        let group_dir = temp.path().join("collection").join("group");
        let folder_ref = temp.path().join("external");
        std::fs::create_dir_all(&group_dir).unwrap();
        std::fs::create_dir_all(folder_ref.join("collapsed")).unwrap();
        let group_note = group_dir.join("Note.md");
        let source_note = group_dir.join("Source.md");
        let folder_note = folder_ref.join("collapsed").join("Note.md");
        std::fs::write(&group_note, "# Group note\n").unwrap();
        std::fs::write(&source_note, "# Source\n").unwrap();
        std::fs::write(&folder_note, "# Folder note\n").unwrap();

        let collection = Collection {
            id: "collection".into(),
            schema_version: 1,
            name: "Collection".into(),
            created_at: String::new(),
            updated_at: String::new(),
            entries: vec![
                Entry::Group {
                    id: "group".into(),
                    name: "Group".into(),
                    children: vec![Entry::File {
                        id: "group-note".into(),
                        path: group_note.to_string_lossy().into_owned(),
                    }],
                },
                Entry::FolderRef {
                    id: "folder-ref".into(),
                    path: folder_ref.to_string_lossy().into_owned(),
                },
            ],
            metadata: Some(CollectionMetadata {
                last_validated_at: None,
                broken_entry_ids: Vec::new(),
            }),
        };
        let links = crate::repositories::adapters::SqliteLinkRepository::new(
            temp.path().join("links.sqlite"),
        );
        links.update_collection(&collection).unwrap();
        let repositories = Arc::new(TestRepositories { collection });
        let collection_repository: Arc<dyn CollectionRepository> = repositories.clone();
        let archive_repository: Arc<dyn ArchiveRepository> = repositories.clone();
        let document_repository: Arc<dyn DocumentRepository> = repositories.clone();
        let settings_repository: Arc<dyn SettingsRepository> = repositories.clone();
        let filesystem_repository: Arc<dyn FilesystemRepository> = repositories;
        let services = AppServices::from_repositories(
            collection_repository,
            archive_repository,
            document_repository,
            settings_repository,
            Arc::new(links),
            filesystem_repository,
        );

        let candidates = resolve_wikilink(
            &services,
            "collection".into(),
            "Note".into(),
            Some(source_note.to_string_lossy().into_owned()),
        )
        .unwrap();
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].entry_id, "group-note");
        assert_eq!(candidates[0].path, group_note.to_string_lossy());
        assert_eq!(
            candidates[1].folder_ref_entry_id.as_deref(),
            Some("folder-ref")
        );
        assert_eq!(
            candidates[1].folder_ref_root_path.as_deref(),
            Some(folder_ref.to_string_lossy().as_ref())
        );
        assert_eq!(
            candidates[1].path,
            crate::fs_ops::normalize_path(&folder_note.to_string_lossy())
        );
    }
}
