param(
  [string]$TargetRoot = "target/x86_64-pc-windows-msvc/release",
  [string]$OutDir = "dist/tauri"
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$nsisRoot = Join-Path $TargetRoot 'bundle/nsis'
$setupCandidates = @(Get-ChildItem -Path $nsisRoot -Recurse -File -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object FullName)
if ($setupCandidates.Count -ne 1) { throw "Expected exactly one NSIS installer; found $($setupCandidates.Count)." }

$msiRoot = Join-Path $TargetRoot 'bundle/msi'
$msiCandidates = @(Get-ChildItem -Path $msiRoot -Recurse -File -Filter '*.msi' -ErrorAction SilentlyContinue | Sort-Object FullName)
if ($msiCandidates.Count -ne 1) { throw "Expected exactly one MSI installer; found $($msiCandidates.Count)." }

$binary = Join-Path $TargetRoot 'harnesscope-tauri.exe'
if (-not (Test-Path -LiteralPath $binary)) { throw "Missing portable executable: $binary" }
if ((Get-Item -LiteralPath $binary).Length -le 0) { throw "Empty portable executable: $binary" }

$setupOut = Join-Path $OutDir 'HarnessScope-0.3.0-windows-x64-Setup.exe'
$msiOut = Join-Path $OutDir 'HarnessScope-0.3.0-windows-x64.msi'
$zipOut = Join-Path $OutDir 'HarnessScope-0.3.0-windows-x64-portable.zip'
Copy-Item -LiteralPath $setupCandidates[0].FullName -Destination $setupOut -Force
Copy-Item -LiteralPath $msiCandidates[0].FullName -Destination $msiOut -Force

$stage = Join-Path $env:RUNNER_TEMP 'harnesscope-v03-portable'
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $stage 'HarnessScope.exe') -Force
@'
HarnessScope 0.3.0 — unsigned Windows build

This archive comes from the same exact-head CI build as the published installer artifacts.
Windows SmartScreen may display "Unknown publisher" because V0.3 is intentionally unsigned.
Before running it, verify the release source and SHA256 checksum. If you trust this exact artifact,
Windows may offer More info -> Run anyway. HarnessScope never requires disabling SmartScreen,
Microsoft Defender, or other Windows security controls.
'@ | Set-Content -LiteralPath (Join-Path $stage 'README-UNSIGNED.txt') -Encoding UTF8

if (Test-Path -LiteralPath $zipOut) { Remove-Item -LiteralPath $zipOut -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipOut -CompressionLevel Optimal

foreach ($path in @($setupOut, $msiOut, $zipOut)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing normalized artifact: $path" }
  if ((Get-Item -LiteralPath $path).Length -le 0) { throw "Empty normalized artifact: $path" }
}

Write-Host "Normalized Tauri Windows artifacts in $OutDir"
