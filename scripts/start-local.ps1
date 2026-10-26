# Arranca Notas SIN contenedores: solo Node.js. Cierra esta ventana (o Ctrl+C) para parar la app.
param([int]$Port = 3000)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Pause-Exit($msg) {
    Write-Host ""
    Write-Host $msg -ForegroundColor Red
    Read-Host "Pulsa Enter para cerrar"
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Pause-Exit "Node.js no esta instalado. Descargalo de https://nodejs.org (version 22.18 o superior)." }
if ([version]((node -v).TrimStart('v')) -lt [version]'22.18.0') { Pause-Exit "Hace falta Node 22.18 o superior (tienes $(node -v))." }

# Lee .env (NOTAS_DATA, NOTAS_BACKUPS, BACKUP_EVERY_DAYS) sin pisar variables ya definidas.
if (Test-Path .env) {
    foreach ($line in Get-Content .env) {
        if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') {
            if (-not [Environment]::GetEnvironmentVariable($Matches[1])) { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"')) }
        }
    }
}
$data = if ($env:NOTAS_DATA) { $env:NOTAS_DATA } else { Join-Path $root 'data' }
$backups = if ($env:NOTAS_BACKUPS) { $env:NOTAS_BACKUPS } else { Join-Path $root 'backups' }

# Dependencias del servidor (solo la primera vez).
if (-not (Test-Path server\node_modules)) {
    Write-Host "Instalando dependencias del servidor..." -ForegroundColor Cyan
    npm install --prefix server --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pause-Exit "Fallo npm install (servidor)." }
}

# Compila el frontend si no existe o si cambio algo en web/src.
$index = 'server\public\index.html'
$stale = -not (Test-Path $index)
if (-not $stale) {
    $newest = Get-ChildItem web\src, web\index.html -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $stale = $newest.LastWriteTime -gt (Get-Item $index).LastWriteTime
}
if ($stale) {
    Write-Host "Compilando la interfaz..." -ForegroundColor Cyan
    if (-not (Test-Path web\node_modules)) { npm install --prefix web --no-audit --no-fund }
    npm run build --prefix web
    if ($LASTEXITCODE -ne 0) { Pause-Exit "Fallo la compilacion de la interfaz." }
    if (Test-Path server\public) { Remove-Item -Recurse -Force server\public }
    Copy-Item web\dist server\public -Recurse
}

$env:DATA_DIR = $data
$env:BACKUP_DIR = $backups
$env:PORT = "$Port"
$env:NODE_NO_WARNINGS = '1'
Write-Host "Datos:   $data" -ForegroundColor DarkGray
Write-Host "Copias:  $backups" -ForegroundColor DarkGray

$server = Start-Process node -ArgumentList 'src/index.ts' -WorkingDirectory (Join-Path $root 'server') -NoNewWindow -PassThru

$ok = $false
for ($i = 0; $i -lt 30 -and -not $server.HasExited; $i++) {
    try {
        $req = [System.Net.WebRequest]::Create("http://127.0.0.1:$Port/api/health")
        $req.Proxy = $null
        $req.Timeout = 2000
        $req.GetResponse().Close()
        $ok = $true
        break
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $ok) { Pause-Exit "La app no arranca (puerto $Port ocupado?)." }

Start-Process "http://localhost:$Port"
Write-Host "Notas en http://localhost:$Port  (cierra esta ventana para parar)" -ForegroundColor Green
$server.WaitForExit()
