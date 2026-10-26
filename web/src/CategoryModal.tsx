import { useState } from 'react'
import { api, buildTree, flattenTree, type Category } from './api'

const COLORS = ['#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#eab308', '#78716c']

export function CategoryModal({
  cat,
  parentId,
  categories,
  onClose,
  onDone,
  onError,
}: {
  cat?: Category
  parentId: number | null
  categories: Category[]
  onClose: () => void
  onDone: () => void
  onError: (m: string) => void
}) {
  const [name, setName] = useState(cat?.name ?? '')
  const [icon, setIcon] = useState(cat?.icon ?? '📁')
  const [color, setColor] = useState(cat?.color ?? COLORS[4])
  const [parent, setParent] = useState<number | null>(cat ? cat.parent_id : parentId)

  // Una carpeta no puede colgar de sí misma ni de sus descendientes.
  const forbidden = new Set<number>()
  if (cat) {
    const collect = (nodes: ReturnType<typeof buildTree>) =>
      nodes.forEach((n) => {
        if (n.id === cat.id) {
          const add = (m: typeof n) => (forbidden.add(m.id), m.children.forEach(add))
          add(n)
        } else collect(n.children)
      })
    collect(buildTree(categories))
  }

  async function save() {
    if (!name.trim()) return
    try {
      const body = { name: name.trim(), icon: icon.trim() || '📁', color, parent_id: parent }
      await (cat ? api.updateCategory(cat.id, body) : api.createCategory(body))
      onDone()
    } catch (e: any) {
      onError(e.message)
    }
  }

  async function remove() {
    if (!cat || !confirm(`¿Borrar la carpeta "${cat.name}"? Sus notas y subcarpetas suben un nivel; no se borra nada más.`)) return
    await api.deleteCategory(cat.id)
    onDone()
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h3>{cat ? 'Editar carpeta' : parentId ? 'Nueva subcarpeta' : 'Nueva carpeta'}</h3>
        <label>
          Nombre
          <div className="name-row">
            <input className="emoji" value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} />
            <input autoFocus value={name} placeholder="Ej. Recetas" onChange={(e) => setName(e.target.value)} />
          </div>
        </label>
        <label>
          Dentro de
          <select className="field" value={parent ?? ''} onChange={(e) => setParent(e.target.value ? Number(e.target.value) : null)}>
            <option value="">(raíz)</option>
            {flattenTree(categories)
              .filter(({ cat: c }) => !forbidden.has(c.id))
              .map(({ cat: c, depth }) => (
                <option key={c.id} value={c.id}>
                  {'  '.repeat(depth)}
                  {c.icon} {c.name}
                </option>
              ))}
          </select>
        </label>
        <div className="swatches">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              className={'swatch' + (c === color ? ' on' : '')}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={c}
            />
          ))}
        </div>
        <div className="modal-actions">
          {cat && (
            <button type="button" className="btn danger" onClick={remove}>
              Borrar
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!name.trim()}>
            Guardar
          </button>
        </div>
      </form>
    </div>
  )
}
