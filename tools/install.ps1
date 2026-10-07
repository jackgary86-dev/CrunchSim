# CrunchSim local install for Windows: the game runs from this PC in its own app window, nothing loaded from the web.
#
#   install.cmd                (or: powershell -ExecutionPolicy Bypass -File tools\install.ps1)
#   tools\install.ps1 -NoLaunch      install or update without opening the game
#   tools\install.ps1 -Uninstall     remove the app and its shortcuts (your saves are kept)
#   tools\install.ps1 -Uninstall -Purge   also delete the saves
#
# What it does:
#   - copies index.html, plant3d.html, gallery.html, css/ and js/ to %LOCALAPPDATA%\CrunchSim\app
#   - downloads three.js and the two fonts once into the app folder (cached, so updates work offline)
#   - makes Desktop and Start Menu shortcuts that open the game in an Edge (or Chrome) app window with its own profile:
#     no tabs or toolbar, GPU rasterisation on, and the background throttling that slows a game in a browser tab off
# Run it again after pulling a new version to update. Saves live in the app profile, not in the app folder, so they survive.
param([switch]$Uninstall, [switch]$Purge, [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is many times slower with the progress bar on

$Repo = Split-Path -Parent $PSScriptRoot
$Root = Join-Path $env:LOCALAPPDATA 'CrunchSim'
$App = Join-Path $Root 'app'
$Cache = Join-Path $Root 'cache'
$ProfileDir = Join-Path $Root 'profile'   # the browser profile: localStorage (your saves) lives here
$Shell = New-Object -ComObject WScript.Shell
$Links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'CrunchSim.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'CrunchSim.lnk'))

if ($Uninstall) {
  $Links | ForEach-Object { if (Test-Path $_) { Remove-Item $_ -Force } }
  if (Test-Path $App) { Remove-Item $App -Recurse -Force }
  if ($Purge -and (Test-Path $Root)) { Remove-Item $Root -Recurse -Force; Write-Host 'CrunchSim removed, saves included.' }
  else { Write-Host "CrunchSim removed. Your saves are kept in $ProfileDir (run with -Uninstall -Purge to delete them)." }
  return
}

foreach ($f in 'index.html', 'plant3d.html', 'gallery.html', 'css', 'js') {
  if (-not (Test-Path (Join-Path $Repo $f))) { throw "Run this from the CrunchSim folder: $f is missing next to tools\." }
}

# ---- the browser: Edge ships with Windows; Chrome works the same way ----
$Browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $Browser) { throw 'Neither Microsoft Edge nor Google Chrome was found.' }

# ---- copy the game (the app folder is replaced; the profile with the saves is not touched) ----
Write-Host "Installing CrunchSim to $App"
New-Item -ItemType Directory -Force $Root, $Cache | Out-Null
if (Test-Path $App) { Remove-Item $App -Recurse -Force }
New-Item -ItemType Directory -Force $App | Out-Null
foreach ($f in 'index.html', 'plant3d.html', 'gallery.html') { Copy-Item (Join-Path $Repo $f) $App }
foreach ($d in 'css', 'js') { Copy-Item (Join-Path $Repo $d) (Join-Path $App $d) -Recurse }

function Get-Cached([string]$url, [string]$name) {
  # a file from the web, kept in the cache so a reinstall does not need the network
  $path = Join-Path $Cache $name
  if (-not (Test-Path $path)) {
    try { Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }
    catch { if (Test-Path $path) { Remove-Item $path -Force }; return $null }
  }
  return $path
}
function Edit-Html([string]$file, [scriptblock]$change) {
  $p = Join-Path $App $file
  $t = [IO.File]::ReadAllText($p)
  [IO.File]::WriteAllText($p, (& $change $t), (New-Object Text.UTF8Encoding $false))
}

# ---- three.js for the plant floor ----
$ThreeUrl = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
$three = Get-Cached $ThreeUrl 'three-r128.min.js'
if ($three) {
  New-Item -ItemType Directory -Force (Join-Path $App 'vendor') | Out-Null
  Copy-Item $three (Join-Path $App 'vendor\three.min.js')
  Edit-Html 'plant3d.html' { param($t) $t.Replace($ThreeUrl, 'vendor/three.min.js') }
} else { Write-Warning 'Could not download three.js; the 3D plant floor will load it from the web.' }

# ---- the fonts (Share Tech Mono, IBM Plex Sans) ----
$FontsUrl = 'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=IBM+Plex+Sans:wght@400;500;600&display=swap'
$fontsCss = Get-Cached $FontsUrl 'fonts.css'
if ($fontsCss) {
  $css = [IO.File]::ReadAllText($fontsCss)
  $dir = Join-Path $App 'fonts'; New-Item -ItemType Directory -Force $dir | Out-Null
  $ok = $true
  foreach ($m in [regex]::Matches($css, 'url\((https://fonts\.gstatic\.com/[^)]+)\)')) {
    $u = $m.Groups[1].Value
    $name = 'font-' + ([BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($u))).Replace('-', '').Substring(0, 12)) + [IO.Path]::GetExtension(($u -split '\?')[0])
    $f = Get-Cached $u $name
    if (-not $f) { $ok = $false; break }
    Copy-Item $f (Join-Path $dir $name)
    $css = $css.Replace($u, $name)
  }
  if ($ok) {
    [IO.File]::WriteAllText((Join-Path $dir 'fonts.css'), $css, (New-Object Text.UTF8Encoding $false))
    foreach ($h in 'index.html', 'plant3d.html', 'gallery.html') {
      Edit-Html $h { param($t)
        $t = [regex]::Replace($t, '\s*<link rel="preconnect" href="https://fonts\.(googleapis|gstatic)\.com"[^>]*>', '')
        $t.Replace($FontsUrl, 'fonts/fonts.css') }
    }
  } else { Write-Warning 'Could not download the fonts; the game will load them from the web.' }
} else { Write-Warning 'Could not download the fonts; the game will load them from the web.' }

# ---- the icon: the favicon's mark (dark tile, amber jaw) drawn into an .ico ----
$Icon = Join-Path $Root 'crunchsim.ico'
try {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object Drawing.Bitmap 256, 256
  $g = [Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'
  $g.Clear([Drawing.Color]::Transparent)
  $tile = New-Object Drawing.Drawing2D.GraphicsPath
  $r = 40; $tile.AddArc(0, 0, $r * 2, $r * 2, 180, 90); $tile.AddArc(256 - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $tile.AddArc(256 - $r * 2, 256 - $r * 2, $r * 2, $r * 2, 0, 90); $tile.AddArc(0, 256 - $r * 2, $r * 2, $r * 2, 90, 90); $tile.CloseFigure()
  $g.FillPath((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(7, 10, 15))), $tile)
  $amber = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 178, 92))
  $g.FillRectangle($amber, 56, 72, 144, 30); $g.FillRectangle($amber, 76, 146, 104, 30)
  $g.FillRectangle((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(92, 220, 255))), 112, 196, 32, 22)
  $g.Dispose()
  $png = New-Object IO.MemoryStream; $bmp.Save($png, [Drawing.Imaging.ImageFormat]::Png); $bytes = $png.ToArray()
  $fs = [IO.File]::Create($Icon); $w = New-Object IO.BinaryWriter $fs
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)                       # ICONDIR: one image
  $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0)           # 256x256 (0 means 256), no palette
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$bytes.Length); $w.Write([UInt32]22)
  $w.Write($bytes); $w.Close()
} catch { $Icon = $Browser }

# ---- shortcuts: an app window with its own profile, so the speed flags apply and the saves stay together ----
$Url = 'file:///' + ((Join-Path $App 'index.html') -replace '\\', '/')
$Flags = @(
  "--app=`"$Url`"", "--user-data-dir=`"$ProfileDir`"", '--no-first-run', '--no-default-browser-check',
  '--window-size=1600,960',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy',
  '--autoplay-policy=no-user-gesture-required'
) -join ' '
foreach ($l in $Links) {
  New-Item -ItemType Directory -Force (Split-Path $l) | Out-Null
  $s = $Shell.CreateShortcut($l)
  $s.TargetPath = $Browser; $s.Arguments = $Flags; $s.WorkingDirectory = $App
  $s.IconLocation = "$Icon,0"; $s.Description = 'CrunchSim, installed on this PC'
  $s.Save()
}

Write-Host ''
Write-Host 'CrunchSim is installed. Open it from the Desktop or Start Menu shortcut.'
Write-Host 'Saves from the website do not carry over by themselves: there use Settings > EXPORT SAVE, here IMPORT.'
Write-Host 'To update: pull the new version and run install.cmd again (your saves are kept).'
if (-not $NoLaunch) { Start-Process -FilePath $Browser -ArgumentList $Flags }
