# Register native Fileshare (start-hidden.vbs) in the Windows Startup folder.
# Run: powershell -ExecutionPolicy Bypass -File scripts/install-windows-startup.ps1
# Remove: powershell -ExecutionPolicy Bypass -File scripts/install-windows-startup.ps1 -Remove

param(
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$vbs = Join-Path $root "start-hidden.vbs"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Fileshare.lnk"

if (-not (Test-Path $vbs)) {
    throw "start-hidden.vbs not found at $vbs"
}

$shell = New-Object -ComObject WScript.Shell

if ($Remove) {
    if (Test-Path $shortcutPath) {
        Remove-Item $shortcutPath -Force
        Write-Host "Removed Startup shortcut: $shortcutPath"
    } else {
        Write-Host "No Startup shortcut found."
    }
    exit 0
}

$link = $shell.CreateShortcut($shortcutPath)
$link.TargetPath = "wscript.exe"
$link.Arguments = "`"$vbs`""
$link.WorkingDirectory = $root
$link.WindowStyle = 7
$link.Description = "Fileshare LAN server"
$link.Save()

Write-Host "Created Startup shortcut: $shortcutPath"
Write-Host "Fileshare will start hidden at Windows login (native Node, not Docker)."
