# Phase 3 — metadata/index/watcher baseline

Phase 3 introduces a staged SQLite metadata-v1 bundle without deleting the legacy collection JSON or `link-index.db`. The migration source is authoritative collection JSON only. A validated create-new lease serializes migration ownership; journal states are persisted with operation status and backup manifests before publication.

The v1 schema uses composite `(collection_id,id)` identity, stable `parent_id`/`sort_order`, collection revisions, durable change envelopes, bounded feed state, and a composite link index. Staging enables foreign keys, WAL, busy timeout, parity checks, `integrity_check`, `foreign_key_check`, WAL `TRUNCATE` checkpoint, connection close, and sidecar verification before publication. `metadata-v1.state` changes to `sqlite_canonical` only after the DB digest is published and verified. After the first canonical mutation, a changed or malformed JSON backup cannot cause fallback to stale JSON.

Normal repository writes use a per-operation SQLite connection and affected-row/index diffs. V2 mutations look up `mutation_id` before checking `expectedRevision`, persist one collection revision and one `collection_changes` envelope, and return `metadata_revision_conflict` for stale intents. The link index is updated from the affected entries and retains `source_revision`.

Filesystem notifications use a bounded `std::sync_channel`, a 150 ms receive window, batches capped at 256 changes, process stream ID, subscription epoch, monotonic sequence, overflow signaling, and legacy event emission for compatibility. Frontend metadata cache code is normalized by `collectionId:entryId`, validates deltas atomically, and requests one snapshot fallback for a gap, overflow, unknown kind, or invariant failure.

Evidence is generated under ignored `artifacts/phase3/<run-id>/` by `scripts/phase3/run-wp1-evidence.mjs`. The preflight/reconciliation pair preserves all prior Phase 0–2 artifacts and user state, including the protected Cargo.toml fingerprints.

SQLite `NOCASE` remains an ASCII-oriented compatibility constraint; the authoritative Unicode collision rule is the Rust simple-lowercase `name_key` uniqueness check. No Phase 4 UI redesign or performance SLO claim is included.
