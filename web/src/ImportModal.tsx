import { useRef, useState } from 'react'
import { FileUp, FolderUp } from 'lucide-react'
import { api, flattenTree, type Category } from './api'

export function ImportModal({
  categories,
  defaultCategory,
  onClose,
  onDone,
  onError,
}: {
  categories: Category[]
  defaultCategory: number | null
  onClose: () => void
  onDone: (n: number) => void
  onError: (m: string) => void
}) {
  const [dest, setDest] = useState<number | null>(defaultCategory)
  const [busy, setBusy] = useState(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  async function run(list: FileList | null) {
    const files = [...(list ?? [])]
    if (!files.length) return
    setBusy(true)
    try {
      const { notes } = await api.importFiles(files, dest)
      onDone(notes)
    } catch (e: any) {
      onError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
        <h3>Importar</h3>
        <p className="muted small-text" style={{ margin: 0 }}>
          Cada archivo <b>.txt</b> o <b>.md</b> pasa a ser una nota. Otros archivos (PDF, etc.) se importan como nota con el archivo adjunto. Si eliges una
          carpeta, sus subcarpetas se convierten en carpetas de la app.
        </p>
        <label>
          Importar dentro de
          <select className="field" value={dest ?? ''} onChange={(e) => setDest(e.target.value ? Number(e.target.value) : null)} disabled={busy}>
            <option value="">(sin carpeta / raíz)</option>
            {flattenTree(categories).map(({ cat: c, depth }) => (
              <option key={c.id} value={c.id}>
                {'  '.repeat(depth)}
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="import-actions">
          <button className="btn" disabled={busy} onClick={() => filesInput.current?.click()}>
            <FileUp size={15} /> Elegir archivos
          </button>
          <button className="btn" disabled={busy} onClick={() => folderInput.current?.click()}>
            <FolderUp size={15} /> Elegir carpeta
          </button>
        </div>
        <input ref={filesInput} type="file" multiple hidden onChange={(e) => run(e.target.files)} />
        <input ref={folderInput} type="file" hidden {...({ webkitdirectory: '', directory: '' } as object)} onChange={(e) => run(e.target.files)} />
        {busy && <p className="muted small-text" style={{ margin: 0 }}>Importando…</p>}
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
