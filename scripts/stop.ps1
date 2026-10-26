# Para la app (los datos se conservan en ./data). Con -Machine tambien apaga la maquina de Podman.
param([switch]$Machine)
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (Get-Command podman -ErrorAction SilentlyContinue) { $engine = 'podman' } else { $engine = 'docker' }
& $engine compose down
if ($Machine -and $engine -eq 'podman') { podman machine stop }
Write-Host "Notas parada. Tus datos siguen en la carpeta data." -ForegroundColor Green
Start-Sleep -Seconds 2
