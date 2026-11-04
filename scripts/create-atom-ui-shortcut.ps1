# Creates a desktop shortcut "ATOM Chat" that runs this repo's scripts/start-atom.sh.
# Paths are relative to this script, not an older folder such as C:\CURSOR\lm-studio-ui.
$repo = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot "start-atom.sh"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = Join-Path $desktop "ATOM Chat.lnk"

$bash = $null
$bashCmd = Get-Command bash -ErrorAction SilentlyContinue
if ($bashCmd) { $bash = $bashCmd.Source }
if (-not $bash -and (Test-Path "C:\Program Files\Git\bin\bash.exe")) {
  $bash = "C:\Program Files\Git\bin\bash.exe"
}
if (-not $bash) {
  Write-Error "bash was not found. Install Git for Windows, then run this script again."
  exit 1
}

if (Test-Path $shortcut) { Remove-Item $shortcut -Force }

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($shortcut)
$s.TargetPath = $bash
$s.Arguments = '"' + $launcher + '"'
$s.WorkingDirectory = $repo
$s.Description = "Start ATOM Chat from $repo (http://localhost:5175/)"
$icon = Join-Path $repo "public\atom.ico"
if (Test-Path $icon) { $s.IconLocation = $icon }
$s.Save()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ws) | Out-Null

Write-Host "Shortcut created: $shortcut"
Write-Host "Target: $bash `"$launcher`""
Write-Host "Working directory: $repo"
Write-Host "Opens http://localhost:5175/ from that checkout."
