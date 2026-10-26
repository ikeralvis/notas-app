import { createRoot, type Root } from 'react-dom/client'
import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import {
  CodeSquare, Heading1, Table as TableIcon, Heading2, Heading3, Image as ImageIcon, List, ListChecks, ListOrdered, Minus, Quote, Type,
} from 'lucide-react'
import type { ReactNode } from 'react'

type Item = { title: string; hint: string; icon: ReactNode; keys: string; run: (e: Editor, r: Range, o: SlashOptions) => void }
export type SlashOptions = { pickImage: () => void }

const ITEMS: Item[] = [
  { title: 'Texto', hint: 'Párrafo normal', icon: <Type size={18} />, keys: 'texto parrafo p', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { title: 'Título 1', hint: 'Encabezado grande', icon: <Heading1 size={18} />, keys: 'titulo h1 encabezado', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { title: 'Título 2', hint: 'Encabezado mediano', icon: <Heading2 size={18} />, keys: 'titulo h2 encabezado', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { title: 'Título 3', hint: 'Encabezado pequeño', icon: <Heading3 size={18} />, keys: 'titulo h3 encabezado', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
  { title: 'Lista', hint: 'Con viñetas', icon: <List size={18} />, keys: 'lista viñetas bullet', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: 'Lista numerada', hint: '1. 2. 3.', icon: <ListOrdered size={18} />, keys: 'lista numerada ordenada', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: 'Tareas', hint: 'Con casillas', icon: <ListChecks size={18} />, keys: 'tareas todo checklist casillas', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { title: 'Cita', hint: 'Texto destacado', icon: <Quote size={18} />, keys: 'cita quote', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: 'Código', hint: 'Bloque de código', icon: <CodeSquare size={18} />, keys: 'codigo code', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: 'Separador', hint: 'Línea horizontal', icon: <Minus size={18} />, keys: 'separador linea divider hr', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { title: 'Tabla', hint: 'Filas y columnas', icon: <TableIcon size={18} />, keys: 'tabla table filas columnas', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Imagen', hint: 'Subir desde el PC', icon: <ImageIcon size={18} />, keys: 'imagen foto picture', run: (e, r, o) => (e.chain().focus().deleteRange(r).run(), o.pickImage()) },
]

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function Menu({ items, index, rect, onPick }: { items: Item[]; index: number; rect: DOMRect | null; onPick: (i: number) => void }) {
  if (!rect) return null
  const below = rect.bottom + 330 < innerHeight
  return (
    <div className="slash" style={{ left: Math.min(rect.left, innerWidth - 260), ...(below ? { top: rect.bottom + 6 } : { bottom: innerHeight - rect.top + 6 }) }}>
      {items.length ? (
        items.map((it, i) => (
          <button
            key={it.title}
            ref={(el) => i === index && el?.scrollIntoView({ block: 'nearest' })}
            className={'slash-item' + (i === index ? ' on' : '')}
            onMouseDown={(e) => (e.preventDefault(), onPick(i))}
          >
            <span className="slash-ico">{it.icon}</span>
            <span>
              <strong>{it.title}</strong>
              <small>{it.hint}</small>
            </span>
          </button>
        ))
      ) : (
        <div className="slash-empty">Sin resultados</div>
      )}
    </div>
  )
}

/** Menú "/" al estilo Notion para insertar bloques. */
export const SlashCommand = Extension.create<SlashOptions>({
  name: 'slashCommand',
  addOptions() {
    return { pickImage: () => {} }
  },
  addProseMirrorPlugins() {
    const opts = this.options
    return [
      Suggestion<Item, Item>({
        editor: this.editor,
        char: '/',
        items: ({ query }) => {
          const q = norm(query)
          return ITEMS.filter((it) => !q || norm(it.title + ' ' + it.keys).includes(q))
        },
        command: ({ editor, range, props }) => props.run(editor, range, opts),
        render: () => {
          let el: HTMLDivElement
          let root: Root
          let index = 0
          let items: Item[] = []
          let rect: DOMRect | null = null
          let pick: (i: number) => void = () => {}
          const draw = () => root.render(<Menu items={items} index={index} rect={rect} onPick={(i) => pick(i)} />)
          return {
            onStart(p) {
              el = document.createElement('div')
              document.body.appendChild(el)
              root = createRoot(el)
              items = p.items
              index = 0
              rect = p.clientRect?.() ?? null
              pick = (i) => items[i] && p.command(items[i])
              draw()
            },
            onUpdate(p) {
              items = p.items
              index = Math.min(index, Math.max(items.length - 1, 0))
              rect = p.clientRect?.() ?? null
              pick = (i) => items[i] && p.command(items[i])
              draw()
            },
            onKeyDown({ event }) {
              if (event.key === 'ArrowDown') index = (index + 1) % Math.max(items.length, 1)
              else if (event.key === 'ArrowUp') index = (index - 1 + items.length) % Math.max(items.length, 1)
              else if (event.key === 'Enter' || event.key === 'Tab') {
                if (!items.length) return false
                pick(index)
                return true
              } else return false // Escape lo cierra el propio plugin
              draw()
              return true
            },
            onExit() {
              root?.unmount()
              el?.remove()
              return false
            },
          }
        },
      }),
    ]
  },
})
