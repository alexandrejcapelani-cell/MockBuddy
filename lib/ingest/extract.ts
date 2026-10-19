import { extractText, getDocumentProxy } from "unpdf";
import type { DocumentKind } from "../files.ts";

/** A problem with the uploaded document itself, worded for the person who uploaded it. */
export class DocumentError extends Error {
  override name = "DocumentError";
}

export interface ExtractedDocument {
  /** One entry per PDF page; a single entry for text and Markdown files. */
  pages: string[];
  /** Null for text and Markdown files, which have no pages. */
  pageCount: number | null;
}

/** Fewer visible characters per page than this means there is no real text layer. */
const MIN_CHARS_PER_PAGE = 40;

export async function extractDocument(bytes: Uint8Array, kind: DocumentKind): Promise<ExtractedDocument> {
  if (bytes.byteLength === 0) throw new DocumentError("The file is empty.");
  return kind === "pdf" ? extractPdf(bytes) : extractPlainText(bytes);
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  let result: { totalPages: number; text: string[] };
  try {
    // pdf.js may take ownership of the buffer it is given, so hand it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    result = await extractText(pdf, { mergePages: false });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    if (name === "PasswordException") {
      throw new DocumentError("This PDF is password-protected. Remove the password and upload it again.");
    }
    if (name === "InvalidPDFException" || /invalid pdf/i.test(message)) {
      throw new DocumentError("This file isn't a readable PDF. Re-export it from the original app and upload it again.");
    }
    throw error;
  }

  const visible = result.text.reduce((sum, page) => sum + page.replace(/\s/g, "").length, 0);
  if (result.totalPages > 0 && visible / result.totalPages < MIN_CHARS_PER_PAGE) {
    throw new DocumentError(
      "This PDF has almost no selectable text, so it looks scanned or made of images. " +
        "Export it from the original slides or document instead, or run it through OCR first.",
    );
  }
  return { pages: result.text, pageCount: result.totalPages };
}

function extractPlainText(bytes: Uint8Array): ExtractedDocument {
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  if (text.trim() === "") throw new DocumentError("The file has no text in it.");
  return { pages: [text], pageCount: null };
}
