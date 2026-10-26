import { marked } from 'marked'

/** Markdown -> HTML que TipTap entiende (incluye las tareas `- [ ]`). */
export function mdToHtml(md: string, breaks = false): string {
  const html = marked.parse(md, { gfm: true, breaks }) as string
  return html
    .replace(
      /<li>(\s*<p>)?\s*<input (checked="" )?disabled="" type="checkbox">\s*/g,
      (_, p, checked) => `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}">${p ?? ''}`,
    )
    .replace(/<ul>(\s*<li data-type="taskItem")/g, '<ul data-type="taskList">$1')
}

/** ¿Este texto pegado parece Markdown? (títulos, listas, citas, código, tablas, negrita, enlaces…) */
export function looksLikeMarkdown(text: string): boolean {
  const block = /^(\s{0,3}#{1,6}\s+\S|\s*[-*+]\s+\S|\s*\d+[.)]\s+\S|\s*>\s?\S|\s*```|\s*---+\s*$|\s*\|.+\|\s*$)/m
  const inline = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/
  return block.test(text) || inline.test(text)
}
