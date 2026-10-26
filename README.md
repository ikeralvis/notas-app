# Notas

App personal de notas y documentos con categorías, etiquetas y búsqueda dentro del contenido (SQLite FTS5).
Hono (API) + React/Vite (frontend) en un solo contenedor. Compatible con Podman y Docker.

## Uso
1. Una vez: `powershell -ExecutionPolicy Bypass -File scripts\crear-acceso-directo.ps1` (crea "Notas" y "Parar Notas" en el escritorio).
2. Doble clic en **Notas**: arranca `podman machine` si hace falta, levanta el contenedor y abre http://localhost:3000.

### Sin contenedores (solo Node 22.18+)
`powershell -ExecutionPolicy Bypass -File scriptscrear-acceso-directo.ps1 -Local` crea un acceso "Notas" que instala, compila y arranca con Node; cierra su ventana para parar. Usa los mismos `data/`, `backups/` y `.env`.

## Datos y copias
- `data/notas.db` (SQLite) y `data/files/` (adjuntos): carpetas del PC, no volúmenes del motor. Ábrela con DBeaver (conexión SQLite).
- `backups/`: copia diaria automática (30 últimas) + espejo de adjuntos. Botón manual en la barra lateral.
- Para moverlas (p. ej. a OneDrive) copia `.env.example` a `.env` y cambia `NOTAS_DATA` / `NOTAS_BACKUPS`.
- Restaurar: para la app, copia un `backups/notas-*.db` sobre `data/notas.db`.

## Desarrollo
`docker compose up -d --build` (o `podman compose ...`). Frontend con recarga: `cd web && npm i && npm run dev` (proxy a :3000).
