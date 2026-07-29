// Markdown info strings are whatever the model felt like typing (```py, ```c++,
// ```JS). Prism only knows its own canonical names, so map the common aliases
// before handing a language over — an unknown name makes the highlighter fall
// back to unstyled text, which is worse than plain formatting.
const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  node: "javascript",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  py3: "python",
  python3: "python",
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  postgres: "sql",
  postgresql: "sql",
  mysql: "sql",
  sqlite: "sql",
  plaintext: "text",
  txt: "text"
}

/**
 * Canonical Prism language for a fence info string, or null when there is no
 * usable language (untagged fence, or a bare "text" block).
 */
export function normalizeLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  const mapped = ALIASES[key] ?? key
  return mapped === "text" ? null : mapped
}

/** Pull the language out of react-markdown's `language-xxx` class. */
export function languageFromClassName(className: string | undefined): string | null {
  const match = /language-([\w+#-]+)/.exec(className ?? "")
  return normalizeLanguage(match?.[1])
}
