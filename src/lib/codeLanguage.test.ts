import { describe, expect, it } from "vitest"
import { languageFromClassName, normalizeLanguage } from "./codeLanguage"

describe("normalizeLanguage", () => {
  it.each([
    ["js", "javascript"],
    ["JS", "javascript"],
    [" py ", "python"],
    ["c++", "cpp"],
    ["cs", "csharp"],
    ["postgresql", "sql"],
    ["sh", "bash"],
    ["python", "python"],
    ["sql", "sql"]
  ])("maps %s to %s", (raw, expected) => {
    expect(normalizeLanguage(raw)).toBe(expected)
  })

  it("returns null when there is no usable language", () => {
    expect(normalizeLanguage(null)).toBeNull()
    expect(normalizeLanguage(undefined)).toBeNull()
    expect(normalizeLanguage("")).toBeNull()
    expect(normalizeLanguage("   ")).toBeNull()
    expect(normalizeLanguage("text")).toBeNull()
    expect(normalizeLanguage("txt")).toBeNull()
  })

  it("passes unknown languages through rather than guessing", () => {
    expect(normalizeLanguage("brainfuck")).toBe("brainfuck")
  })
})

describe("languageFromClassName", () => {
  it("reads react-markdown's language class", () => {
    expect(languageFromClassName("language-py")).toBe("python")
    expect(languageFromClassName("language-c++")).toBe("cpp")
    expect(languageFromClassName("some-class language-sql")).toBe("sql")
  })

  it("returns null for inline code with no language class", () => {
    expect(languageFromClassName(undefined)).toBeNull()
    expect(languageFromClassName("")).toBeNull()
    expect(languageFromClassName("not-a-language")).toBeNull()
  })
})
