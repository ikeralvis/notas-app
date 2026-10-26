export type Category = { id: number; name: string; color: string; icon: string; count: number; parent_id: number | null }
export type CatNode = Category & { children: CatNode[]; total: number }

/** Árbol de carpetas; `total` incluye las notas de las subcarpetas. */
export function buildTree(cats: Category[]): CatNode[] {
  const map = new Map<number, CatNode>(cats.map((c) => [c.id, { ...c, children: [], total: c.count }]))
  const roots: CatNode[] = []
  for (const n of map.values()) {
    const parent = n.parent_id ? map.get(n.parent_id) : undefined
    ;(parent ? parent.children : roots).push(n)
  }
  const sum = (n: CatNode): number => (n.total = n.count + n.children.reduce((a, c) => a + sum(c), 0))
  roots.forEach(sum)
  return roots
}

/** Lista plana en orden de árbol con su profundidad (para selects). */
export function flattenTree(cats: Category[], skip?: number): { cat: Category; depth: number }[] {
  const out: { cat: Category; depth: number }[] = []
  const walk = (nodes: CatNode[], depth: number) =>
    nodes.forEach((n) => {
      if (n.id === skip) return
      out.push({ cat: n, depth })
      walk(n.children, depth + 1)
    })
  walk(buildTree(cats), 0)
  return out
}

export function categoryPath(cats: Category[], id: number | null): string {
  const byId = new Map(cats.map((c) => [c.id, c]))
  const names: string[] = []
  for (let c = id ? byId.get(id) : undefined; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) names.unshift(c.name)
  return names.join(' / ')
}
export type Tag = { name: string; count: number }
export type Meta = {
  categories: Category[]
  tags: Tag[]
  total: number
  pinned: number
  uncategorized: number
  trash: number
}
export type NoteSummary = {
  id: number
  title: string
  preview: string
  category_id: number | null
  pinned: number
  updated_at: string
  tags: string | null
  file_count: number
  snippet?: string
}
export type FileInfo = { id: string; name: string; mime: string; size: number; created_at: string }
export type Note = {
  id: number
  title: string
  content: string
  category_id: number | null
  pinned: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  tags: string[]
  files: FileInfo[]
}
export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'category_id' | 'tags'>> & { pinned?: boolean }
export type Filter = { view: 'all' | 'pinned' | 'trash' | 'category' | 'tag'; category?: number | 'none'; tag?: string }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, init)
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText)
  return res.json()
}
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const api = {
  meta: () => req<Meta>('/meta'),
  notes: (q: string, f: Filter) => {
    const p = new URLSearchParams({ view: f.view === 'category' || f.view === 'tag' ? 'all' : f.view })
    if (q.trim()) p.set('q', q.trim())
    if (f.view === 'category' && f.category !== undefined) p.set('category', String(f.category))
    if (f.view === 'tag' && f.tag) p.set('tag', f.tag)
    return req<NoteSummary[]>('/notes?' + p)
  },
  note: (id: number) => req<Note>('/notes/' + id),
  createNote: (body: { title?: string; category_id?: number | null; tags?: string[] }) =>
    req<{ id: number }>('/notes', json('POST', body)),
  updateNote: (id: number, patch: NotePatch) => req('/notes/' + id, json('PATCH', patch)),
  deleteNote: (id: number, permanent = false) => req('/notes/' + id + (permanent ? '?permanent=1' : ''), json('DELETE')),
  restoreNote: (id: number) => req('/notes/' + id + '/restore', json('POST')),
  emptyTrash: () => req('/trash', json('DELETE')),
  upload: (id: number, files: File[]) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('file', f))
    return req<FileInfo[]>(`/notes/${id}/files`, { method: 'POST', body: fd })
  },
  deleteFile: (id: string) => req('/files/' + id, json('DELETE')),
  createCategory: (b: { name: string; color: string; icon: string; parent_id: number | null }) =>
    req('/categories', json('POST', b)),
  updateCategory: (id: number, b: { name: string; color: string; icon: string; parent_id: number | null }) =>
    req('/categories/' + id, json('PATCH', b)),
  importFiles: (files: File[], categoryId: number | null) => {
    const fd = new FormData()
    if (categoryId) fd.append('category_id', String(categoryId))
    for (const f of files) {
      fd.append('file', f)
      fd.append('path', (f as any).webkitRelativePath || f.name)
    }
    return req<{ notes: number }>('/import', { method: 'POST', body: fd })
  },
  deleteCategory: (id: number) => req('/categories/' + id, json('DELETE')),
  backup: () => req<{ name: string }>('/backups', json('POST')),
}

export function formatDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function formatSize(n: number) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
