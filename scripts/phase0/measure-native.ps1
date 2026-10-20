[CmdletBinding()]
param(
    [ValidateSet('self-check', 'monitor')]
    [string]$Action = 'self-check',
    [int]$RootPid,
    [string]$OutputFile,
    [string]$StopFile,
    [ValidateRange(25, 2000)]
    [int]$IntervalMs = 100
)

$ErrorActionPreference = 'Stop'

function Get-ProcessTreeSnapshot {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $all = @(Get-CimInstance -ClassName Win32_Process)
    $childrenByParent = @{}
    foreach ($process in $all) {
        $parentId = [int]$process.ParentProcessId
        if (-not $childrenByParent.ContainsKey($parentId)) {
            $childrenByParent[$parentId] = [System.Collections.Generic.List[int]]::new()
        }
        $childrenByParent[$parentId].Add([int]$process.ProcessId)
    }

    $ids = [System.Collections.Generic.List[int]]::new()
    $seen = [System.Collections.Generic.HashSet[int]]::new()
    $ids.Add($ProcessId)
    [void]$seen.Add($ProcessId)
    for ($index = 0; $index -lt $ids.Count; $index += 1) {
        $parentId = $ids[$index]
        if ($childrenByParent.ContainsKey($parentId)) {
            foreach ($childId in $childrenByParent[$parentId]) {
                if ($seen.Add($childId)) { $ids.Add($childId) }
            }
        }
    }

    $processStats = @()
    foreach ($id in $ids) {
        try {
            $process = Get-Process -Id $id -ErrorAction Stop
            $cpuSeconds = if ($null -eq $process.CPU) { 0.0 } else { [double]$process.CPU }
            $processStats += [pscustomobject]@{
                pid = $id
                name = $process.ProcessName
                cpu_seconds = $cpuSeconds
                rss_bytes = [int64]$process.WorkingSet64
                peak_rss_bytes = [int64]$process.PeakWorkingSet64
                private_bytes = [int64]$process.PrivateMemorySize64
            }
        } catch {
            # A short-lived child may exit between the CIM and Get-Process snapshots.
        }
    }

    if ($processStats.Count -eq 0) { throw "No live processes found under root PID $ProcessId" }
    $now = [DateTimeOffset]::UtcNow
    return [pscustomobject]@{
        timestamp_utc = $now.ToString('o')
        timestamp_epoch_ms = $now.ToUnixTimeMilliseconds()
        root_pid = $ProcessId
        process_count = $processStats.Count
        process_ids = @($processStats | ForEach-Object { $_.pid })
        processes = $processStats
        cpu_seconds = [double](($processStats | Measure-Object -Property cpu_seconds -Sum).Sum)
        rss_bytes = [int64](($processStats | Measure-Object -Property rss_bytes -Sum).Sum)
        peak_rss_bytes = [int64](($processStats | Measure-Object -Property peak_rss_bytes -Sum).Sum)
        private_bytes = [int64](($processStats | Measure-Object -Property private_bytes -Sum).Sum)
    }
}

if ($env:OS -ne 'Windows_NT') { throw 'Native measurement is Windows-only.' }

if ($Action -eq 'self-check') {
    $snapshot = Get-ProcessTreeSnapshot -ProcessId $PID
    if ($snapshot.process_count -lt 1 -or $snapshot.rss_bytes -le 0 -or $snapshot.cpu_seconds -lt 0) {
        throw 'Windows process-tree self-check returned invalid metrics.'
    }
    $snapshot | ConvertTo-Json -Depth 8 -Compress
    exit 0
}

if ($RootPid -le 0) { throw '-RootPid must be a positive process ID.' }
if (-not $OutputFile -or -not $StopFile) { throw '-OutputFile and -StopFile are required in monitor mode.' }

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$approvedRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot 'artifacts\phase0'))
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputFile)
$resolvedStop = [System.IO.Path]::GetFullPath($StopFile)
foreach ($candidate in @($resolvedOutput, $resolvedStop)) {
    if (-not $candidate.StartsWith($approvedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Monitor files must stay inside artifacts/phase0: $candidate"
    }
}
if (Test-Path -LiteralPath $resolvedOutput) { throw "Refusing to overwrite process monitor output: $resolvedOutput" }
if (Test-Path -LiteralPath $resolvedStop) { throw "Refusing to reuse process monitor stop file: $resolvedStop" }
$outputDirectory = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) { throw "Monitor output directory does not exist: $outputDirectory" }

$encoding = [System.Text.UTF8Encoding]::new($false)
$writer = [System.IO.StreamWriter]::new($resolvedOutput, $false, $encoding)
try {
    while (-not (Test-Path -LiteralPath $resolvedStop)) {
        try {
            $snapshot = Get-ProcessTreeSnapshot -ProcessId $RootPid
            $writer.WriteLine(($snapshot | ConvertTo-Json -Depth 8 -Compress))
            $writer.Flush()
        } catch {
            if (-not (Test-Path -LiteralPath $resolvedStop)) {
                $writer.WriteLine((@{ timestamp_utc = [DateTimeOffset]::UtcNow.ToString('o'); root_pid = $RootPid; error = $_.Exception.Message } | ConvertTo-Json -Compress))
                $writer.Flush()
            }
        }
        Start-Sleep -Milliseconds $IntervalMs
    }
} finally {
    $writer.Dispose()
}
