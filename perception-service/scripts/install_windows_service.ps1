<#
Starts the DVS CCTV monitoring when the factory PC boots (no one needs to log
in) and restarts it if it stops. Run once in PowerShell **as Administrator**
from the perception-service folder:

    powershell -ExecutionPolicy Bypass -File scripts\install_windows_service.ps1
    powershell -ExecutionPolicy Bypass -File scripts\install_windows_service.ps1 -Remove

It creates the scheduled task "DVS CCTV Monitoring" that runs
`python service.py run` as SYSTEM at start-up. service.py restarts the
cameras after a crash and writes logs\perception.log (one file per day,
14 days kept). Task Scheduler also restarts service.py itself if it exits.
#>
param(
    [string]$Python = "",
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$TaskName = "DVS CCTV Monitoring"
$Folder = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run PowerShell as Administrator (right-click > Run as administrator)."
}

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed '$TaskName'. The monitoring no longer starts at boot."
    return
}

if (-not $Python) {
    $Python = (Get-Command python -ErrorAction Stop).Source
}
if (-not (Test-Path (Join-Path $Folder ".env"))) {
    throw "perception-service\.env is missing. Copy .env.example to .env and fill it in first."
}

$action = New-ScheduledTaskAction -Execute $Python -Argument "service.py run" -WorkingDirectory $Folder
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$runAs = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $runAs -Description "DVS Industries: factory CCTV monitoring (perception-service)" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed '$TaskName' and started it."
Write-Host "  Logs:    $Folder\logs\perception.log"
Write-Host "  Check:   python service.py doctor"
Write-Host "  Stop:    Stop-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Remove:  powershell -ExecutionPolicy Bypass -File scripts\install_windows_service.ps1 -Remove"
