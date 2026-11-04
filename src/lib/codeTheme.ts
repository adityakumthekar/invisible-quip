import type { CSSProperties } from "react"

/**
 * Prism token colours for answer code blocks, read from tokens.css so code sits
 * in the overlay's own palette instead of a borrowed editor theme. The block's
 * surface is drawn by `.chat-code` in index.css; this only colours glyphs.
 */
const base: CSSProperties = {
  color: "var(--code-ink)",
  background: "none",
  fontFamily: "var(--font-mono)",
  textShadow: "none",
  whiteSpace: "pre",
  wordSpacing: "normal",
  wordBreak: "normal",
  tabSize: 2
}

export const overlayCodeTheme: Record<string, CSSProperties> = {
  'code[class*="language-"]': base,
  'pre[class*="language-"]': { ...base, overflow: "auto" },
  comment: { color: "var(--code-comment)", fontStyle: "italic" },
  prolog: { color: "var(--code-comment)" },
  doctype: { color: "var(--code-comment)" },
  cdata: { color: "var(--code-comment)" },
  punctuation: { color: "var(--code-punctuation)" },
  operator: { color: "var(--code-punctuation)" },
  keyword: { color: "var(--code-keyword)" },
  atrule: { color: "var(--code-keyword)" },
  important: { color: "var(--code-keyword)" },
  builtin: { color: "var(--code-keyword)" },
  "class-name": { color: "var(--code-function)" },
  function: { color: "var(--code-function)" },
  tag: { color: "var(--code-keyword)" },
  selector: { color: "var(--code-string)" },
  string: { color: "var(--code-string)" },
  char: { color: "var(--code-string)" },
  "attr-value": { color: "var(--code-string)" },
  regex: { color: "var(--code-string)" },
  url: { color: "var(--code-string)" },
  number: { color: "var(--code-number)" },
  boolean: { color: "var(--code-number)" },
  constant: { color: "var(--code-number)" },
  symbol: { color: "var(--code-number)" },
  "attr-name": { color: "var(--code-function)" },
  property: { color: "var(--code-function)" },
  variable: { color: "var(--code-ink)" },
  deleted: { color: "var(--glass-danger)" },
  inserted: { color: "var(--code-string)" },
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" }
}
