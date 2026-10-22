<#
.SYNOPSIS
  One-command demo: checks prerequisites, starts the backend and frontend (or
  reuses ones already running), then runs the CCTV perception service in demo
  mode on the clips in perception-service/demo_videos/.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\start-demo.ps1
  .\start-demo.ps1 -Camera            # live webcam instead of demo clips
  .\start-demo.ps1 -NoDisplay         # no OpenCV preview window
  .\start-demo.ps1 -MaxSeconds 120    # stop the perception service after 2 minutes (rehearsal)
#>
param(
    [switch]$Camera,
    [switch]$NoDisplay,
    [switch]$NoBrowser,
    [int]$MaxSeconds = 0
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Perception = Join-Path $Root "perception-service"
$FrontendUrl = "http://localhost:5173"

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }
function Fail($text, $fix) {
    Write-Host "`n    FAILED: $text" -ForegroundColor Red
    if ($fix) { Write-Host "    Fix:    $fix" -ForegroundColor Red }
    exit 1
}

function Read-EnvValue($file, $name) {
    $line = Get-Content $file | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line -replace "^\s*$name\s*=\s*", "").Trim().Trim('"').Trim("'")
}

function Test-Port($hostName, $port) {
    # "localhost" can be IPv4 or IPv6 (Vite listens on ::1 only on some
    # machines), and a default TcpClient is IPv4-only, so try both.
    $targets = if ($hostName -eq "localhost") { @("127.0.0.1", "::1") } else { @($hostName) }
    foreach ($target in $targets) {
        $ip = $null
        $client = if ([System.Net.IPAddress]::TryParse($target, [ref]$ip)) {
            New-Object System.Net.Sockets.TcpClient($ip.AddressFamily)
        } else { New-Object System.Net.Sockets.TcpClient }
        try {
            $task = $client.ConnectAsync($target, [int]$port)
            if ($task.Wait(1500) -and $client.Connected) { return $true }
        } catch { } finally { $client.Close() }
    }
    return $false
}

function Get-Health($url) {
    try { return Invoke-RestMethod -Uri $url -TimeoutSec 3 } catch { return $null }
}

function Wait-Until($seconds, [scriptblock]$check) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $check) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

# ── 1. Tools ──────────────────────────────────────────────────────────────
Step "Checking tools"
foreach ($tool in @("node", "npm", "python")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Fail "'$tool' is not on PATH" "Install Node.js 20+ and Python 3.10-3.12, then open a new terminal"
    }
}
Ok "node $(node --version), python $((python --version) -replace 'Python ', '')"

# ── 2. Configuration files ────────────────────────────────────────────────
Step "Checking .env files"
$backendEnv = Join-Path $Backend ".env"
$perceptionEnv = Join-Path $Perception ".env"
if (-not (Test-Path $backendEnv) -or -not (Test-Path $perceptionEnv)) {
    Fail "backend/.env or perception-service/.env is missing" `
        "node scripts/setup.mjs --db-url `"postgresql://postgres:<password>@localhost:5432/dvs_factory`" --install"
}
Ok "backend/.env and perception-service/.env found"
if (-not (Read-EnvValue $perceptionEnv "DASHBOARD_SERVICE_EMAIL") -and -not (Read-EnvValue $perceptionEnv "DASHBOARD_API_TOKEN")) {
    Warn "perception-service/.env has no dashboard login: incidents will be saved locally but NOT shown on the dashboard"
}
if (-not (Read-EnvValue $perceptionEnv "LLM_API_KEY")) {
    Warn "No LLM_API_KEY: alerts use the built-in plain-language description (this is fine)"
}

# ── 3. PostgreSQL ─────────────────────────────────────────────────────────
Step "Checking PostgreSQL"
$dbUrl = Read-EnvValue $backendEnv "DATABASE_URL"
if (-not $dbUrl) { Fail "DATABASE_URL is not set in backend/.env" "Re-run scripts/setup.mjs or copy backend/.env.example" }
$dbHost = "localhost"; $dbPort = 5432
if ($dbUrl -match "@([^:/?]+)(:(\d+))?/") {
    $dbHost = $Matches[1]
    if ($Matches[3]) { $dbPort = [int]$Matches[3] }
}
if (-not (Test-Port $dbHost $dbPort)) {
    Fail "PostgreSQL is not reachable at ${dbHost}:${dbPort}" `
        "Start the PostgreSQL service (services.msc -> postgresql-x64-NN -> Start), or fix DATABASE_URL in backend/.env"
}
Ok "PostgreSQL is listening on ${dbHost}:${dbPort}"

# ── 4. Dependencies ───────────────────────────────────────────────────────
Step "Checking dependencies"
if (-not (Test-Path (Join-Path $Backend "node_modules"))) { Fail "backend dependencies are not installed" "cd backend; npm install; npx prisma generate; npx prisma migrate deploy; npm run db:seed" }
if (-not (Test-Path (Join-Path $Frontend "node_modules"))) { Fail "frontend dependencies are not installed" "cd frontend; npm install" }
Push-Location $Perception
try {
    python -c "import sklearn, torch, ultralytics, supervision, cv2, yaml" 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "Python packages for the perception service are missing" "cd perception-service; pip install -r requirements.txt" }
    $gpu = python -c "import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')" 2>$null
} finally { Pop-Location }
Ok "node_modules present, Python packages importable"
if ($gpu) { Ok "GPU: $gpu" } else { Warn "No CUDA GPU found: models run on the CPU (slower, but everything works)" }

$fightModel = Join-Path $Perception "models\fight_r3d18_v2.pt"
if (-not (Test-Path $fightModel) -or (Get-Item $fightModel).Length -lt 1024) {
    Warn "Fight model is missing or a Git LFS pointer: fight detection will be disabled, other detectors still run. Fix: git lfs install; git lfs pull"
}

# ── 5. Demo clips ─────────────────────────────────────────────────────────
if (-not $Camera) {
    Step "Checking demo clips"
    $demoDir = Join-Path $Perception "demo_videos"
    $clips = @(Get-ChildItem $demoDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(mp4|avi|mov|mkv|webm|m4v)$' })
    if ($clips.Count -eq 0) {
        Push-Location $Perception
        try { python scripts/prepare_demo_videos.py } finally { Pop-Location }
        $clips = @(Get-ChildItem $demoDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(mp4|avi|mov|mkv|webm|m4v)$' })
    }
    if ($clips.Count -eq 0) {
        Fail "no demo videos in perception-service/demo_videos/" "Add 4 short clips (normal, fight, fire, fall) as described in perception-service/demo_videos/README.md"
    }
    Ok "$($clips.Count) clip(s): $(($clips | ForEach-Object Name) -join ', ')"
}

# ── 6. Backend ────────────────────────────────────────────────────────────
Step "Backend"
$port = Read-EnvValue $backendEnv "PORT"
if (-not $port) { $port = "3000" }
$healthUrl = "http://localhost:$port/api/v1/health"
$health = Get-Health $healthUrl
if ($health -and $health.status -eq "ok") {
    Ok "already running on port $port (reusing it)"
} else {
    if (Test-Port "localhost" $port) { Fail "port $port is in use by another program" "Close it, or change PORT in backend/.env" }
    Start-Process powershell -WorkingDirectory $Backend -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='DVS backend'; npm run dev"
    Write-Host "    starting in a new window ..."
    if (-not (Wait-Until 90 { $h = Get-Health $healthUrl; $h -and $h.status -eq "ok" })) {
        $h = Get-Health $healthUrl
        if ($h -and $h.database -ne "ok") { Fail "backend started but cannot use the database" "Check DATABASE_URL and run: cd backend; npx prisma migrate deploy" }
        Fail "backend did not become healthy within 90 s" "Look at the 'DVS backend' window for the error"
    }
    Ok "backend healthy at $healthUrl"
}

# ── 7. Frontend ───────────────────────────────────────────────────────────
Step "Frontend"
if (Test-Port "localhost" 5173) {
    Ok "already running at $FrontendUrl (reusing it)"
} else {
    Start-Process powershell -WorkingDirectory $Frontend -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='DVS frontend'; npm run dev"
    Write-Host "    starting in a new window ..."
    if (-not (Wait-Until 60 { Test-Port "localhost" 5173 })) { Fail "frontend did not start within 60 s" "Look at the 'DVS frontend' window for the error" }
    Ok "frontend running at $FrontendUrl"
}
if (-not $NoBrowser) { Start-Process $FrontendUrl }

# ── 8. Perception service ─────────────────────────────────────────────────
Step "Perception service"
$pyArgs = @("main.py", "--camera", "CAM-01")
if (-not $Camera) { $pyArgs += "--demo" }
if ($NoDisplay) { $pyArgs += "--no-display" }
if ($MaxSeconds -gt 0) { $pyArgs += @("--max-seconds", "$MaxSeconds") }
Write-Host "    Log in as admin, open Security. Alerts appear as the clips play." -ForegroundColor White
Write-Host "    Press q in the video window (or Ctrl+C here) to stop. Backend/frontend windows stay open." -ForegroundColor White
# A native crash (seen intermittently with CPU-only PyTorch on Windows) restarts
# the service, so a live demo recovers by itself. q / Ctrl+C exit normally.
Push-Location $Perception
try {
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        python @pyArgs
        $code = $LASTEXITCODE
        # restart only on native crashes: access violation / heap corruption
        if ($code -ne -1073741819 -and $code -ne -1073740940) { break }
        Warn "perception service exited with code $code -- restarting ($attempt/5)"
        Start-Sleep -Seconds 2
    }
} finally { Pop-Location }
