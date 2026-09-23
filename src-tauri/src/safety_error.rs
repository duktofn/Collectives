use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SafetyError {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub details: Value,
}

impl SafetyError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: Value::Null,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = details;
        self
    }
}

impl Display for SafetyError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for SafetyError {}

impl From<String> for SafetyError {
    fn from(message: String) -> Self {
        let known = [
            "invalid_archive_member",
            "archive_quota",
            "duplicate_archive_member",
            "internal_archive_collision",
            "duplicate_destination",
            "unresolved_conflict",
            "source_missing",
            "stage_failed",
            "commit_failed",
            "rollback_pending",
            "recoverable_transaction",
            "collection_persist_failed",
            "stale_read",
            "external_change_conflict",
            "save_failed",
        ];
        if let Some((code, detail)) = message.split_once(": ") {
            if known.contains(&code) {
                return Self::new(code, detail);
            }
        }
        Self::new("recoverable_transaction", message)
    }
}

impl From<&str> for SafetyError {
    fn from(message: &str) -> Self {
        Self::new("recoverable_transaction", message)
    }
}
