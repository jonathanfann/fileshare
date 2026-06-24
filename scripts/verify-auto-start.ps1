# Verify Fileshare auto-start prerequisites (Docker path).
# Run after login/reboot: powershell -ExecutionPolicy Bypass -File scripts/verify-auto-start.ps1

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$ok = $true

function Test-Step {
    param([string]$Label, [bool]$Pass, [string]$Detail = "")
    $mark = if ($Pass) { "OK" } else { "FAIL" }
    Write-Host "[$mark] $Label"
    if ($Detail) { Write-Host "      $Detail" }
    if (-not $Pass) { $script:ok = $false }
}

Push-Location $root
try {
    $dockerOk = $false
    try {
        docker info 2>$null | Out-Null
        $dockerOk = ($LASTEXITCODE -eq 0)
    } catch {}

    Test-Step "Docker daemon running" $dockerOk

    $settingsPath = Join-Path $env:APPDATA "Docker\settings-store.json"
    $autoStart = $false
    if (Test-Path $settingsPath) {
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
        $autoStart = [bool]$settings.AutoStart
    }
    Test-Step "Docker Desktop AutoStart on login" $autoStart $settingsPath

    $psJson = docker compose ps --format json 2>$null
    $running = $false
    $status = "not found"
    if ($psJson) {
        $row = $psJson | ConvertFrom-Json
        if ($row.State -eq "running") {
            $running = $true
            $status = $row.Status
        }
    }
    Test-Step "Fileshare container running" $running $status

    $policy = docker inspect fileshare-fileshare-1 --format "{{.HostConfig.RestartPolicy.Name}}" 2>$null
    Test-Step "Restart policy unless-stopped" ($policy -eq "unless-stopped") $policy

    $httpOk = $false
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 10
        $httpOk = ($r.StatusCode -eq 200)
    } catch {}
    Test-Step "http://localhost:3000 responds" $httpOk

    Write-Host ""
    if ($ok) {
        Write-Host "Auto-start looks healthy."
        exit 0
    }
    Write-Host "Some checks failed. See README 'Auto-start on login' for setup steps."
    exit 1
} finally {
    Pop-Location
}
