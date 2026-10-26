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

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Pause-Exit "Node.js no esta instalado. Descargalo de https://nodejs.org (version 22.13 o superior)." }
if ([version]((node -v).TrimStart('v')) -lt [version]'22.13.0') { Pause-Exit "Hace falta Node 22.13 o superior (tienes $(node -v))." }

# Lee .env (NOTAS_DATA, NOTAS_BACKUPS, BACKUP_EVERY_DAYS) sin pisar variables ya definidas.
if (Test-Path .env) {
    foreach ($line in Get-Content .env) {
        if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') {
            if (-not [Environment]::GetEnvironmentVariable($Matches[1])) { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"')) }
        }
    }
}
if (-not $PSBoundParameters.ContainsKey('Port') -and $env:NOTAS_PORT) { $Port = [int]$env:NOTAS_PORT }
$data = if ($env:NOTAS_DATA) { $env:NOTAS_DATA } else { Join-Path $root 'data' }
$backups = if ($env:NOTAS_BACKUPS) { $env:NOTAS_BACKUPS } else { Join-Path $root 'backups' }

# Instala dependencias si faltan o si package.json cambio (p. ej. tras un git pull).
# Se entra en la carpeta en vez de usar --prefix: algunas versiones de npm lo ignoran.
function Ensure-Deps($dir, $npmArgs) {
    $marker = Join-Path $dir 'node_modules.package-lock.json'
    $need = -not (Test-Path $marker)
    if (-not $need) { $need = (Get-Item (Join-Path $dir 'package.json')).LastWriteTime -gt (Get-Item $marker).LastWriteTime }
    if (-not $need) { return }
    Write-Host "Instalando dependencias de $dir..." -ForegroundColor Cyan
    Push-Location $dir
    npm install @npmArgs --no-audit --no-fund
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Pause-Exit "Fallo npm install en $dir." }
}
Ensure-Deps 'server' @('--omit=dev')

# Compila el frontend si no existe o si cambio algo en web (codigo o dependencias).
$index = 'serverpublicindex.html'
$stale = -not (Test-Path $index)
if (-not $stale) {
    $newest = Get-ChildItem websrc, webindex.html, webpackage.json -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $stale = $newest.LastWriteTime -gt (Get-Item $index).LastWriteTime
}
if ($stale) {
    Ensure-Deps 'web' @()
    Write-Host "Compilando la interfaz..." -ForegroundColor Cyan
    Push-Location web
    npm run build
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Pause-Exit "Fallo la compilacion de la interfaz." }
    if (Test-Path serverpublic) { Remove-Item -Recurse -Force serverpublic }
    Copy-Item webdist serverpublic -Recurse
}

$env:DATA_DIR = $data
$env:BACKUP_DIR = $backups
$env:PORT = "$Port"
$env:NODE_NO_WARNINGS = '1'
Write-Host "Datos:   $data" -ForegroundColor DarkGray
Write-Host "Copias:  $backups" -ForegroundColor DarkGray

$server = Start-Process node -ArgumentList '--experimental-strip-types','src/index.ts' -WorkingDirectory (Join-Path $root 'server') -NoNewWindow -PassThru

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
