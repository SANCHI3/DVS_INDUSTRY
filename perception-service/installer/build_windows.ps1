# Builds dvs-cctv-setup.exe (run from the repository root, on Windows).
# Everything is inside the one file, so the plant PC needs no pip and no extra
# downloads: portable Python with tkinter, CPU PyTorch, FFmpeg, MediaMTX, the service.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$MediaMtxVersion = "v1.21.3"
$stage = Join-Path (Get-Location) "stage"
$work = Join-Path (Get-Location) "build-tmp"
Remove-Item -Recurse -Force $stage, $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage, $work | Out-Null
$headers = @{}
if ($env:GITHUB_TOKEN) { $headers["Authorization"] = "Bearer $env:GITHUB_TOKEN" }

Write-Host "== Python"
$release = Invoke-RestMethod -Headers $headers "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
$asset = $release.assets | Where-Object { $_.name -match '^cpython-3\.12\.\d+\+\d+-x86_64-pc-windows-msvc-install_only\.tar\.gz$' } | Select-Object -First 1
Invoke-WebRequest $asset.browser_download_url -OutFile "$work\python.tar.gz"
tar -xzf "$work\python.tar.gz" -C $stage
$py = "$stage\python\python.exe"

Write-Host "== Python packages"
& $py -m pip install --no-warn-script-location --quiet torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE) { throw "pip torch failed" }
& $py -m pip install --no-warn-script-location --quiet -r perception-service\requirements.txt -c perception-service\installer\constraints.txt pillow
if ($LASTEXITCODE) { throw "pip requirements failed" }
Remove-Item -Recurse -Force "$stage\python\Lib\site-packages\torch\include", "$stage\python\Lib\site-packages\torch\test" -ErrorAction SilentlyContinue
Get-ChildItem "$stage\python\Lib\site-packages\torch\lib\*.lib" | Remove-Item -Force
Get-ChildItem "$stage\python" -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force

Write-Host "== FFmpeg"
Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile "$work\ffmpeg.zip"
Expand-Archive "$work\ffmpeg.zip" "$work\ffmpeg"
New-Item -ItemType Directory -Force "$stage\ffmpeg\bin" | Out-Null
Get-ChildItem "$work\ffmpeg" -Recurse -Include ffmpeg.exe, ffprobe.exe | Copy-Item -Destination "$stage\ffmpeg\bin"

Write-Host "== MediaMTX"
Invoke-WebRequest "https://github.com/bluenviron/mediamtx/releases/download/$MediaMtxVersion/mediamtx_${MediaMtxVersion}_windows_amd64.zip" -OutFile "$work\mediamtx.zip"
Expand-Archive "$work\mediamtx.zip" "$stage\mediamtx"
Remove-Item "$stage\mediamtx\mediamtx.yml"

Write-Host "== Service"
robocopy perception-service "$stage\app" /E /NFL /NDL /NJH /NJS /NP `
  /XD data output logs recordings calibration docs demo_videos evaluation __pycache__ .pytest_cache rgb_fight_model\__pycache__ `
  /XF *.log *.before-* test_*.py .env *.png *.csv fight_r3d18_v1.pt cameras.yaml | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed" }
$global:LASTEXITCODE = 0

Write-Host "== Check the bundle"
Push-Location "$stage\app"
& $py -c "import cv2, torch, ultralytics, psutil, tkinter, PIL, main, multi_camera, service, live_view; print('imports ok', torch.__version__)"
if ($LASTEXITCODE) { throw "bundle imports failed" }
Pop-Location

Write-Host "== Installer"
& makensis /V2 perception-service\installer\dvs-cctv-setup.nsi
if ($LASTEXITCODE) { throw "makensis failed" }
Get-Item dvs-cctv-setup.exe | Select-Object Name, @{ n = "MB"; e = { [math]::Round($_.Length / 1MB) } }
