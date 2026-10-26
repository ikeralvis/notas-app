import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { marked } from 'marked'
import { extractText, getDocumentProxy } from 'unpdf'
import { FILES_DIR, db, htmlToText, now, reindex, setTags, tx } from './db.ts'
import { backupIfDue, listBackups, runBackup, scheduleBackups } from './backup.ts'

const PORT = Number(process.env.PORT ?? 3000)
const MAX_FILE = 100 * 1024 * 1024
const app = new Hono()

// App local sin login: solo acepta peticiones dirigidas a localhost (anti DNS-rebinding)
// y rechaza escrituras que vengan de otro origen (anti CSRF desde otras webs).
app.use('*', async (c, next) => {
  const host = (c.req.header('host') ?? '').replace(/:\d+$/, '')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return c.text('Forbidden', 403)
  const origin = c.req.header('origin')
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && origin && new URL(origin).host !== c.req.header('host'))
    return c.text('Forbidden', 403)
  await next()
})

app.onError((e, c) => {
  console.error(e)
  return c.json({ error: e instanceof Error ? e.message : 'Error' }, 500)
})

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
const rows = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[]
const row = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any

app.get('/api/health', (c) => c.json({ ok: true }))

// ---------- meta (sidebar) ----------
app.get('/api/meta', (c) => {
  const live = 'n.deleted_at IS NULL'
  return c.json({
    categories: rows(
      `SELECT c.id, c.name, c.color, c.icon, c.parent_id,
              (SELECT count(*) FROM notes n WHERE n.category_id = c.id AND ${live}) AS count
       FROM categories c ORDER BY c.position, c.name`,
    ),
    tags: rows(
      `SELECT t.name, count(*) AS count FROM tags t
       JOIN note_tags nt ON nt.tag_id = t.id JOIN notes n ON n.id = nt.note_id
       WHERE ${live} GROUP BY t.id ORDER BY count DESC, t.name`,
    ),
    total: row(`SELECT count(*) AS n FROM notes n WHERE ${live}`).n,
    pinned: row(`SELECT count(*) AS n FROM notes n WHERE ${live} AND pinned = 1`).n,
    uncategorized: row(`SELECT count(*) AS n FROM notes n WHERE ${live} AND category_id IS NULL`).n,
    trash: row('SELECT count(*) AS n FROM notes WHERE deleted_at IS NOT NULL').n,
  })
})

// ---------- categorías (carpetas anidadas) ----------
const SUBTREE = `WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id) SELECT id FROM sub`
const descendants = (id: number) => rows(SUBTREE, id).map((r) => r.id as number)
const siblingTaken = (name: string, parent: number | null, except = 0) =>
  row('SELECT 1 AS x FROM categories WHERE name = ? AND coalesce(parent_id, 0) = ? AND id != ?', name, parent ?? 0, except)

function ensureCategory(parent: number | null, name: string) {
  const ex = row('SELECT id FROM categories WHERE name = ? AND coalesce(parent_id, 0) = ?', name, parent ?? 0)
  if (ex) return ex.id as number
  const pos = row('SELECT coalesce(max(position), -1) + 1 AS p FROM categories').p
  const r = db
    .prepare('INSERT INTO categories (name, color, icon, position, parent_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, '#787774', '📁', pos, parent)
  return Number(r.lastInsertRowid)
}

app.post('/api/categories', async (c) => {
  const b = await c.req.json()
  const name = String(b.name ?? '').trim()
  const parent = num(b.parent_id)
  if (!name) return c.json({ error: 'Nombre obligatorio' }, 400)
  if (siblingTaken(name, parent)) return c.json({ error: 'Ya existe una carpeta con ese nombre ahí' }, 409)
  const pos = row('SELECT coalesce(max(position), -1) + 1 AS p FROM categories').p
  const r = db
    .prepare('INSERT INTO categories (name, color, icon, position, parent_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, b.color ?? '#6366f1', b.icon || '📁', pos, parent)
  return c.json({ id: Number(r.lastInsertRowid) })
})

app.patch('/api/categories/:id', async (c) => {
  const b = await c.req.json()
  const id = Number(c.req.param('id'))
  const cur = row('SELECT * FROM categories WHERE id = ?', id)
  if (!cur) return c.json({ error: 'No existe' }, 404)
  const name = String(b.name ?? cur.name).trim()
  const parent = 'parent_id' in b ? num(b.parent_id) : (cur.parent_id as number | null)
  if (parent !== null && descendants(id).includes(parent)) return c.json({ error: 'No se puede mover dentro de sí misma' }, 400)
  if (!name || siblingTaken(name, parent, id)) return c.json({ error: 'Nombre no válido o repetido ahí' }, 409)
  db.prepare('UPDATE categories SET name = ?, color = ?, icon = ?, parent_id = ? WHERE id = ?').run(
    name,
    b.color ?? cur.color,
    b.icon || cur.icon,
    parent,
    id,
  )
  return c.json({ ok: true })
})

// Al borrar una carpeta, sus notas y subcarpetas suben un nivel (no se pierde nada).
app.delete('/api/categories/:id', (c) => {
  const id = Number(c.req.param('id'))
  const cur = row('SELECT parent_id FROM categories WHERE id = ?', id)
  if (!cur) return c.json({ ok: true })
  tx(() => {
    db.prepare('UPDATE notes SET category_id = ? WHERE category_id = ?').run(cur.parent_id, id)
    db.prepare('UPDATE categories SET parent_id = ? WHERE parent_id = ?').run(cur.parent_id, id)
    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  })
  return c.json({ ok: true })
})

// ---------- notas ----------
const SUMMARY = `
  n.id, n.title, substr(n.text, 1, 240) AS preview, n.category_id, n.pinned, n.updated_at,
  (SELECT group_concat(t.name, char(31)) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) AS tags,
  (SELECT count(*) FROM files f WHERE f.note_id = n.id) AS file_count`

/** "pasta  de" -> "pasta"* "de"*  (prefijos, sin tildes/mayúsculas gracias al tokenizer). */
function ftsQuery(q: string) {
  const terms = q.normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return terms.map((t) => `"${t}"*`).join(' ')
}

app.get('/api/notes', (c) => {
  const { q = '', category, tag, view = 'all' } = c.req.query()
  const where = [view === 'trash' ? 'n.deleted_at IS NOT NULL' : 'n.deleted_at IS NULL']
  const args: any[] = []
  const fts = ftsQuery(q)
  let select = SUMMARY
  let from = 'notes n'
  let order = 'ORDER BY n.pinned DESC, n.updated_at DESC'

  if (fts) {
    select += `, snippet(search, -1, char(1), char(2), '…', 18) AS snippet`
    from = 'search JOIN notes n ON n.id = search.note_id'
    where.push('search MATCH ?')
    args.push(fts)
    order = 'ORDER BY bm25(search, 0, 10, 1, 4, 1)'
  }
  if (view === 'pinned') where.push('n.pinned = 1')
  if (category === 'none') where.push('n.category_id IS NULL')
  else if (category) (where.push(`n.category_id IN (${SUBTREE})`), args.push(Number(category)))
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND t.name = ?)')
    args.push(tag)
  }
  return c.json(rows(`SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')} ${order} LIMIT 500`, ...args))
})

function loadNote(id: number) {
  const n = row('SELECT * FROM notes WHERE id = ?', id)
  if (!n) return null
  n.tags = rows('SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name', id).map(
    (t) => t.name,
  )
  n.files = rows('SELECT id, name, mime, size, created_at FROM files WHERE note_id = ? ORDER BY created_at', id)
  return n
}

app.get('/api/notes/:id', (c) => {
  const n = loadNote(Number(c.req.param('id')))
  return n ? c.json(n) : c.json({ error: 'No existe' }, 404)
})

app.post('/api/notes', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const t = now()
  const id = tx(() => {
    const r = db
      .prepare('INSERT INTO notes (title, content, text, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(b.title ?? '', b.content ?? '', htmlToText(b.content ?? ''), num(b.category_id), t, t)
    const id = Number(r.lastInsertRowid)
    setTags(id, Array.isArray(b.tags) ? b.tags : [])
    reindex(id)
    return id
  })
  return c.json({ id })
})

app.patch('/api/notes/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json()
  const cur = row('SELECT * FROM notes WHERE id = ?', id)
  if (!cur) return c.json({ error: 'No existe' }, 404)
  tx(() => {
    const content: string = b.content ?? cur.content
    db.prepare('UPDATE notes SET title = ?, content = ?, text = ?, category_id = ?, pinned = ?, updated_at = ? WHERE id = ?').run(
      b.title ?? cur.title,
      content,
      'content' in b ? htmlToText(content) : cur.text,
      'category_id' in b ? num(b.category_id) : cur.category_id,
      'pinned' in b ? (b.pinned ? 1 : 0) : cur.pinned,
      now(),
      id,
    )
    if (Array.isArray(b.tags)) setTags(id, b.tags)
    reindex(id)
  })
  return c.json({ ok: true })
})

function purge(id: number) {
  for (const f of rows('SELECT id FROM files WHERE note_id = ?', id)) rmSync(join(FILES_DIR, f.id), { force: true })
  tx(() => {
    db.prepare('DELETE FROM search WHERE note_id = ?').run(id)
    db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)')
  })
}

app.delete('/api/notes/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (c.req.query('permanent')) purge(id)
  else db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(now(), id)
  return c.json({ ok: true })
})

app.post('/api/notes/:id/restore', (c) => {
  db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ?').run(Number(c.req.param('id')))
  return c.json({ ok: true })
})

app.delete('/api/trash', (c) => {
  for (const n of rows('SELECT id FROM notes WHERE deleted_at IS NOT NULL')) purge(n.id)
  return c.json({ ok: true })
})

// ---------- adjuntos ----------
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|log|ini|toml|sql|js|ts|py|sh|ps1|env|conf)$/i

async function extract(name: string, mime: string, buf: Buffer) {
  try {
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
      const pdf = await getDocumentProxy(new Uint8Array(buf))
      const { text } = await extractText(pdf, { mergePages: true })
      return String(text).slice(0, 2_000_000)
    }
    if (mime.startsWith('text/') || TEXT_EXT.test(name)) return buf.toString('utf8').slice(0, 2_000_000)
  } catch (e) {
    console.warn('No se pudo extraer texto de', name, e)
  }
  return ''
}

async function attach(noteId: number, name: string, mime: string, buf: Buffer) {
  const id = randomUUID()
  writeFileSync(join(FILES_DIR, id), buf)
  const text = await extract(name, mime, buf)
  db.prepare('INSERT INTO files (id, note_id, name, mime, size, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    noteId,
    name,
    mime || 'application/octet-stream',
    buf.length,
    text,
    now(),
  )
}

app.post('/api/notes/:id/files', async (c) => {
  const noteId = Number(c.req.param('id'))
  if (!row('SELECT 1 AS x FROM notes WHERE id = ?', noteId)) return c.json({ error: 'No existe' }, 404)
  const body = await c.req.parseBody({ all: true })
  const files = [body.file].flat().filter((f): f is File => f instanceof File)
  for (const file of files) {
    if (file.size > MAX_FILE) return c.json({ error: `${file.name} supera 100 MB` }, 413)
    const buf = Buffer.from(await file.arrayBuffer())
    await attach(noteId, file.name, file.type, buf)
  }
  tx(() => {
    db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(now(), noteId)
    reindex(noteId)
  })
  return c.json(loadNote(noteId).files)
})

app.get('/api/files/:id', (c) => {
  const f = row('SELECT * FROM files WHERE id = ?', c.req.param('id'))
  const path = f && join(FILES_DIR, f.id)
  if (!f || !existsSync(path)) return c.json({ error: 'No existe' }, 404)
  const disp = c.req.query('download') ? 'attachment' : 'inline'
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: {
      'Content-Type': f.mime,
      'Content-Length': String(f.size),
      'Content-Disposition': `${disp}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff',
      // Los adjuntos (p.ej. un .html) se muestran aislados y sin scripts.
      'Content-Security-Policy': 'sandbox',
    },
  })
})

app.delete('/api/files/:id', (c) => {
  const f = row('SELECT * FROM files WHERE id = ?', c.req.param('id'))
  if (f) {
    rmSync(join(FILES_DIR, f.id), { force: true })
    tx(() => {
      db.prepare('DELETE FROM files WHERE id = ?').run(f.id)
      reindex(f.note_id)
    })
  }
  return c.json({ ok: true })
})

// ---------- importar ----------
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const textToHtml = (t: string) =>
  t
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('')
/** Las tareas `- [ ]` de Markdown pasan a lista de tareas del editor. */
const mdTasks = (html: string) =>
  html
    .replace(
      /<li>(s*<p>)?s*<input (checked="" )?disabled="" type="checkbox">s*/g,
      (_, p, c) => `<li data-type="taskItem" data-checked="${c ? 'true' : 'false'}">${p ?? ''}`,
    )
    .replace(/<ul>(s*<li data-type="taskItem")/g, '<ul data-type="taskList">$1')
/** UTF-8 y, si no lo es (bloc de notas antiguo), Windows-1252. */
function decode(buf: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

// Cada archivo -> una nota. Los .txt/.md pasan a ser el texto de la nota; el resto (PDF, etc.) se adjunta.
// Si llegan con ruta (carpeta elegida), las subcarpetas se convierten en categorías anidadas.
app.post('/api/import', async (c) => {
  const body = await c.req.parseBody({ all: true })
  const files = [body.file].flat().filter((f): f is File => f instanceof File)
  const paths = [body.path].flat().map(String)
  const root = num(body.category_id)
  let notes = 0
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const parts = (paths[i] || f.name).replace(/\\/g, '/').split('/').filter(Boolean)
    const fname = parts.pop() ?? f.name
    if (fname.startsWith('.') || f.size > MAX_FILE) continue
    let parent = root
    for (const dir of parts) parent = ensureCategory(parent, dir)
    const buf = Buffer.from(await f.arrayBuffer())
    const isText = /\.(txt|md|markdown)$/i.test(fname)
    let html = ''
    if (isText) {
      const t = decode(buf)
      html = /\.txt$/i.test(fname) ? textToHtml(t) : mdTasks(marked.parse(t, { gfm: true, breaks: true }) as string)
    }
    const stamp = f.lastModified ? new Date(f.lastModified).toISOString() : now()
    const id = tx(() => {
      const r = db
        .prepare('INSERT INTO notes (title, content, text, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(fname.replace(/\.[^.]+$/, ''), html, htmlToText(html), parent, stamp, stamp)
      return Number(r.lastInsertRowid)
    })
    if (!isText) await attach(id, fname, f.type, buf)
    reindex(id)
    notes++
  }
  return c.json({ notes })
})

// ---------- backups / export ----------
app.get('/api/backups', (c) => c.json(listBackups()))
app.post('/api/backups', (c) => c.json({ name: runBackup() }))

app.get('/api/export', (c) => {
  const notes = rows('SELECT id FROM notes').map((n) => loadNote(n.id))
  return new Response(JSON.stringify({ exported_at: now(), categories: rows('SELECT * FROM categories'), notes }, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="notas-export.json"' },
  })
})

// ---------- frontend ----------
app.use('/*', serveStatic({ root: './public' }))
app.get('*', serveStatic({ path: './public/index.html' }))

scheduleBackups()
const server = serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, () => console.log(`Notas escuchando en :${PORT}`))

// Cierre limpio (docker/podman stop envían SIGTERM): termina las peticiones, copia si toca y cierra la BD.
// Cada escritura ya está confirmada en disco (SQLite sin WAL), esto es un seguro extra.
function shutdown() {
  console.log('Cerrando…')
  server.close()
  try {
    backupIfDue()
    db.close()
  } catch (e) {
    console.error(e)
  }
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
