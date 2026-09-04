param(
  [string]$TargetRoot = "target/x86_64-pc-windows-msvc/release",
  [string]$OutDir = "dist/tauri/windows"
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$nsisRoot = Join-Path $TargetRoot 'bundle/nsis'
$setupCandidates = Get-ChildItem -Path $nsisRoot -Recurse -File -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object FullName
if ($setupCandidates.Count -ne 1) { throw "Expected exactly one NSIS installer; found $($setupCandidates.Count)." }
$setup = $setupCandidates[0]

$msiRoot = Join-Path $TargetRoot 'bundle/msi'
$msiCandidates = Get-ChildItem -Path $msiRoot -Recurse -File -Filter '*.msi' -ErrorAction SilentlyContinue | Sort-Object FullName
if ($msiCandidates.Count -ne 1) { throw "Expected exactly one MSI installer; found $($msiCandidates.Count)." }
$msi = $msiCandidates[0]

$binary = Join-Path $TargetRoot 'harnesscope-tauri.exe'
if (-not (Test-Path -LiteralPath $binary)) { throw "Missing portable executable: $binary" }

$setupOut = Join-Path $OutDir 'HarnessScope-0.3.0-windows-x64-Setup.exe'
$msiOut = Join-Path $OutDir 'HarnessScope-0.3.0-windows-x64.msi'
$zipOut = Join-Path $OutDir 'HarnessScope-0.3.0-windows-x64-portable.zip'
Copy-Item -LiteralPath $setup.FullName -Destination $setupOut -Force
Copy-Item -LiteralPath $msi.FullName -Destination $msiOut -Force
if (Test-Path -LiteralPath $zipOut) { Remove-Item -LiteralPath $zipOut -Force }
Compress-Archive -LiteralPath $binary -DestinationPath $zipOut -CompressionLevel Optimal

foreach ($path in @($setupOut, $msiOut, $zipOut)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing normalized artifact: $path" }
  if ((Get-Item -LiteralPath $path).Length -le 0) { throw "Empty normalized artifact: $path" }
}
Write-Host "Normalized Tauri Windows artifacts in $OutDir"
