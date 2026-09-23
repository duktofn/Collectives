use tauri_app_lib::ipc::dto::{FileEventPayload, FolderEventPayload, RenameEventPayload};
use tauri_app_lib::ipc::generated::{IPC_COMMANDS, IPC_COMMAND_COUNT, IPC_VERSION};

#[test]
fn generated_ipc_contract_has_exact_phase2_registry() {
    assert_eq!(IPC_VERSION, "ipc.v1");
    assert_eq!(IPC_COMMAND_COUNT, 37);
    assert_eq!(IPC_COMMANDS.len(), 37);
    assert_eq!(IPC_COMMANDS.first().unwrap().name, "get_collections");
    assert_eq!(IPC_COMMANDS.last().unwrap().name, "detect_moved_entry");
    assert!(IPC_COMMANDS
        .iter()
        .any(|command| command.name == "delete_group_and_promote"));
    assert!(IPC_COMMANDS
        .iter()
        .any(|command| command.handler == "ipc::commands::filesystem::watch_entry"));
}

#[test]
fn event_dto_wire_keys_remain_camel_case() {
    let renamed = serde_json::to_value(RenameEventPayload {
        entry_id: "e".into(),
        old_path: "a".into(),
        new_path: "b".into(),
    })
    .unwrap();
    assert_eq!(
        renamed,
        serde_json::json!({"entryId":"e","oldPath":"a","newPath":"b"})
    );
    let modified = serde_json::to_value(FileEventPayload {
        entry_id: "e".into(),
        path: "b".into(),
    })
    .unwrap();
    assert_eq!(modified, serde_json::json!({"entryId":"e","path":"b"}));
    let changed = serde_json::to_value(FolderEventPayload {
        entry_id: "f".into(),
        path: "dir".into(),
        changed_file_path: "dir/note.md".into(),
    })
    .unwrap();
    assert_eq!(
        changed,
        serde_json::json!({"entryId":"f","path":"dir","changedFilePath":"dir/note.md"})
    );
}
