param(
  [Parameter(Mandatory=$true)][string]$RunId,
  [string]$WindowTitleRegex = 'Collectives',
  [ValidateSet('125','150')][string]$RequireDpiPercent
)
$ErrorActionPreference = 'Stop'
$artifactRoot = Join-Path (Get-Location) (Join-Path 'artifacts/phase4' $RunId)
if (-not (Test-Path -LiteralPath $artifactRoot)) { New-Item -ItemType Directory -Force -LiteralPath $artifactRoot | Out-Null }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Phase4WindowProbe {
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
$matches = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match $WindowTitleRegex }
if ($matches.Count -ne 1) { throw "Expected exactly one scoped target window matching '$WindowTitleRegex'; found $($matches.Count)" }
$process = $matches[0]
$rect = New-Object Phase4WindowProbe+RECT
[Phase4WindowProbe]::GetWindowRect($process.MainWindowHandle, [ref]$rect) | Out-Null
$dpi = [Phase4WindowProbe]::GetDpiForWindow($process.MainWindowHandle)
$percent = [math]::Round(($dpi / 96.0) * 100)
if ($RequireDpiPercent -and $percent -ne [int]$RequireDpiPercent) { throw "Target window DPI is $percent%; required $RequireDpiPercent%" }
$result = [ordered]@{ schema_version = 1; phase = 'phase4'; run_id = $RunId; captured_at = (Get-Date).ToUniversalTime().ToString('o'); process_id = $process.Id; process_path = $process.Path; window_title = $process.MainWindowTitle; dpi = $dpi; dpi_percent = $percent; bounds = [ordered]@{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom }; probe = 'scoped Win32 metadata only; no UI automation' }
$out = Join-Path $artifactRoot 'windows-dpi-probe.json'
if (Test-Path -LiteralPath $out) { throw "Refusing to overwrite $out" }
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding utf8
$result | ConvertTo-Json -Depth 6
