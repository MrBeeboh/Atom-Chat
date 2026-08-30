# Creates a desktop shortcut "ATOM UI" that runs start_atom_ui.bat from this repo folder.
$root = Split-Path -Parent $PSScriptRoot
$batPath = Join-Path $root "start_atom_ui.bat"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = Join-Path $desktop "ATOM UI.lnk"

$iconOnDesktop = Join-Path $desktop "ATOM UI.ico"
$iconInRepo = Join-Path $root "ATOM UI.ico"
$iconPath = if (Test-Path $iconOnDesktop) { $iconOnDesktop } elseif (Test-Path $iconInRepo) { $iconInRepo } else { $null }

if (Test-Path $shortcut) { Remove-Item $shortcut -Force }

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($shortcut)
$s.TargetPath = $batPath
$s.WorkingDirectory = $root
if ($iconPath) { $s.IconLocation = $iconPath }
$s.Description = "Start ATOM Chat (voice + search + UI)"
$s.Save()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ws) | Out-Null

Write-Host "Shortcut created: $shortcut"
Write-Host "Target: $batPath"
Write-Host "Double-click 'ATOM UI' on your desktop to launch."
