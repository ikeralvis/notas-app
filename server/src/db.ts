import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const DATA_DIR = process.env.DATA_DIR ?? './data'
export const BACKUP_DIR = process.env.BACKUP_DIR ?? './backups'
export const FILES_DIR = join(DATA_DIR, 'files')

mkdirSync(FILES_DIR, { recursive: true })
mkdirSync(BACKUP_DIR, { recursive: true })

export const db = new DatabaseSync(join(DATA_DIR, 'notas.db'))

// journal_mode=DELETE (no WAL): la carpeta de datos suele ser un bind mount de Windows (9p/drvfs),
// donde WAL no es fiable. Es un solo usuario, no necesitamos concurrencia.
db.exec(`
  PRAGMA journal_mode = DELETE;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  -- Categorías = carpetas: pueden anidarse con parent_id.
  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL COLLATE NOCASE,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    icon       TEXT NOT NULL DEFAULT '📁',
    position   INTEGER NOT NULL DEFAULT 0,
    parent_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    deleted_at  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category_id);

  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS files (
    id         TEXT PRIMARY KEY,
    note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    text       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_files_note ON files(note_id);

  -- Índice de búsqueda de texto completo: título, contenido, etiquetas y texto de adjuntos.
  CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
    note_id UNINDEXED, title, body, tags, files,
    tokenize = "unicode61 remove_diacritics 2"
  );
`)

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// Migración: BD anterior a las carpetas (nombre único global, sin parent_id) -> se reconstruye la tabla.
if (!db.prepare('PRAGMA table_info(categories)').all().some((c) => c.name === 'parent_id')) {
  db.exec('PRAGMA foreign_keys = OFF')
  tx(() =>
    db.exec(`
      CREATE TABLE categories_new (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, color TEXT NOT NULL DEFAULT '#6366f1',
        icon TEXT NOT NULL DEFAULT '📁', position INTEGER NOT NULL DEFAULT 0,
        parent_id INTEGER REFERENCES categories_new(id) ON DELETE SET NULL
      );
      INSERT INTO categories_new (id, name, color, icon, position) SELECT id, name, color, icon, position FROM categories;
      DROP TABLE categories;
      ALTER TABLE categories_new RENAME TO categories;
    `),
  )
  db.exec('PRAGMA foreign_keys = ON')
}
// Nombre único solo entre hermanas (puede haber "Recetas" en dos carpetas distintas).
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_unique ON categories (coalesce(parent_id, 0), name)')

export const now = () => new Date().toISOString()

/** El editor guarda HTML; para buscar y para las vistas previas se usa su texto plano. */
export function htmlToText(content: string) {
  if (!content.trimStart().startsWith('<')) return content // nota antigua en Markdown
  return content
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Migración: columna con el texto plano de cada nota.
if (!db.prepare('PRAGMA table_info(notes)').all().some((c) => c.name === 'text')) {
  db.exec("ALTER TABLE notes ADD COLUMN text TEXT NOT NULL DEFAULT ''")
  const upd = db.prepare('UPDATE notes SET text = ? WHERE id = ?')
  for (const n of db.prepare('SELECT id, content FROM notes').all()) upd.run(htmlToText(n.content as string), n.id as number)
}

export function reindex(noteId: number) {
  const note = db.prepare('SELECT title, text AS content FROM notes WHERE id = ?').get(noteId) as
    | { title: string; content: string }
    | undefined
  db.prepare('DELETE FROM search WHERE note_id = ?').run(noteId)
  if (!note) return
  const tags = db
    .prepare('SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?')
    .all(noteId)
    .map((r) => r.name as string)
    .join(' ')
  const files = db
    .prepare('SELECT name, text FROM files WHERE note_id = ?')
    .all(noteId)
    .map((r) => `${r.name}\n${r.text}`)
    .join('\n')
  db.prepare('INSERT INTO search (note_id, title, body, tags, files) VALUES (?, ?, ?, ?, ?)').run(
    noteId,
    note.title,
    note.content,
    tags,
    files,
  )
}

export function setTags(noteId: number, names: string[]) {
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId)
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim().replace(/^#/, '')
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name)
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }
    db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tag.id)
  }
  db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)')
}

function seed() {
  const { n } = db.prepare('SELECT count(*) AS n FROM categories').get() as { n: number }
  if (n > 0) return
  const defaults: [string, string, string][] = [
    ['Personal', '#f97316', '🏠'],
    ['Trabajo', '#3b82f6', '💼'],
    ['Ideas', '#eab308', '💡'],
    ['Documentos', '#10b981', '📄'],
  ]
  defaults.forEach(([name, color, icon], i) =>
    db.prepare('INSERT INTO categories (name, color, icon, position) VALUES (?, ?, ?, ?)').run(name, color, icon, i),
  )
  const t = now()
  const html = `<p>Esta es tu app de notas. Todo se guarda en una base de datos SQLite en tu disco.</p>
<ul><li><p><strong>Busca</strong> con <code>Ctrl+K</code>: encuentra texto <em>dentro</em> de las notas y de los PDF adjuntos, no solo por título.</p></li>
<li><p>Organiza con <strong>categorías</strong> (barra lateral) y <strong>etiquetas</strong>.</p></li>
<li><p>Selecciona texto para darle formato, o escribe <code>#</code>, <code>-</code>, <code>[]</code> para títulos, listas y tareas.</p></li>
<li><p>Arrastra archivos sobre una nota para <u>adjuntarlos</u>; su texto también se indexa.</p></li></ul>
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Instalar la app</p></li><li data-type="taskItem" data-checked="false"><p>Borrar esta nota</p></li></ul>`
  const welcome = db
    .prepare('INSERT INTO notes (title, content, text, category_id, pinned, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)')
    .run('Bienvenido a Notas', html, htmlToText(html), t, t)
  const id = Number(welcome.lastInsertRowid)
  setTags(id, ['inicio'])
  reindex(id)
}
seed()
