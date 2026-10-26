import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Category, type Filter, type Meta, type NoteSummary } from './api'
import { Sidebar } from './Sidebar'
import { NoteList } from './NoteList'
import { Editor } from './Editor'
import { CategoryModal } from './CategoryModal'
import { ImportModal } from './ImportModal'

type Theme = 'light' | 'dark'
const initialTheme = (): Theme => {
  const saved = localStorage.getItem('theme')
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [filter, setFilter] = useState<Filter>({ view: 'all' })
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [catModal, setCatModal] = useState<{ cat?: Category; parentId: number | null } | null>(null)
  const [importing, setImporting] = useState(false)
  const [toast, setToast] = useState('')
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const searchRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 180)
    return () => clearTimeout(t)
  }, [q])

  const refresh = useCallback(async () => {
    const id = ++reqId.current
    const [m, n] = await Promise.all([api.meta(), api.notes(debouncedQ, filter)])
    if (id !== reqId.current) return // respuesta antigua
    setMeta(m)
    setNotes(n)
  }, [debouncedQ, filter])

  useEffect(() => {
    refresh().catch((e) => flash(String(e.message ?? e)))
  }, [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newNoteRef.current()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const newNoteRef = useRef<() => void>(() => {})
  newNoteRef.current = () => void newNote()

  async function moveNote(noteId: number, categoryId: number | null) {
    await api.updateNote(noteId, { category_id: categoryId })
    flash('Nota movida')
    refresh()
  }

  async function newNote() {
    const { id } = await api.createNote({
      category_id: filter.view === 'category' && typeof filter.category === 'number' ? filter.category : null,
      tags: filter.view === 'tag' && filter.tag ? [filter.tag] : [],
    })
    if (filter.view === 'trash' || filter.view === 'pinned') setFilter({ view: 'all' })
    setQ('')
    setDebouncedQ('')
    setSelected(id)
    refresh()
  }

  async function dropFiles(files: File[]) {
    for (const f of files) {
      const { id } = await api.createNote({ title: f.name.replace(/\.[^.]+$/, '') })
      await api.upload(id, [f])
      setSelected(id)
    }
    flash(files.length === 1 ? 'Documento añadido' : `${files.length} documentos añadidos`)
    refresh()
  }

  async function backup() {
    try {
      const { name } = await api.backup()
      flash(`Copia creada: ${name}`)
    } catch (e: any) {
      flash('Error en la copia: ' + e.message)
    }
  }

  return (
    <div className="app">
      <Sidebar
        meta={meta}
        filter={filter}
        theme={theme}
        onFilter={(f) => {
          setFilter(f)
          setSelected(null)
        }}
        onNewCategory={(parentId) => setCatModal({ parentId })}
        onEditCategory={(cat) => setCatModal({ cat, parentId: cat.parent_id })}
        onMoveNote={moveNote}
        onImport={() => setImporting(true)}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onBackup={backup}
      />
      <NoteList
        notes={notes}
        meta={meta}
        filter={filter}
        q={q}
        searchRef={searchRef}
        selected={selected}
        onQuery={setQ}
        onSelect={setSelected}
        onNew={newNote}
        onDropFiles={dropFiles}
        onEmptyTrash={async () => {
          if (!confirm('¿Vaciar la papelera? Esto no se puede deshacer.')) return
          await api.emptyTrash()
          setSelected(null)
          refresh()
        }}
      />
      <main className="pane">
        {selected ? (
          <Editor
            key={selected}
            id={selected}
            meta={meta}
            query={debouncedQ}
            onChanged={refresh}
            onGone={() => {
              setSelected(null)
              refresh()
            }}
            onError={flash}
          />
        ) : (
          <div className="empty-pane">
            <p>Selecciona una nota o crea una nueva</p>
            <button className="btn primary" onClick={newNote}>
              Nueva nota
            </button>
            <span className="hint">
              <kbd>Ctrl</kbd> <kbd>K</kbd> buscar · <kbd>Alt</kbd> <kbd>N</kbd> nota nueva
            </span>
          </div>
        )}
      </main>
      {catModal && (
        <CategoryModal
          cat={catModal.cat}
          parentId={catModal.parentId}
          categories={meta?.categories ?? []}
          onClose={() => setCatModal(null)}
          onDone={() => {
            setCatModal(null)
            refresh()
          }}
          onError={flash}
        />
      )}
      {importing && (
        <ImportModal
          categories={meta?.categories ?? []}
          defaultCategory={filter.view === 'category' && typeof filter.category === 'number' ? filter.category : null}
          onClose={() => setImporting(false)}
          onDone={(n) => {
            setImporting(false)
            flash(n ? `${n} ${n === 1 ? 'nota importada' : 'notas importadas'}` : 'No se importó nada')
            refresh()
          }}
          onError={flash}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
