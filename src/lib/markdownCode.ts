// The panel's copy action is almost always aimed at the code, not the prose
// around it — pasting the raw markdown drops backticks, fence tags and LaTeX
// into the editor. Pull the fenced blocks out so copy yields runnable code.

const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})(.*)$/

/**
 * Source of every fenced code block in a markdown string, fences and info
 * strings stripped. An unterminated fence (mid-stream) still yields what has
 * arrived so far.
 *
 * Scanned line by line rather than with one regex: fences toggle, so a pattern
 * that matches "opener … closer" independently will happily read the *closing*
 * fence of one block as the opener of the next and copy the prose between them.
 */
export function extractCodeBlocks(markdown: string): string[] {
  const blocks: string[] = []
  let opener: string | null = null
  let body: string[] = []

  const flush = () => {
    const text = body.join("\n").replace(/\n+$/, "")
    if (text.trim()) blocks.push(text)
    body = []
  }

  for (const line of markdown.split("\n")) {
    const fence = FENCE_LINE.exec(line)
    if (opener === null) {
      if (fence) opener = fence[1]
      continue
    }
    // A closer is the same fence character, at least as long, and alone on its
    // line — anything else is content, including a fence inside the block.
    const closes =
      fence !== null &&
      fence[1][0] === opener[0] &&
      fence[1].length >= opener.length &&
      fence[2].trim() === ""
    if (closes) {
      flush()
      opener = null
      continue
    }
    body.push(line)
  }
  if (opener !== null) flush()

  return blocks
}

/**
 * What the copy button should put on the clipboard: the code alone when the
 * answer contains any, otherwise the answer itself (a prose reply still has to
 * be copyable). Multiple blocks are joined by a blank line.
 */
export function copyableText(markdown: string): string {
  const blocks = extractCodeBlocks(markdown)
  return blocks.length > 0 ? blocks.join("\n\n") : markdown
}
