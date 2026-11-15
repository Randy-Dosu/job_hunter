/**
 * Text extraction for supported resume formats.
 *
 * - TXT  : decoded directly (bounded).
 * - PDF  : parsed with pdf-parse when available; otherwise we fail safely with a
 *          clear message instead of returning garbage.
 * - DOCX : parsed with mammoth (raw text) when available; DOCX is a ZIP so we
 *          also run structural checks before handing it to a parser.
 *
 * Optional dependencies are loaded dynamically so the rest of the app never
 * depends on a heavy parser at import time.
 */

import { fileTypeOf } from './detect.js';

export interface ExtractionResult {
  text: string;
  /** Pages for PDFs, paragraphs for DOCX; undefined when not applicable. */
  pageCount?: number | undefined;
  warnings: string[];
}

const MAX_TEXT_CHARS = 200_000;

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}

export class CorruptFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptFileError';
  }
}

/**
 * Optional-dependency loader. Uses a computed specifier so TypeScript does not
 * require the packages to be installed, and so the runtime can degrade cleanly
 * on hosts where the parser packages are unavailable.
 */
async function importOptional(specifier: string): Promise<unknown> {
  return import(specifier);
}

export async function extractResumeText(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<ExtractionResult> {
  const type = fileTypeOf(input);
  switch (type) {
    case 'txt':
      return extractTxt(input.buffer);
    case 'pdf':
      return extractPdf(input.buffer);
    case 'docx':
      return extractDocx(input.buffer);
    default:
      throw new UnsupportedFileError('Only PDF, DOCX and TXT resumes are supported');
  }
}

function extractTxt(buffer: Buffer): ExtractionResult {
  const decoded = buffer.toString('utf8');
  if (decoded.includes('\u0000')) {
    throw new CorruptFileError('The file does not look like plain text');
  }
  const text = normaliseWhitespace(decoded);
  if (text.trim().length < 30) {
    throw new CorruptFileError('The file contains too little text to be a resume');
  }
  return { text: text.slice(0, MAX_TEXT_CHARS), warnings: [] };
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new CorruptFileError('The file is not a valid PDF (missing PDF header)');
  }
  let pdfParse: (data: Buffer) => Promise<{ text: string; numpages?: number }>;
  try {
    const mod = (await importOptional('pdf-parse')) as unknown as {
      default?: (data: Buffer) => Promise<{ text: string; numpages?: number }>;
      pdf?: (data: Buffer) => Promise<{ text: string; numpages?: number }>;
    };
    const candidate = mod.default ?? mod.pdf;
    if (typeof candidate !== 'function') throw new Error('pdf-parse did not export a parser');
    pdfParse = candidate;
  } catch {
    throw new UnsupportedFileError(
      'PDF parsing is unavailable on this server. Upload a DOCX or TXT resume, or install pdf-parse.',
    );
  }

  try {
    const result = await pdfParse(buffer);
    const text = normaliseWhitespace(result.text ?? '');
    const warnings: string[] = [];
    if (text.trim().length < 30) {
      warnings.push(
        'Very little text was found. The PDF may be a scan; you can paste or edit your details manually.',
      );
    }
    return {
      text: text.slice(0, MAX_TEXT_CHARS),
      ...(typeof result.numpages === 'number' ? { pageCount: result.numpages } : {}),
      warnings,
    };
  } catch (error) {
    throw new CorruptFileError(
      `The PDF could not be read (${error instanceof Error ? error.message : 'unknown error'})`,
    );
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  // ZIP magic: "PK\x03\x04". Reject anything else before parsing.
  if (buffer.subarray(0, 4).toString('hex') !== '504b0304') {
    throw new CorruptFileError('The file is not a valid DOCX (missing ZIP header)');
  }
  let mammoth: { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };
  try {
    const mod = (await importOptional('mammoth')) as unknown as {
      default?: { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };
      extractRawText?: (input: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const candidate = mod.default ?? mod;
    if (typeof candidate?.extractRawText !== 'function') throw new Error('mammoth unavailable');
    mammoth = candidate as typeof mammoth;
  } catch {
    throw new UnsupportedFileError(
      'DOCX parsing is unavailable on this server. Upload a PDF or TXT resume, or install mammoth.',
    );
  }

  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = normaliseWhitespace(result.value ?? '');
    if (text.trim().length < 30) {
      throw new CorruptFileError('The document contains too little text to be a resume');
    }
    return { text: text.slice(0, MAX_TEXT_CHARS), warnings: [] };
  } catch (error) {
    if (error instanceof CorruptFileError) throw error;
    throw new CorruptFileError(
      `The DOCX file could not be read (${error instanceof Error ? error.message : 'unknown error'})`,
    );
  }
}

export function normaliseWhitespace(value: string): string {
  return (
    value
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      // Remove hyphenation at line breaks: "develop-\nment" -> "development"
      .replace(/(\w)-\n(\w)/g, '$1$2')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
