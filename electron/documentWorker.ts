import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mammoth from "mammoth";
import type { ExtractedSection } from "./workspaceContract";
const MAX_BYTES = 20 * 1024 * 1024;
export async function extractDocument(
  filePath: string,
): Promise<ExtractedSection[]> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_BYTES || !stat.size)
    throw new Error("Choose a non-empty file smaller than 20 MB.");
  const ext = path.extname(filePath).toLowerCase(),
    bytes = await fs.readFile(filePath);
  let sections: ExtractedSection[] = [];
  if (ext === ".pdf") {
    // esbuild preserves this native import in the isolated CommonJS worker.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Electron utility processes are not recognized as Node by PDF.js. Resolve
    // its worker explicitly; extraction still runs inside this isolated process.
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
    ).href;
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    try {
      if (pdf.numPages > 100)
        throw new Error(
          "PDFs may contain up to 100 pages. Split this document first.",
        );
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        sections.push({
          page,
          text: content.items
            .map((item: any) => item.str + (item.hasEOL ? "\n" : " "))
            .join("")
            .trim(),
        });
      }
      if (sections.some((section) => section.text.length < 10))
        throw new Error(
          "This PDF contains scanned or unreadable pages. Import a text-based PDF so answers include the full document.",
        );
    } finally {
      await pdf.destroy();
    }
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer: bytes });
    sections = [{ text: result.value.trim() }];
  } else if ([".txt", ".md"].includes(ext)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0"))
      throw new Error("This file is not a text document.");
    sections = [{ text: text.trim() }];
  } else throw new Error("Supported documents: PDF, DOCX, TXT and Markdown.");
  if (!sections.some((section) => section.text.trim()))
    throw new Error("This document contains no readable text.");
  if (sections.reduce((sum, section) => sum + section.text.length, 0) > 1000000)
    throw new Error(
      "This document contains too much text. Split it into smaller documents.",
    );
  return sections;
}
// The parent only starts this utility process with a path returned by a native file picker.
if (process.parentPort)
  process.parentPort.on("message", async (event: any) => {
    try {
      process.parentPort!.postMessage({
        sections: await extractDocument(event.data.path),
      });
    } catch (error) {
      process.parentPort!.postMessage({
        error:
          (error as Error).name === "PasswordException"
            ? "Encrypted PDFs are unsupported. Import an unlocked copy."
            : (error as Error).message,
      });
    }
  });
