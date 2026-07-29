import { describe, expect, it } from "vitest"
import { copyableText, extractCodeBlocks } from "./markdownCode"

const ANSWER = [
  "Find the two largest elements in `nums` in a single pass.",
  "",
  "```python",
  "class Solution:",
  "    def maxProduct(self, nums: List[int]) -> int:",
  "        return (max1 - 1) * (max2 - 1)",
  "```",
  "",
  "Time complexity: $\\mathcal{O}(n)$."
].join("\n")

describe("extractCodeBlocks", () => {
  it("returns the block body without the fence, tag, prose or LaTeX", () => {
    expect(extractCodeBlocks(ANSWER)).toEqual([
      [
        "class Solution:",
        "    def maxProduct(self, nums: List[int]) -> int:",
        "        return (max1 - 1) * (max2 - 1)"
      ].join("\n")
    ])
  })

  it("returns every block in order", () => {
    const md = "a\n\n```sql\nSELECT 1;\n```\n\nb\n\n```js\nconst x = 1\n```\n"
    expect(extractCodeBlocks(md)).toEqual(["SELECT 1;", "const x = 1"])
  })

  it("handles an untagged fence", () => {
    expect(extractCodeBlocks("```\nplain\n```")).toEqual(["plain"])
  })

  it("keeps what has arrived when the fence is still streaming", () => {
    expect(extractCodeBlocks("```python\nmax1 = 0\nfor n in nums:")).toEqual([
      "max1 = 0\nfor n in nums:"
    ])
  })

  it("ignores inline code and empty fences", () => {
    expect(extractCodeBlocks("use `max1` here")).toEqual([])
    expect(extractCodeBlocks("```python\n```")).toEqual([])
  })
})

describe("copyableText", () => {
  it("copies the code alone when the answer has code", () => {
    expect(copyableText(ANSWER)).not.toMatch(/Time complexity/)
    expect(copyableText(ANSWER)).toMatch(/^class Solution:/)
  })

  it("joins multiple blocks with a blank line", () => {
    const md = "```sql\nSELECT 1;\n```\ntext\n```sql\nSELECT 2;\n```"
    expect(copyableText(md)).toBe("SELECT 1;\n\nSELECT 2;")
  })

  it("falls back to the whole answer when there is no code", () => {
    expect(copyableText("just prose")).toBe("just prose")
  })
})
