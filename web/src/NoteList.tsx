import { useState, type RefObject } from 'react'
import { Paperclip, Pin, Plus, Search, X } from 'lucide-react'
import { categoryPath, formatDate, type Filter, type Meta, type NoteSummary } from './api'

type Props = {
  notes: NoteSummary[]
  meta: Meta | null
  filter: Filter
  q: string
  searchRef: RefObject<HTMLInputElement>
  selected: number | null
  onQuery: (q: string) => void
  onSelect: (id: number) => void
  onNew: () => void
  onDropFiles: (files: File[]) => void
  onEmptyTrash: () => void
}

/** El servidor marca las coincidencias con \x01 ... \x02 (así no hace falta HTML sin escapar). */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/([\x01-\x02])/)
  let on = false
  return (
    <>
      {parts.map((p, i) => {
        if (p === '\x01') return ((on = true), null)
        if (p === '\x02') return ((on = false), null)
        return on ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>
      })}
    </>
  )
}

function title(f: Filter, meta: Meta | null) {
  if (f.view === 'all') return 'Todas las notas'
  if (f.view === 'pinned') return 'Fijadas'
  if (f.view === 'trash') return 'Papelera'
  if (f.view === 'tag') return '#' + f.tag
  if (f.category === 'none') return 'Sin categoría'
  return categoryPath(meta?.categories ?? [], f.category as number)
}

export function NoteList({ notes, meta, filter, q, searchRef, selected, onQuery, onSelect, onNew, onDropFiles, onEmptyTrash }: Props) {
  const [dragging, setDragging] = useState(false)
  const cats = new Map(meta?.categories.map((c) => [c.id, c]))
  const searching = q.trim().length > 0

  return (
    <section
      className={'list' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) (e.preventDefault(), setDragging(true))
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer.files.length) onDropFiles([...e.dataTransfer.files])
      }}
    >
      <div className="search">
        <Search size={16} />
        <input
          ref={searchRef}
          value={q}
          placeholder="Buscar en todo el contenido…"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (onQuery(''), e.currentTarget.blur())}
        />
        {q ? (
          <button className="icon-btn" onClick={() => onQuery('')} title="Limpiar">
            <X size={14} />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
      </div>

      <div className="list-head">
        <h2>{searching ? `Resultados para “${q.trim()}”` : title(filter, meta)}</h2>
        <span className="count">{notes.length}</span>
        {filter.view === 'trash' ? (
          !!notes.length && (
            <button className="btn small danger" onClick={onEmptyTrash}>
              Vaciar
            </button>
          )
        ) : (
          <button className="btn small primary" onClick={onNew}>
            <Plus size={14} /> Nueva
          </button>
        )}
      </div>

      <div className="items">
        {notes.map((n) => {
          const cat = n.category_id ? cats.get(n.category_id) : undefined
          const tags = n.tags ? n.tags.split('\x1f') : []
          return (
            <button
              key={n.id}
              className={'item' + (n.id === selected ? ' selected' : '')}
              draggable
              onDragStart={(e) => (e.dataTransfer.setData('text/x-note-id', String(n.id)), (e.dataTransfer.effectAllowed = 'move'))}
              onClick={() => onSelect(n.id)}
            >
              <div className="item-top">
                <strong>{n.title || 'Sin título'}</strong>
                {!!n.pinned && <Pin size={12} className="pin" fill="currentColor" />}
                <time>{formatDate(n.updated_at)}</time>
              </div>
              <p>{n.snippet ? <Highlighted text={n.snippet} /> : n.preview.replace(/[#*`>\-\[\]]/g, '').trim() || 'Nota vacía'}</p>
              <div className="item-meta">
                {cat && (
                  <span className="chip" style={{ ['--c' as any]: cat.color }}>
                    {cat.icon} {categoryPath(meta?.categories ?? [], cat.id)}
                  </span>
                )}
                {tags.slice(0, 3).map((t) => (
                  <span key={t} className="hashtag">
                    #{t}
                  </span>
                ))}
                {n.file_count > 0 && (
                  <span className="clip">
                    <Paperclip size={12} /> {n.file_count}
                  </span>
                )}
              </div>
            </button>
          )
        })}
        {!notes.length && (
          <div className="empty-list">
            {searching ? 'Nada coincide con tu búsqueda.' : filter.view === 'trash' ? 'La papelera está vacía.' : 'No hay notas aquí todavía.'}
          </div>
        )}
      </div>
      {dragging && <div className="drop-overlay">Suelta para crear una nota con el documento</div>}
    </section>
  )
}
