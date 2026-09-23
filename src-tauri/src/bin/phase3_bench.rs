use serde::Serialize;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use tauri_app_lib::collection::{Collection, Entry};
use tauri_app_lib::metadata::{
    MigrationService, MutationOperation, MutationRequest, SqliteMetadataLinkRepository,
    SqliteMetadataRepository,
};
use tauri_app_lib::repositories::ports::{
    CollectionRepository, LinkRepository, MetadataRepository,
};

const SAMPLE_COUNT: usize = 5;

#[derive(Serialize)]
struct Workload {
    name: String,
    profile: String,
    sample_count: usize,
    samples: Vec<f64>,
    summary: Summary,
    changed_entry_rows: Vec<i64>,
    changed_link_rows: Vec<i64>,
    full_rebuild: bool,
}
#[derive(Serialize)]
struct Summary {
    count: usize,
    p50_ms: f64,
    p95_ms: f64,
    max_ms: f64,
}

fn main() -> Result<(), String> {
    let mut workloads = Vec::new();
    for count in [1usize, 1_000, 10_000] {
        workloads.push(measure_migration(count)?);
    }
    workloads.push(measure_incremental_10k()?);
    workloads.push(measure_full_compatibility_10k()?);
    workloads.push(measure_link_search_50k()?);
    let fixture_digest = blake3::hash(
        &serde_json::to_vec(&fixture_json("digest", 50_000)).map_err(|error| error.to_string())?,
    )
    .to_hex()
    .to_string();
    let output = json!({ "schema_version": 1, "phase": "phase3", "mode": if cfg!(debug_assertions) { "debug" } else { "release" }, "sample_policy": "5 warm samples; nearest-rank p50/p95; no timing SLO", "fixture_digest": fixture_digest, "db_pragmas": { "foreign_keys": "ON", "journal_mode": "WAL", "busy_timeout_ms": 5000, "connection_scope": "per-operation" }, "workloads": workloads });
    println!(
        "{}",
        serde_json::to_string_pretty(&output).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn measure_migration(count: usize) -> Result<Workload, String> {
    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    for _ in 0..SAMPLE_COUNT {
        let temp = OwnedTempDir::new("migration")?;
        let value = fixture_json("migration", count);
        fs::write(
            temp.path().join("migration.json"),
            serde_json::to_vec(&value).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let start = Instant::now();
        MigrationService::new(temp.path())
            .migrate()
            .map_err(|error| error.to_string())?;
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    Ok(workload("migration", &count.to_string(), samples))
}

fn measure_incremental_10k() -> Result<Workload, String> {
    let temp = OwnedTempDir::new("incremental")?;
    MigrationService::new(temp.path())
        .migrate()
        .map_err(|error| error.to_string())?;
    let repository = SqliteMetadataRepository::new(temp.path());
    repository
        .save(&collection_fixture("incremental", 10_000))
        .map_err(|error| error.to_string())?;
    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    let mut entry_rows = Vec::with_capacity(SAMPLE_COUNT);
    let mut link_rows = Vec::with_capacity(SAMPLE_COUNT);
    for (index, expected_revision) in (1_i64..).take(SAMPLE_COUNT).enumerate() {
        let start = Instant::now();
        let result = repository
            .apply_mutation(MutationRequest {
                collection_id: "incremental".into(),
                expected_revision,
                mutation_id: format!("bench-{index}"),
                operation: MutationOperation::AddEntry {
                    parent_path: Vec::new(),
                    entry: Entry::File {
                        id: format!("new-{index}"),
                        path: format!("C:/bench/new-{index}.md"),
                    },
                },
            })
            .map_err(|error| error.to_string())?;
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
        entry_rows.push(result.metrics.changed_entry_rows);
        link_rows.push(result.metrics.changed_link_rows);
    }
    Ok(workload_with_metrics(
        "incremental_mutation",
        "10k",
        samples,
        entry_rows,
        link_rows,
        false,
    ))
}

fn measure_full_compatibility_10k() -> Result<Workload, String> {
    let temp = OwnedTempDir::new("compatibility")?;
    MigrationService::new(temp.path())
        .migrate()
        .map_err(|error| error.to_string())?;
    let repository = SqliteMetadataRepository::new(temp.path());
    let collection = collection_fixture("compatibility", 10_000);
    repository
        .save(&collection)
        .map_err(|error| error.to_string())?;
    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    let mut entry_rows = Vec::with_capacity(SAMPLE_COUNT);
    let mut link_rows = Vec::with_capacity(SAMPLE_COUNT);
    for _ in 0..SAMPLE_COUNT {
        let start = Instant::now();
        let metrics = repository.save_full_compatibility(&collection)?;
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
        entry_rows.push(metrics.changed_entry_rows);
        link_rows.push(metrics.changed_link_rows);
    }
    Ok(workload_with_metrics(
        "compatibility_full_save",
        "10k",
        samples,
        entry_rows,
        link_rows,
        true,
    ))
}

fn measure_link_search_50k() -> Result<Workload, String> {
    let temp = OwnedTempDir::new("links")?;
    MigrationService::new(temp.path())
        .migrate()
        .map_err(|error| error.to_string())?;
    let repository = SqliteMetadataRepository::new(temp.path());
    repository
        .save(&collection_fixture("links", 50_000))
        .map_err(|error| error.to_string())?;
    let links = SqliteMetadataLinkRepository::new(temp.path());
    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    for _ in 0..SAMPLE_COUNT {
        let start = Instant::now();
        let results = links.search("links", "Note 49", 20)?;
        if results.is_empty() {
            return Err("link search fixture returned no result".into());
        }
        let _ = links.resolve("links", "Note 499");
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    Ok(workload("link_rebuild_search", "50k", samples))
}

fn collection_fixture(id: &str, count: usize) -> Collection {
    Collection {
        id: id.into(),
        schema_version: 1,
        name: id.into(),
        created_at: "2026-08-22T00:00:00Z".into(),
        updated_at: "2026-08-22T00:00:00Z".into(),
        entries: (0..count)
            .map(|index| Entry::File {
                id: format!("entry-{index}"),
                path: format!("C:/bench/Note {index}.md"),
            })
            .collect(),
        metadata: None,
    }
}

fn fixture_json(id: &str, count: usize) -> serde_json::Value {
    serde_json::to_value(collection_fixture(id, count)).unwrap_or_else(|_| json!({}))
}
fn workload(name: &str, profile: &str, samples: Vec<f64>) -> Workload {
    workload_with_metrics(name, profile, samples, Vec::new(), Vec::new(), false)
}
fn workload_with_metrics(
    name: &str,
    profile: &str,
    samples: Vec<f64>,
    changed_entry_rows: Vec<i64>,
    changed_link_rows: Vec<i64>,
    full_rebuild: bool,
) -> Workload {
    let mut ordered = samples.clone();
    ordered.sort_by(f64::total_cmp);
    Workload {
        name: name.into(),
        profile: profile.into(),
        sample_count: samples.len(),
        summary: Summary {
            count: samples.len(),
            p50_ms: nearest_rank(&ordered, 0.50),
            p95_ms: nearest_rank(&ordered, 0.95),
            max_ms: *ordered.last().unwrap_or(&0.0),
        },
        samples,
        changed_entry_rows,
        changed_link_rows,
        full_rebuild,
    }
}

struct OwnedTempDir {
    path: PathBuf,
}
impl OwnedTempDir {
    fn new(label: &str) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!(
            "collectives-phase3-{label}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&path).map_err(|error| error.to_string())?;
        Ok(Self { path })
    }
    fn path(&self) -> &PathBuf {
        &self.path
    }
}
impl Drop for OwnedTempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
fn nearest_rank(samples: &[f64], percentile: f64) -> f64 {
    let index = ((samples.len() as f64 * percentile).ceil() as usize)
        .max(1)
        .min(samples.len())
        - 1;
    samples[index]
}
