// Upload rules shared by the upload routes and the uploader UI.

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Cost ceiling from the spec: material is capped at this many chunks across all files. */
export const MAX_CHUNKS = 200;

export type UploadKind = "material" | "sample";
export type DocumentKind = "pdf" | "text" | "markdown";

export const ACCEPTED_EXTENSIONS = ".pdf,.txt,.md,.markdown";
/** Also offered in the file picker so that choosing a deck shows the export instructions. */
export const PICKER_EXTENSIONS = `${ACCEPTED_EXTENSIONS},.pptx,.ppt,.key,.odp`;

export const SLIDES_EXPORT_HELP =
  "Slide decks can't be read directly yet. Export the deck to PDF and upload the PDF: " +
  "in PowerPoint on Windows, File → Export → Create PDF/XPS; in PowerPoint on Mac, File → Export…, then choose PDF as the file format; " +
  "in Keynote, File → Export To → PDF; in Google Slides, File → Download → PDF Document (.pdf).";

const BY_EXTENSION: Record<string, { kind: DocumentKind; contentType: string }> = {
  pdf: { kind: "pdf", contentType: "application/pdf" },
  txt: { kind: "text", contentType: "text/plain" },
  md: { kind: "markdown", contentType: "text/markdown" },
  markdown: { kind: "markdown", contentType: "text/markdown" },
};

const SLIDE_EXTENSIONS = new Set(["pptx", "ppt", "key", "odp"]);

export type UploadCheck =
  | { ok: true; kind: DocumentKind; contentType: string }
  | { ok: false; message: string };

export function classifyUpload(filename: string): UploadCheck {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  const known = BY_EXTENSION[extension];
  if (known) return { ok: true, ...known };
  if (SLIDE_EXTENSIONS.has(extension)) return { ok: false, message: SLIDES_EXPORT_HELP };
  return { ok: false, message: `${filename} isn't a supported file type. Upload a PDF, TXT or Markdown (.md) file.` };
}

/** A filesystem- and URL-safe version of an uploaded file's name, keeping its extension. */
export function safeFilename(filename: string): string {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "");
  const extension = cleaned.includes(".") ? cleaned.slice(cleaned.lastIndexOf(".")) : "";
  const stem = cleaned.slice(0, cleaned.length - extension.length).slice(0, 80) || "file";
  return `${stem}${extension.slice(0, 12)}`;
}

export function storagePathFor(userId: string, kind: UploadKind, id: string, filename: string): string {
  return `${userId}/${kind === "sample" ? "samples" : "materials"}/${id}/${safeFilename(filename)}`;
}

/** True when `path` was issued by storagePathFor for this user and kind. */
export function isOwnedStoragePath(path: string, userId: string, kind: UploadKind): boolean {
  const prefix = `${userId}/${kind === "sample" ? "samples" : "materials"}/`;
  return path.startsWith(prefix) && path.split("/").length === 4;
}
