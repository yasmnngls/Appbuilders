# Downloads the official whisper.cpp Windows x64 release and English models into tools/whisper/.
# Nothing here is committed (tools/ is git-ignored). Downloads are treated as untrusted:
# each archive is extracted into its own new, empty directory and nothing inside it is executed here.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/whisper-setup.ps1 [-Tag b5454] [-Cuda] [-Models tiny.en,base.en]
param(
  [string]$Tag = "b5454",
  [switch]$Cuda,
  [string[]]$Models = @("tiny.en", "base.en")
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Join-Path (Split-Path -Parent $PSScriptRoot) "tools\whisper"
$downloads = Join-Path $root "downloads"
$modelsDir = Join-Path $root "models"
New-Item -ItemType Directory -Force $downloads, $modelsDir | Out-Null

function Get-File([string]$url, [string]$dest) {
  if (Test-Path $dest) { Write-Host "exists  $dest"; return }
  Write-Host "fetch   $url"
  Invoke-WebRequest -Uri $url -OutFile "$dest.part" -UseBasicParsing
  Move-Item "$dest.part" $dest
}

function Install-Build([string]$asset, [string]$flavor) {
  $zip = Join-Path $downloads "$Tag-$asset"
  Get-File "https://github.com/ggml-org/whisper.cpp/releases/download/$Tag/$asset" $zip
  $dest = Join-Path $root "bin-$flavor\$Tag"
  if (Test-Path (Join-Path $dest "*")) { Write-Host "exists  $dest"; return }
  New-Item -ItemType Directory -Force $dest | Out-Null
  Expand-Archive -Path $zip -DestinationPath $dest
  $exe = Get-ChildItem -Path $dest -Recurse -Filter "whisper-server.exe" | Select-Object -First 1
  if (-not $exe) { throw "whisper-server.exe not found in $asset" }
  Write-Host "ok      $($exe.FullName)"
  Write-Host "sha256  $((Get-FileHash $zip -Algorithm SHA256).Hash)  $asset"
}

Install-Build "whisper-bin-x64.zip" "cpu"
if ($Cuda) { Install-Build "whisper-bin-win-cuda-12.4.0-x64.zip" "cuda" }

foreach ($m in $Models) {
  $file = Join-Path $modelsDir "ggml-$m.bin"
  Get-File "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$m.bin" $file
  $size = [math]::Round((Get-Item $file).Length / 1MB, 1)
  Write-Host "model   ggml-$m.bin  $size MB  sha256 $((Get-FileHash $file -Algorithm SHA256).Hash)"
}
Write-Host "Done. Start the server with: npm run whisper"
