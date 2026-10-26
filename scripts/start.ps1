# Arranca Notas: motor de contenedores (Podman o Docker), contenedor y navegador.
# 'Continue': docker/podman escriben avisos y progreso por stderr; el exito se comprueba con $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
$port = 3000
if (Test-Path .env) {
    $m = Select-String -Path .env -Pattern '^\s*NOTAS_PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
}
$url = "http://localhost:$port"

function Pause-Exit($msg) {
    Write-Host ""
    Write-Host $msg -ForegroundColor Red
    Read-Host "Pulsa Enter para cerrar"
    exit 1
}

# Prefiere Podman; si no esta instalado usa Docker.
if (Get-Command podman -ErrorAction SilentlyContinue) {
    $engine = 'podman'
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    $engine = 'docker'
} else {
    Pause-Exit "No se encuentra ni podman ni docker en el PATH."
}
Write-Host "Motor: $engine" -ForegroundColor Cyan

# Carpetas de datos (fuera del motor de contenedores). Se crean antes para que el montaje no falle.
New-Item -ItemType Directory -Force -Path data, backups | Out-Null

# Si el motor no responde, arranca la maquina de Podman (o avisa en Docker).
& $engine info *> $null
if ($LASTEXITCODE -ne 0) {
    if ($engine -eq 'podman') {
        Write-Host "Arrancando podman machine..." -ForegroundColor Cyan
        podman machine start
        & $engine info *> $null
        if ($LASTEXITCODE -ne 0) { Pause-Exit "Podman no responde tras 'podman machine start'." }
    } else {
        Pause-Exit "Docker no esta en marcha. Abre Docker Desktop y vuelve a probar."
    }
}

Write-Host "Levantando la app..." -ForegroundColor Cyan
& $engine compose up -d --build
if ($LASTEXITCODE -ne 0) { Pause-Exit "Fallo al levantar los contenedores." }

Write-Host "Esperando a que responda..." -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        # WebRequest con Proxy nulo: Invoke-WebRequest usa el proxy del sistema y puede colgarse con localhost.
        $req = [System.Net.WebRequest]::Create("http://127.0.0.1:$port/api/health")
        $req.Proxy = $null
        $req.Timeout = 2000
        $resp = $req.GetResponse()
        $resp.Close()
        $ok = $true
        break
    } catch { $lastErr = $_.Exception.Message; Start-Sleep -Seconds 1 }
}
if (-not $ok) { Pause-Exit "La app no responde en $url ($lastErr). Mira los logs: $engine compose logs" }

Start-Process $url
Write-Host "Listo: $url" -ForegroundColor Green
Start-Sleep -Seconds 2
