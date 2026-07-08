# Migrate a native Fileshare install to Docker volumes (./data/files, ./data/db).
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts/migrate-to-docker.ps1

param(
    [string]$ShareDir = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dataFiles = Join-Path $root "data\files"
$dataDb = Join-Path $root "data\db"
$dbSource = Join-Path $root "fileshare.db"
$dbDest = Join-Path $dataDb "fileshare.db"

function Stop-FileshareNative {
    $conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $conn) { return }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
    if ($proc -and $proc.CommandLine -match "server\.js") {
        Write-Host "Stopping native Fileshare (PID $($conn.OwningProcess))..."
        Stop-Process -Id $conn.OwningProcess -Force
        Start-Sleep -Seconds 2
    }
}

function Get-ShareDirFromDb {
    if (-not (Test-Path $dbSource)) { return $null }
    Push-Location $root
    try {
        $row = node -e "const Database=require('better-sqlite3');const db=new Database('fileshare.db');const r=db.prepare(`"SELECT value FROM app_settings WHERE key='share_dir'`").get();if(r&&r.value)process.stdout.write(r.value);" 2>$null
        if ($row) { return $row.Trim() }
    } finally {
        Pop-Location
    }
    return $null
}

Stop-FileshareNative

if (-not $ShareDir) {
    $ShareDir = Get-ShareDirFromDb
}
if (-not $ShareDir -or -not (Test-Path $ShareDir)) {
    throw "Share folder not found. Pass -ShareDir '<your share folder>' or configure native Fileshare first."
}

Write-Host "Source share folder: $ShareDir"
Write-Host "Destination: $dataFiles"

if ((Test-Path $dataFiles) -and (Get-ChildItem $dataFiles -Force -ErrorAction SilentlyContinue)) {
    if (-not $Force) {
        throw "data\files is not empty. Re-run with -Force to overwrite via robocopy mirror."
    }
}

New-Item -ItemType Directory -Force -Path $dataFiles, $dataDb | Out-Null

if (Test-Path $dbSource) {
    Copy-Item $dbSource $dbDest -Force
    foreach ($suffix in @("-wal", "-shm")) {
        $extra = "$dbSource$suffix"
        if (Test-Path $extra) {
            Copy-Item $extra (Join-Path $dataDb "fileshare.db$suffix") -Force
        }
    }
    Write-Host "Copied database to data\db\fileshare.db"
} else {
    Write-Host "No fileshare.db in project root — Docker will create a fresh database."
}

Write-Host "Copying files (this may take a while)..."
robocopy $ShareDir $dataFiles /E /R:2 /W:3 /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

$displayPath = (Resolve-Path $dataFiles).Path
$envPath = Join-Path $root ".env"
$envContent = "DISPLAY_SHARE_DIR=$displayPath`n"
Set-Content -Path $envPath -Value $envContent -Encoding utf8NoBOM
Write-Host "Wrote DISPLAY_SHARE_DIR to .env"

Write-Host ""
Write-Host "Migration complete. Start Docker with:"
Write-Host "  docker compose up -d --build"
Write-Host ""
Write-Host "Then open http://localhost:3000"
