// Compatibility shim: the generated IPC command layer calls application services directly.
// Keep this re-export during Phase 2 so existing internal/tests retain their symbols.
pub use crate::application::services::*;
