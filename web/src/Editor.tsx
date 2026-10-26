import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Editor as TipTap } from '@tiptap/react'
import { Download, FileText, Paperclip, Pin, Printer, RotateCcw, Trash2, X } from 'lucide-react'
import { api, flattenTree, formatDate, formatSize, type Meta, type Note, type NotePatch } from './api'
import { RichText, insertImages } from './RichText'

type Status = 'saved' | 'dirty' | 'saving' | 'error'
const STATUS: Record<Status, string> = { saved: 'Guardado', dirty: 'Editando…', saving: 'Guardando…', error: 'Error al guardar' }

type Props = {
  id: number
  meta: Meta | null
  query: string
  onChanged: () => void
  onGone: () => void
  onError: (m: string) => void
}

export function Editor({ id, meta, onChanged, onGone, onError }: Props) {
  const [note, setNote] = useState<Note | null>(null)
  const [status, setStatus] = useState<Status>('saved')
  const [tagInput, setTagInput] = useState('')
  const [dragging, setDragging] = useState(false)
  const pending = useRef<NotePatch>({})
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const fileInput = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const tiptap = useRef<TipTap | null>(null)

  useEffect(() => {
    api.note(id).then((n) => {
      setNote(n)
      if (!n.title && !n.content) setTimeout(() => titleRef.current?.focus(), 0)
    }, () => onGone())
  }, [id])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const patch = pending.current
    if (!Object.keys(patch).length) return
    pending.current = {}
    setStatus('saving')
    try {
      await api.updateNote(id, patch)
      setStatus(Object.keys(pending.current).length ? 'dirty' : 'saved')
      onChanged()
    } catch (e: any) {
      pending.current = { ...patch, ...pending.current }
      setStatus('error')
      onError(e.message)
    }
  }, [id, onChanged, onError])

  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => void flushRef.current(), [])

  function change(patch: NotePatch) {
    setNote((n) => (n ? ({ ...n, ...patch, pinned: patch.pinned === undefined ? n.pinned : patch.pinned ? 1 : 0 } as Note) : n))
    Object.assign(pending.current, patch)
    setStatus('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(flushRef.current, 700)
  }

  async function upload(files: File[]) {
    if (!files.length) return
    try {
      const list = await api.upload(id, files)
      setNote((n) => (n ? { ...n, files: list } : n))
      onChanged()
    } catch (e: any) {
      onError(e.message)
    }
  }

  /** Las imágenes pegadas/arrastradas se guardan como adjuntos y se incrustan en la nota. */
  async function uploadImage(file: File) {
    const list = await api.upload(id, [file])
    setNote((n) => (n ? { ...n, files: list } : n))
    return '/api/files/' + list[list.length - 1].id
  }

  function exportPdf() {
    const prev = document.title
    document.title = note?.title || 'Nota' // el navegador lo propone como nombre del PDF
    window.print()
    document.title = prev
  }

  function addTags(raw: string) {
    const names = raw.split(/[,\n]/).map((s) => s.trim().replace(/^#/, '')).filter(Boolean)
    if (!names.length || !note) return
    const merged = [...note.tags]
    for (const t of names) if (!merged.some((m) => m.toLowerCase() === t.toLowerCase())) merged.push(t)
    change({ tags: merged })
    setTagInput('')
  }

  function onTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') (e.preventDefault(), addTags(tagInput))
    else if (e.key === 'Backspace' && !tagInput && note?.tags.length) change({ tags: note.tags.slice(0, -1) })
  }

  if (!note) return <div className="editor loading" />
  const trashed = !!note.deleted_at

  return (
    <div
      className={'editor' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        if (!trashed && e.dataTransfer.types.includes('Files')) (e.preventDefault(), e.stopPropagation(), setDragging(true))
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        if (trashed || !e.dataTransfer.files.length) return
        e.preventDefault()
        e.stopPropagation()
        setDragging(false)
        const all = [...e.dataTransfer.files]
        const imgs = all.filter((f) => f.type.startsWith('image/'))
        if (imgs.length && tiptap.current) insertImages(tiptap.current, imgs, uploadImage).catch((err) => onError(err.message))
        upload(all.filter((f) => !imgs.includes(f)))
      }}
    >
      {trashed && (
        <div className="banner">
          Esta nota está en la papelera.
          <button
            className="btn small"
            onClick={async () => {
              await api.restoreNote(id)
              onGone()
            }}
          >
            <RotateCcw size={13} /> Restaurar
          </button>
          <button
            className="btn small danger"
            onClick={async () => {
              if (!confirm('¿Borrar para siempre? Se eliminan también sus adjuntos.')) return
              await api.deleteNote(id, true)
              onGone()
            }}
          >
            Borrar definitivamente
          </button>
        </div>
      )}

      <header className="ed-top">
        <select
          className="cat-select"
          value={note.category_id ?? ''}
          disabled={trashed}
          onChange={(e) => change({ category_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Sin categoría</option>
          {flattenTree(meta?.categories ?? []).map(({ cat: c, depth }) => (
            <option key={c.id} value={c.id}>
              {'  '.repeat(depth)}
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <span className={'status ' + status}>{STATUS[status]}</span>
        <span className="when">Editada {formatDate(note.updated_at)}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Exportar a PDF (imprimir)" onClick={exportPdf}>
          <Printer size={17} />
        </button>
        {!trashed && (
          <>
            <button
              className={'icon-btn' + (note.pinned ? ' on' : '')}
              title={note.pinned ? 'Quitar de fijadas' : 'Fijar'}
              onClick={() => change({ pinned: !note.pinned })}
            >
              <Pin size={17} fill={note.pinned ? 'currentColor' : 'none'} />
            </button>
            <button
              className="icon-btn"
              title="Mover a la papelera"
              onClick={async () => {
                await flush()
                await api.deleteNote(id)
                onGone()
              }}
            >
              <Trash2 size={17} />
            </button>
          </>
        )}
      </header>

      <div className="ed-scroll">
        <input
          ref={titleRef}
          className="ed-title"
          value={note.title}
          placeholder="Título"
          disabled={trashed}
          onChange={(e) => change({ title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), tiptap.current?.commands.focus('start'))}
        />

        <div className="ed-tags">
          {note.tags.map((t) => (
            <span key={t} className="tag static">
              #{t}
              {!trashed && (
                <button onClick={() => change({ tags: note.tags.filter((x) => x !== t) })} aria-label={`Quitar ${t}`}>
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          {!trashed && (
            <>
              <input
                list="all-tags"
                value={tagInput}
                placeholder={note.tags.length ? '' : 'Añadir etiquetas…'}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={onTagKey}
                onBlur={() => addTags(tagInput)}
              />
              <datalist id="all-tags">{meta?.tags.map((t) => <option key={t.name} value={t.name} />)}</datalist>
            </>
          )}
        </div>

        <RichText
          initial={note.content}
          editable={!trashed}
          onChange={(html) => change({ content: html })}
          onImage={uploadImage}
          editorRef={(e) => (tiptap.current = e)}
        />

        <section className="files">
          <div className="files-head">
            <Paperclip size={14} /> <span>Adjuntos</span>
            {!trashed && (
              <button className="btn small" onClick={() => fileInput.current?.click()}>
                Añadir archivo
              </button>
            )}
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => (upload([...(e.target.files ?? [])]), (e.target.value = ''))} />
          </div>
          {note.files.filter((f) => !note.content.includes(`/api/files/${f.id}`)).map((f) => (
            <div key={f.id} className="file">
              <FileText size={16} />
              <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
                {f.name}
              </a>
              <span className="muted">{formatSize(f.size)}</span>
              <span style={{ flex: 1 }} />
              <a className="icon-btn" href={`/api/files/${f.id}?download=1`} title="Descargar">
                <Download size={15} />
              </a>
              {!trashed && (
                <button
                  className="icon-btn"
                  title="Quitar adjunto"
                  onClick={async () => {
                    if (!confirm(`¿Quitar "${f.name}"?`)) return
                    await api.deleteFile(f.id)
                    setNote((n) => (n ? { ...n, files: n.files.filter((x) => x.id !== f.id) } : n))
                    onChanged()
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
          {!note.files.some((f) => !note.content.includes(`/api/files/${f.id}`)) && <p className="muted small-text">Arrastra aquí PDFs, textos o cualquier archivo. Se guardan en tu carpeta de datos y su texto se puede buscar.</p>}
        </section>
      </div>
      {dragging && <div className="drop-overlay">Suelta para adjuntar a esta nota</div>}
    </div>
  )
}
