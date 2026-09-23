use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;
use std::time::Instant;
use tauri_app_lib::collection::{archive, manager, Collection, Entry};
use tauri_app_lib::link_index;

#[derive(Debug, Deserialize, Serialize, Clone)]
struct Sample {
    elapsed_ms: f64,
    peak_rss_bytes: u64,
}

#[derive(Debug, Serialize, Clone)]
struct Summary {
    count: usize,
    p50: f64,
    p95: f64,
    max: f64,
    nearest_rank: &'static str,
}

#[derive(Debug, Serialize)]
struct WorkloadReport {
    workload: String,
    samples: Vec<Sample>,
    elapsed_summary: Summary,
    peak_rss_summary: Summary,
}

#[derive(Debug, Serialize)]
struct Report {
    schema_version: u32,
    run_id: String,
    workload: &'static str,
    profile: String,
    metric_kind: &'static str,
    status: &'static str,
    exit_code: i32,
    error: Option<String>,
    raw_samples: Vec<Sample>,
    summary: Summary,
    provenance: Provenance,
    workloads: Vec<WorkloadReport>,
}

#[derive(Debug, Serialize)]
struct Provenance {
    command: String,
    collector_source: &'static str,
    scratch_root: String,
    fixture_root: String,
    memory_method: &'static str,
    memory_scope: &'static str,
}

struct Args {
    fixture_root: PathBuf,
    scratch_root: PathBuf,
    output: Option<PathBuf>,
    samples: usize,
    run_id: String,
    workloads: Vec<String>,
    worker: bool,
    workload: Option<String>,
    sample_index: usize,
}

fn parse_args() -> Result<Args, String> {
    let mut fixture_root = None;
    let mut scratch_root = None;
    let mut output = None;
    let mut samples = 5;
    let mut run_id = String::from("phase0-backend");
    let mut workloads = vec![
        "collection-json-load-mutation".to_string(),
        "sqlite-link-index-rebuild-search".to_string(),
        "temporary-file-read-write".to_string(),
        "trusted-zip-export-import".to_string(),
    ];
    let mut worker = false;
    let mut workload = None;
    let mut sample_index = 0;
    let values: Vec<String> = env::args().skip(1).collect();
    let mut index = 0;
    while index < values.len() {
        let key = &values[index];
        let value = |position: usize| {
            values
                .get(position)
                .cloned()
                .ok_or_else(|| format!("Missing value for {key}"))
        };
        if key == "--worker" {
            worker = true;
            index += 1;
            continue;
        }
        match key.as_str() {
            "--fixture-root" => fixture_root = Some(PathBuf::from(value(index + 1)?)),
            "--scratch-root" => scratch_root = Some(PathBuf::from(value(index + 1)?)),
            "--output" => output = Some(PathBuf::from(value(index + 1)?)),
            "--samples" => {
                samples = value(index + 1)?
                    .parse()
                    .map_err(|_| "--samples must be an integer".to_string())?
            }
            "--run-id" => run_id = value(index + 1)?,
            "--workload" => workload = Some(value(index + 1)?),
            "--sample-index" => sample_index = value(index + 1)?.parse().map_err(|_| "--sample-index must be an integer".to_string())?,
            "--workloads" => {
                workloads = value(index + 1)?
                    .split(',')
                    .filter(|name| !name.is_empty())
                    .map(str::to_string)
                    .collect();
            }
            "--help" => {
                return Err("Usage: phase0_bench --fixture-root <dir> --scratch-root <dir> --output <json> --samples <n> --run-id <id>".to_string())
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
        index += 2;
    }
    if samples == 0 {
        return Err("--samples must be greater than zero".to_string());
    }
    if workloads.is_empty() {
        return Err("--workloads must contain at least one workload".to_string());
    }
    Ok(Args {
        fixture_root: fixture_root.ok_or_else(|| "--fixture-root is required".to_string())?,
        scratch_root: scratch_root.ok_or_else(|| "--scratch-root is required".to_string())?,
        output,
        samples,
        run_id,
        workloads,
        worker,
        workload,
        sample_index,
    })
}

fn memory_method() -> &'static str {
    if cfg!(windows) {
        "Windows Get-Process PeakWorkingSet64 (OS-provided peak RSS since process start)"
    } else if cfg!(unix) {
        "Linux /proc/self/status VmHWM (OS-provided peak RSS since process start)"
    } else {
        "unsupported"
    }
}

fn peak_rss_bytes() -> u64 {
    #[cfg(windows)]
    {
        let script = format!("(Get-Process -Id {}).PeakWorkingSet64", std::process::id());
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(0)
    }
    #[cfg(unix)]
    {
        fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|status| status.lines().find(|line| line.starts_with("VmHWM:")))
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u64>().ok())
            .map(|kilobytes| kilobytes * 1024)
            .unwrap_or(0)
    }
    #[cfg(not(any(windows, unix)))]
    {
        0
    }
}

fn nearest_rank(values: &[f64], percentile: f64) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = ((percentile * sorted.len() as f64).ceil() as usize)
        .max(1)
        .min(sorted.len());
    sorted[rank - 1]
}

fn summary(values: &[f64]) -> Summary {
    Summary {
        count: values.len(),
        p50: nearest_rank(values, 0.50),
        p95: nearest_rank(values, 0.95),
        max: values.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        nearest_rank: "rank = ceil(percentile * sample_count), 1-indexed after ascending sort",
    }
}

fn run_samples<F>(samples: usize, mut operation: F) -> Result<Vec<Sample>, String>
where
    F: FnMut(usize) -> Result<(), String>,
{
    let mut result = Vec::with_capacity(samples);
    for index in 0..samples {
        let started = Instant::now();
        operation(index)?;
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        let peak_rss_bytes = peak_rss_bytes();
        if !elapsed_ms.is_finite() || elapsed_ms < 0.0 || peak_rss_bytes == 0 {
            return Err(format!(
                "non-finite, negative, or unavailable metric at sample {index}; memory method: {}",
                memory_method()
            ));
        }
        result.push(Sample {
            elapsed_ms,
            peak_rss_bytes,
        });
    }
    Ok(result)
}

fn fixture_collection(fixture: &Path) -> Result<Collection, String> {
    serde_json::from_slice(
        &fs::read(fixture.join("collection/collection.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("fixture collection is not a product Collection: {error}"))
}

fn absolutize_entries(entries: &mut [Entry], fixture: &Path) {
    for entry in entries {
        match entry {
            Entry::File { path, .. } | Entry::FolderRef { path, .. } => {
                *path = fixture.join(&*path).display().to_string();
            }
            Entry::Group { children, .. } => absolutize_entries(children, fixture),
        }
    }
}

fn product_collection(fixture: &Path) -> Result<Collection, String> {
    let mut collection = fixture_collection(fixture)?;
    absolutize_entries(&mut collection.entries, fixture);
    Ok(collection)
}

fn collection_workload(
    fixture: &Path,
    scratch: &Path,
    samples: usize,
) -> Result<Vec<Sample>, String> {
    let source = product_collection(fixture)?;
    run_samples(samples, |index| {
        let collections_dir = scratch.join(format!("collection-product-{index}"));
        fs::create_dir_all(&collections_dir).map_err(|error| error.to_string())?;
        manager::save_collection_to_path(&collections_dir, &source)?;
        let loaded = manager::load_collection_from_path(&collections_dir, &source.id)?;
        if loaded.entries.len() != source.entries.len() {
            return Err("product collection load changed entry count".to_string());
        }
        manager::add_entry_to_collection_path(
            &collections_dir,
            &source.id,
            &[],
            Entry::File {
                id: format!("phase0-mutation-{index}"),
                path: fixture.join("io/payload.bin").display().to_string(),
            },
        )?;
        let mutated = manager::load_collection_from_path(&collections_dir, &source.id)?;
        if mutated.entries.len() != source.entries.len() + 1 {
            return Err("product collection mutation did not persist".to_string());
        }
        Ok(())
    })
}

fn indexed_collection(fixture: &Path) -> Result<Collection, String> {
    let base = product_collection(fixture)?;
    let lines =
        fs::read_to_string(fixture.join("index/index.jsonl")).map_err(|error| error.to_string())?;
    let mut entries = Vec::new();
    for line in lines.lines() {
        let value: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
        let id = value["id"]
            .as_str()
            .ok_or_else(|| "index fixture entry has no id".to_string())?;
        let path = value["path"]
            .as_str()
            .ok_or_else(|| "index fixture entry has no path".to_string())?;
        entries.push(Entry::File {
            id: id.to_string(),
            path: fixture.join(path).display().to_string(),
        });
    }
    Ok(Collection {
        id: format!("{}-index", base.id),
        schema_version: base.schema_version,
        name: format!("{} index", base.name),
        created_at: base.created_at,
        updated_at: base.updated_at,
        entries,
        metadata: None,
    })
}

fn index_workload(fixture: &Path, scratch: &Path, samples: usize) -> Result<Vec<Sample>, String> {
    let collection = indexed_collection(fixture)?;
    run_samples(samples, |index| {
        let db_path = scratch.join(format!("product-link-index-{index}.db"));
        let connection = link_index::init_db_at_path(&db_path)?;
        link_index::rebuild_index_from_collections(&connection, std::slice::from_ref(&collection))?;
        let results = link_index::search_by_name(&connection, &collection.id, "entry", 10)?;
        if results.is_empty() {
            return Err("product link-index search returned no generated entries".to_string());
        }
        Ok(())
    })
}

fn io_workload(fixture: &Path, scratch: &Path, samples: usize) -> Result<Vec<Sample>, String> {
    let source = fixture.join("io/payload.bin");
    let bytes = fs::read(source).map_err(|error| error.to_string())?;
    run_samples(samples, |index| {
        let path = scratch.join(format!("io-{index}.bin"));
        let mut file = File::create(&path).map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        let mut read_back = Vec::with_capacity(bytes.len());
        File::open(path)
            .map_err(|error| error.to_string())?
            .read_to_end(&mut read_back)
            .map_err(|error| error.to_string())?;
        if read_back != bytes {
            return Err("I/O roundtrip checksum mismatch".to_string());
        }
        Ok(())
    })
}

fn archive_workload(fixture: &Path, scratch: &Path, samples: usize) -> Result<Vec<Sample>, String> {
    let source = product_collection(fixture)?;
    let trusted_zip = fixture.join("trusted/fixture.zip");
    run_samples(samples, |index| {
        let export_collections_dir = scratch.join(format!("archive-export-{index}"));
        let import_collections_dir = scratch.join(format!("archive-import-{index}"));
        let import_destination = scratch.join(format!("archive-destination-{index}"));
        fs::create_dir_all(&export_collections_dir).map_err(|error| error.to_string())?;
        fs::create_dir_all(&import_collections_dir).map_err(|error| error.to_string())?;
        manager::save_collection_to_path(&export_collections_dir, &source)?;
        let exported_zip = scratch.join(format!("product-export-{index}.zip"));
        archive::export_to_zip(&export_collections_dir, &source.id, &exported_zip)?;
        if fs::metadata(&exported_zip)
            .map_err(|error| error.to_string())?
            .len()
            == 0
        {
            return Err("product archive export produced an empty ZIP".to_string());
        }
        let imported = archive::import_zip(
            &import_collections_dir,
            &trusted_zip,
            &import_destination,
            HashMap::new(),
        )?;
        if imported.entries.len() != source.entries.len() {
            return Err(format!(
                "trusted generated ZIP profile mismatch: imported {} entries, expected {}",
                imported.entries.len(),
                source.entries.len()
            ));
        }
        Ok(())
    })
}

fn run_child_sample(args: &Args, workload: &str, sample_index: usize) -> Result<Sample, String> {
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    let child = Command::new(executable)
        .arg("--worker")
        .arg("--fixture-root")
        .arg(&args.fixture_root)
        .arg("--scratch-root")
        .arg(&args.scratch_root)
        .arg("--workload")
        .arg(workload)
        .arg("--sample-index")
        .arg(sample_index.to_string())
        .arg("--run-id")
        .arg(&args.run_id)
        .output()
        .map_err(|error| format!("failed to launch benchmark worker: {error}"))?;
    if !child.status.success() {
        return Err(format!(
            "benchmark worker failed for {workload} sample {sample_index}: {}",
            String::from_utf8_lossy(&child.stderr)
        ));
    }
    serde_json::from_slice::<Sample>(&child.stdout).map_err(|error| {
        format!(
            "benchmark worker returned invalid sample for {workload} sample {sample_index}: {error}; stdout={}",
            String::from_utf8_lossy(&child.stdout)
        )
    })
}

fn run_worker(args: &Args) -> Result<(), String> {
    let workload = args
        .workload
        .as_deref()
        .ok_or_else(|| "worker workload is required".to_string())?;
    let worker_scratch = args
        .scratch_root
        .join(format!("worker-{}", args.sample_index));
    fs::create_dir_all(&worker_scratch).map_err(|error| error.to_string())?;
    let samples = match workload {
        "collection-json-load-mutation" => {
            collection_workload(&args.fixture_root, &worker_scratch, 1)
        }
        "sqlite-link-index-rebuild-search" => {
            index_workload(&args.fixture_root, &worker_scratch, 1)
        }
        "temporary-file-read-write" => io_workload(&args.fixture_root, &worker_scratch, 1),
        "trusted-zip-export-import" => archive_workload(&args.fixture_root, &worker_scratch, 1),
        other => return Err(format!("Unknown benchmark workload: {other}")),
    }?;
    let sample = samples
        .into_iter()
        .next()
        .ok_or_else(|| "worker produced no sample".to_string())?;
    println!(
        "{}",
        serde_json::to_string(&sample).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn main() -> Result<(), String> {
    let args = parse_args()?;
    if args.worker {
        return run_worker(&args);
    }
    if args.output.is_none() {
        return Err("--output is required for controller mode".to_string());
    }
    fs::create_dir_all(&args.scratch_root).map_err(|error| error.to_string())?;
    let manifest: Value = serde_json::from_slice(
        &fs::read(args.fixture_root.join("fixture-manifest.json"))
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let profile = manifest["profile"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let mut workloads = Vec::new();
    let requested_workloads = args.workloads.clone();
    for name in requested_workloads {
        let mut samples = Vec::with_capacity(args.samples);
        for sample_index in 0..args.samples {
            samples.push(run_child_sample(&args, &name, sample_index)?);
        }
        let elapsed: Vec<f64> = samples.iter().map(|sample| sample.elapsed_ms).collect();
        let peak: Vec<f64> = samples
            .iter()
            .map(|sample| sample.peak_rss_bytes as f64)
            .collect();
        workloads.push(WorkloadReport {
            workload: name.to_string(),
            elapsed_summary: summary(&elapsed),
            peak_rss_summary: summary(&peak),
            samples,
        });
    }
    let raw_samples = workloads
        .iter()
        .flat_map(|workload| workload.samples.iter().cloned())
        .collect::<Vec<_>>();
    let elapsed = raw_samples
        .iter()
        .map(|sample| sample.elapsed_ms)
        .collect::<Vec<_>>();
    let output = Report {
        schema_version: 1,
        run_id: args.run_id,
        workload: "backend-matrix",
        profile,
        metric_kind: "elapsed_ms+peak_rss_bytes",
        status: "pass",
        exit_code: 0,
        error: None,
        summary: summary(&elapsed),
        raw_samples,
        provenance: Provenance {
            command: env::args().collect::<Vec<_>>().join(" "),
            collector_source: "src-tauri/src/bin/phase0_bench.rs",
            scratch_root: args.scratch_root.display().to_string(),
            fixture_root: args.fixture_root.display().to_string(),
            memory_method: memory_method(),
            memory_scope: "per-child-operation",
        },
        workloads,
    };
    fs::write(
        args.output
            .as_ref()
            .ok_or_else(|| "--output is required for controller mode".to_string())?,
        serde_json::to_vec_pretty(&output).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}
