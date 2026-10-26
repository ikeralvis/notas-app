# Crea en el escritorio los accesos directos "Notas" (arrancar) y "Parar Notas".
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$desktop = [Environment]::GetFolderPath('Desktop')

# Icono sencillo generado al vuelo.
$icon = Join-Path $root 'scripts\notas.ico'
try {
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap 64, 64
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::FromArgb(28, 27, 25))
    $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232, 179, 74))), 16, 10, 32, 44)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(28, 27, 25)), 3
    $g.DrawLine($pen, 22, 28, 42, 28); $g.DrawLine($pen, 22, 36, 42, 36); $g.DrawLine($pen, 22, 44, 34, 44)
    $ico = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $fs = [IO.File]::Create($icon); $ico.Save($fs); $fs.Close()
} catch { $icon = $null }

function New-Shortcut($name, $script, $args2) {
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut((Join-Path $desktop "$name.lnk"))
    $lnk.TargetPath = 'powershell.exe'
    $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $root $script)`" $args2"
    $lnk.WorkingDirectory = $root
    if ($icon) { $lnk.IconLocation = $icon }
    $lnk.Save()
}
New-Shortcut 'Notas' 'scripts\start.ps1' ''
New-Shortcut 'Parar Notas' 'scripts\stop.ps1' ''
Write-Host "Accesos directos creados en el escritorio." -ForegroundColor Green
