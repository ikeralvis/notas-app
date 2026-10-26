import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BACKUP_DIR, FILES_DIR, db } from './db.ts'

const KEEP = 30
const HOUR = 60 * 60 * 1000
/** Cada cuántos días se hace una copia automática (BACKUP_EVERY_DAYS, por defecto 1). */
const EVERY_DAYS = Math.max(1, Number(process.env.BACKUP_EVERY_DAYS) || 1)

export function listBackups() {
  return readdirSync(BACKUP_DIR)
    .filter((f) => /^notas-.*\.db$/.test(f))
    .sort()
    .reverse()
    .map((name) => {
      const s = statSync(join(BACKUP_DIR, name))
      return { name, size: s.size, created_at: s.mtime.toISOString() }
    })
}

/** Copia consistente de la BD (VACUUM INTO) + espejo de los adjuntos. */
export function runBackup() {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const name = `notas-${stamp}.db`
  db.prepare('VACUUM INTO ?').run(join(BACKUP_DIR, name))

  const mirror = join(BACKUP_DIR, 'files')
  mkdirSync(mirror, { recursive: true })
  for (const f of readdirSync(FILES_DIR)) {
    if (!existsSync(join(mirror, f))) copyFileSync(join(FILES_DIR, f), join(mirror, f))
  }

  for (const old of listBackups().slice(KEEP)) rmSync(join(BACKUP_DIR, old.name))
  return name
}

/** Hace la copia solo si la última tiene al menos EVERY_DAYS días (con 3 h de margen). */
export function backupIfDue() {
  const last = listBackups()[0]
  if (!last || Date.now() - new Date(last.created_at).getTime() >= EVERY_DAYS * 24 * HOUR - 3 * HOUR) {
    try {
      console.log('Backup creado:', runBackup())
    } catch (e) {
      console.error('Backup fallido:', e)
    }
  }
}

/** Comprueba al arrancar y luego cada hora (por si la app está abierta días seguidos). */
export function scheduleBackups() {
  backupIfDue()
  setInterval(backupIfDue, HOUR).unref()
}
