import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BubbleMenu, EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import { SlashCommand } from './Slash'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { looksLikeMarkdown, mdToHtml } from './markdown'
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Code, CodeSquare, Highlighter, Italic, Link2, List, ListChecks,
  ListOrdered, Minus, Palette, Quote, Redo2, Strikethrough, Underline as UnderlineIcon, Undo2,
} from 'lucide-react'

const TEXT_COLORS = ['#e03131', '#e8590c', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#868e96']
const HIGHLIGHTS = ['#fff3bf', '#d3f9d8', '#d0ebff', '#e5dbff', '#ffd8e4', '#ffe8cc']

/** Notas antiguas guardadas como Markdown se convierten a HTML al abrirlas. */
const toHtml = (c: string) => (!c.trim() || c.trimStart().startsWith('<') ? c : mdToHtml(c, true))

type Props = {
  initial: string
  editable: boolean
  onChange: (html: string) => void
  /** Sube una imagen como adjunto de la nota y devuelve su URL. */
  onImage: (file: File) => Promise<string>
  editorRef?: (e: Editor | null) => void
}

export async function insertImages(editor: Editor, files: File[], upload: (f: File) => Promise<string>) {
  for (const f of files.filter((f) => f.type.startsWith('image/'))) {
    const src = await upload(f)
    editor.chain().focus().setImage({ src, alt: f.name }).run()
  }
}

export function RichText({ initial, editable, onChange, onImage, editorRef }: Props) {
  const upload = useRef(onImage)
  upload.current = onImage
  const pickImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => editorInst.current && insertImages(editorInst.current, [...(input.files ?? [])], upload.current)
    input.click()
  }
  const editorInst = useRef<Editor | null>(null)
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Escribe algo, o usa  #  -  [ ]  para dar formato…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image,
      Table,
      TableRow,
      TableHeader,
      TableCell,
      SlashCommand.configure({ pickImage: () => pickImage() }),
    ],
    editorProps: {
      handlePaste(view, event) {
        // Markdown pegado como texto (p. ej. copiado de un .md o de una IA) -> se renderiza como bloques.
        const cd = event.clipboardData
        const text = cd?.getData('text/plain') ?? ''
        const html = cd?.getData('text/html') ?? ''
        const structured = /<(h[1-6]|ul|ol|li|strong|b|em|table|blockquote|pre|img)[s>]/i.test(html)
        if (cd && text && looksLikeMarkdown(text) && !editorInst.current?.isActive('codeBlock') && (!html || cd.types.includes('vscode-editor-data') || !structured)) {
          event.preventDefault()
          editorInst.current?.commands.insertContent(mdToHtml(text))
          return true
        }
        const imgs = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (!imgs.length || !editorInst.current) return false
        event.preventDefault()
        insertImages(editorInst.current, imgs, upload.current)
        return true
      },
    },
    content: toHtml(initial),
    editable,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])
  useEffect(() => {
    editorInst.current = editor
    editorRef?.(editor)
    return () => editorRef?.(null)
  }, [editor])

  if (!editor) return null
  return (
    <>
      {editable && <Toolbar editor={editor} />}
      {editable && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100, placement: 'top' }} className="bubble">
          <Marks editor={editor} />
        </BubbleMenu>
      )}
      <EditorContent editor={editor} className="rt" />
    </>
  )
}

function Btn({ on, title, onClick, children }: { on?: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={'tb' + (on ? ' on' : '')}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()} // no robar el foco ni la selección al editor
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function setLink(editor: Editor) {
  const prev = editor.getAttributes('link').href as string | undefined
  const url = window.prompt('Dirección del enlace (vacío para quitarlo)', prev ?? 'https://')
  if (url === null) return
  if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run()
  else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
}

function Swatches({ colors, onPick, onClear }: { colors: string[]; onPick: (c: string) => void; onClear: () => void }) {
  return (
    <div className="pop" onMouseDown={(e) => e.preventDefault()}>
      {colors.map((c) => (
        <button key={c} type="button" className="sw" style={{ background: c }} onClick={() => onPick(c)} aria-label={c} />
      ))}
      <button type="button" className="sw none" onClick={onClear} title="Quitar">
        ×
      </button>
    </div>
  )
}

function Marks({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState<'color' | 'hl' | null>(null)
  return (
    <div className="marks">
      <Btn title="Negrita (Ctrl+B)" on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={15} />
      </Btn>
      <Btn title="Cursiva (Ctrl+I)" on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={15} />
      </Btn>
      <Btn title="Subrayado (Ctrl+U)" on={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon size={15} />
      </Btn>
      <Btn title="Tachado" on={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={15} />
      </Btn>
      <Btn title="Código" on={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code size={15} />
      </Btn>
      <Btn title="Enlace" on={editor.isActive('link')} onClick={() => setLink(editor)}>
        <Link2 size={15} />
      </Btn>
      <span className="rel">
        <Btn title="Color de texto" on={open === 'color'} onClick={() => setOpen(open === 'color' ? null : 'color')}>
          <Palette size={15} />
        </Btn>
        {open === 'color' && (
          <Swatches
            colors={TEXT_COLORS}
            onPick={(c) => (editor.chain().focus().setColor(c).run(), setOpen(null))}
            onClear={() => (editor.chain().focus().unsetColor().run(), setOpen(null))}
          />
        )}
      </span>
      <span className="rel">
        <Btn title="Resaltar" on={open === 'hl'} onClick={() => setOpen(open === 'hl' ? null : 'hl')}>
          <Highlighter size={15} />
        </Btn>
        {open === 'hl' && (
          <Swatches
            colors={HIGHLIGHTS}
            onPick={(c) => (editor.chain().focus().setHighlight({ color: c }).run(), setOpen(null))}
            onClear={() => (editor.chain().focus().unsetHighlight().run(), setOpen(null))}
          />
        )}
      </span>
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const level = [1, 2, 3].find((l) => editor.isActive('heading', { level: l }))
  const style = level ? 'h' + level : 'p'

  return (
    <div className="toolbar">
      <select
        className="block-select"
        value={style}
        onChange={(e) => {
          const v = e.target.value
          const chain = editor.chain().focus()
          if (v === 'p') chain.setParagraph().run()
          else chain.toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run()
        }}
        aria-label="Estilo de texto"
      >
        <option value="p">Texto</option>
        <option value="h1">Título 1</option>
        <option value="h2">Título 2</option>
        <option value="h3">Título 3</option>
      </select>
      <i className="sep" />
      <Marks editor={editor} />
      <i className="sep" />
      <Btn title="Lista" on={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={16} />
      </Btn>
      <Btn title="Lista numerada" on={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={16} />
      </Btn>
      <Btn title="Lista de tareas" on={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks size={16} />
      </Btn>
      <i className="sep" />
      <Btn title="Cita" on={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={16} />
      </Btn>
      <Btn title="Bloque de código" on={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <CodeSquare size={16} />
      </Btn>
      <Btn title="Línea separadora" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus size={16} />
      </Btn>
      <i className="sep" />
      <Btn title="Alinear a la izquierda" on={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        <AlignLeft size={16} />
      </Btn>
      <Btn title="Centrar" on={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        <AlignCenter size={16} />
      </Btn>
      <Btn title="Alinear a la derecha" on={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        <AlignRight size={16} />
      </Btn>
      <span style={{ flex: 1 }} />
      <Btn title="Deshacer" onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={16} />
      </Btn>
      <Btn title="Rehacer" onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={16} />
      </Btn>
    </div>
  )
}
