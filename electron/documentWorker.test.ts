import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractDocument } from "./documentWorker";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((file) => fs.rm(file, { recursive: true, force: true })),
  );
});
async function file(name: string, content: Buffer | string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "quip-doc-"));
  temporary.push(directory);
  const target = path.join(directory, name);
  await fs.writeFile(target, content);
  return target;
}
// A small real PDF with exact xref offsets; no external fixture generator is required.
function pdf(pages: number, readable = true) {
  const content = readable
    ? "BT /F1 12 Tf 40 200 Td (Launch deadline is Friday.) Tj ET"
    : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...Array.from(
      { length: pages },
      () =>
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>",
    ),
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return result;
}
describe("document ingestion", () => {
  it("preserves readable PDF evidence and page numbers", async () => {
    const sections = await extractDocument(await file("brief.pdf", pdf(2)));
    expect(sections).toEqual([
      { page: 1, text: "Launch deadline is Friday." },
      { page: 2, text: "Launch deadline is Friday." },
    ]);
  });
  it("rejects unreadable and over-limit PDFs instead of returning partial evidence", async () => {
    await expect(
      extractDocument(await file("scanned.pdf", pdf(1, false))),
    ).rejects.toThrow(/scanned or unreadable/);
    await expect(
      extractDocument(await file("long.pdf", pdf(101))),
    ).rejects.toThrow(/100 pages/);
  });
  it("extracts DOCX paragraph text without rendering its content", async () => {
    expect(
      await extractDocument(path.resolve("electron/fixtures/brief.docx")),
    ).toEqual([
      { text: "Launch deadline is Friday.\n\nThe owner is the project team." },
    ]);
  });
  it("accepts UTF-8 Markdown and rejects binary, oversized, and unsupported files", async () => {
    expect(
      await extractDocument(await file("brief.md", "# Café\nFriday deadline")),
    ).toEqual([{ text: "# Café\nFriday deadline" }]);
    await expect(
      extractDocument(await file("binary.txt", Buffer.from([0, 1, 2]))),
    ).rejects.toThrow(/not a text document/);
    await expect(
      extractDocument(
        await file("large.txt", Buffer.alloc(20 * 1024 * 1024 + 1, 65)),
      ),
    ).rejects.toThrow(/20 MB/);
    await expect(
      extractDocument(await file("sheet.csv", "a,b")),
    ).rejects.toThrow(/Supported documents/);
  });
});
