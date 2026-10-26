import { useState } from 'react'
import { ChevronRight, DatabaseBackup, Download, FolderPlus, Hash, Layers, Moon, Pencil, Pin, Plus, Sun, Trash2, Upload } from 'lucide-react'
import { buildTree, type CatNode, type Category, type Filter, type Meta } from './api'

type Props = {
  meta: Meta | null
  filter: Filter
  theme: 'light' | 'dark'
  onFilter: (f: Filter) => void
  onNewCategory: (parentId: number | null) => void
  onEditCategory: (c: Category) => void
  onMoveNote: (noteId: number, categoryId: number | null) => void
  onImport: () => void
  onToggleTheme: () => void
  onBackup: () => void
}

const collapsedKey = 'collapsed-folders'
const loadCollapsed = (): Set<number> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(collapsedKey) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function Sidebar(p: Props) {
  const { meta, filter, theme, onFilter } = p
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [over, setOver] = useState<number | 'none' | null>(null)
  const is = (f: Partial<Filter>) => Object.entries(f).every(([k, v]) => (filter as any)[k] === v)

  function toggle(id: number) {
    const next = new Set(collapsed)
    next.has(id) ? next.delete(id) : next.add(id)
    setCollapsed(next)
    localStorage.setItem(collapsedKey, JSON.stringify([...next]))
  }

  // Soltar una nota (arrastrada desde la lista) sobre una carpeta la mueve ahí.
  const dropProps = (target: number | 'none') => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('text/x-note-id')) (e.preventDefault(), setOver(target))
    },
    onDragLeave: () => setOver((o) => (o === target ? null : o)),
    onDrop: (e: React.DragEvent) => {
      const id = Number(e.dataTransfer.getData('text/x-note-id'))
      setOver(null)
      if (id) (e.preventDefault(), p.onMoveNote(id, target === 'none' ? null : target))
    },
  })

  const renderNode = (n: CatNode, depth: number) => {
    const open = !collapsed.has(n.id)
    const active = is({ view: 'category', category: n.id })
    return (
      <div key={n.id}>
        <div className={'nav-row' + (active ? ' active' : '') + (over === n.id ? ' over' : '')} {...dropProps(n.id)}>
          <button
            className={'chev' + (n.children.length ? '' : ' hidden') + (open ? ' open' : '')}
            style={{ marginLeft: 4 + depth * 14 }}
            onClick={() => toggle(n.id)}
            aria-label={open ? 'Contraer' : 'Expandir'}
            tabIndex={n.children.length ? 0 : -1}
          >
            <ChevronRight size={13} />
          </button>
          <button className="nav-item" onClick={() => onFilter({ view: 'category', category: n.id })}>
            <span className="cat-dot" style={{ ['--c' as any]: n.color }}>
              {n.icon}
            </span>
            <span>{n.name}</span>
            <em>{n.total || ''}</em>
          </button>
          <span className="row-actions">
            <button className="icon-btn" title="Nueva subcarpeta" onClick={() => p.onNewCategory(n.id)}>
              <FolderPlus size={13} />
            </button>
            <button className="icon-btn" title="Editar carpeta" onClick={() => p.onEditCategory(n)}>
              <Pencil size={13} />
            </button>
          </span>
        </div>
        {open && n.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/favicon.svg" alt="" width="22" height="22" />
        <span>Notas</span>
      </div>

      <nav>
        <button className={'nav-item' + (is({ view: 'all' }) ? ' active' : '')} onClick={() => onFilter({ view: 'all' })}>
          <Layers size={16} /> <span>Todas</span> <em>{meta?.total ?? ''}</em>
        </button>
        <button className={'nav-item' + (is({ view: 'pinned' }) ? ' active' : '')} onClick={() => onFilter({ view: 'pinned' })}>
          <Pin size={16} /> <span>Fijadas</span> <em>{meta?.pinned ?? ''}</em>
        </button>

        <div className="nav-head">
          <span>Carpetas</span>
          <button className="icon-btn" title="Nueva carpeta" onClick={() => p.onNewCategory(null)}>
            <Plus size={15} />
          </button>
        </div>
        {meta && buildTree(meta.categories).map((n) => renderNode(n, 0))}
        {!!meta?.uncategorized && (
          <div className={'nav-row' + (is({ view: 'category', category: 'none' }) ? ' active' : '') + (over === 'none' ? ' over' : '')} {...dropProps('none')}>
            <button className="nav-item" style={{ paddingLeft: 26 }} onClick={() => onFilter({ view: 'category', category: 'none' })}>
              <span className="cat-dot plain">·</span> <span>Sin carpeta</span> <em>{meta.uncategorized}</em>
            </button>
          </div>
        )}

        {!!meta?.tags.length && (
          <>
            <div className="nav-head">
              <span>Etiquetas</span>
            </div>
            <div className="tag-cloud">
              {meta.tags.map((t) => (
                <button
                  key={t.name}
                  className={'tag' + (is({ view: 'tag', tag: t.name }) ? ' active' : '')}
                  onClick={() => onFilter({ view: 'tag', tag: t.name })}
                >
                  <Hash size={11} />
                  {t.name}
                </button>
              ))}
            </div>
          </>
        )}
      </nav>

      <div className="side-foot">
        <button className={'nav-item' + (is({ view: 'trash' }) ? ' active' : '')} onClick={() => onFilter({ view: 'trash' })}>
          <Trash2 size={16} /> <span>Papelera</span> <em>{meta?.trash || ''}</em>
        </button>
        <div className="foot-actions">
          <button className="icon-btn" title="Importar archivos o carpetas" onClick={p.onImport}>
            <Upload size={17} />
          </button>
          <button className="icon-btn" title="Crear copia de seguridad ahora" onClick={p.onBackup}>
            <DatabaseBackup size={17} />
          </button>
          <a className="icon-btn" title="Exportar todo (JSON)" href="/api/export">
            <Download size={17} />
          </a>
          <button className="icon-btn" title="Cambiar tema" onClick={p.onToggleTheme}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </div>
    </aside>
  )
}
