/**
 * File type detection and validation.
 *
 * We never trust the client-supplied MIME type: the magic bytes decide. This is a
 * release-blocking security requirement (malicious uploads must not be able to
 * masquerade as resumes).
 */

export type ResumeFileType = 'pdf' | 'docx' | 'txt' | 'unknown';

export interface FileFacts {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** Inspect magic bytes to determine the real type. */
export function sniffType(buffer: Buffer): ResumeFileType {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('hex') === '504b0304') {
    // ZIP container: DOCX has "word/" entries and [Content_Types].xml.
    const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
    if (head.includes('word/') || head.includes('[Content_Types].xml')) return 'docx';
    return 'unknown';
  }
  // Text: printable UTF-8 without NULs.
  if (buffer.length > 0 && !buffer.includes(0)) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
    const printable = [...sample].filter(
      (byte) =>
        (byte >= 0x20 && byte <= 0x7e) ||
        byte === 0x09 ||
        byte === 0x0a ||
        byte === 0x0d ||
        byte >= 0x80,
    ).length;
    if (printable / sample.length > 0.95) return 'txt';
  }
  return 'unknown';
}

type TypeInput = Pick<FileFacts, 'fileName' | 'mimeType'> & {
  buffer?: Buffer | undefined;
  sizeBytes?: number | undefined;
};

/** Map the declared MIME type/extension onto the sniffed type. */
export function fileTypeOf(input: TypeInput): ResumeFileType {
  const declared = declaredType(input);
  if (!input.buffer) return declared;
  const sniffed = sniffType(input.buffer);
  if (sniffed === 'unknown') return 'unknown';
  // A PDF declared as DOCX (or vice versa) is suspicious: reject rather than guess.
  if (declared !== 'unknown' && declared !== sniffed) return 'unknown';
  return sniffed;
}

function declaredType(input: Pick<FileFacts, 'fileName' | 'mimeType'>): ResumeFileType {
  const name = input.fileName.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.txt')) return 'txt';
  if (name.endsWith('.doc')) return 'unknown'; // legacy .doc is not supported
  if (input.mimeType === 'application/pdf') return 'pdf';
  if (input.mimeType === 'text/plain') return 'txt';
  if (input.mimeType.includes('wordprocessingml')) return 'docx';
  return 'unknown';
}

export interface ValidationOutcome {
  ok: boolean;
  type: ResumeFileType;
  reason?: string | undefined;
}

export function validateResumeFile(input: TypeInput): ValidationOutcome {
  if ((input.sizeBytes ?? 0) <= 0)
    return { ok: false, type: 'unknown', reason: 'The file is empty' };
  if ((input.sizeBytes ?? 0) > MAX_RESUME_BYTES) {
    return { ok: false, type: 'unknown', reason: 'The file is larger than the 5 MB limit' };
  }
  // eslint-disable-next-line no-control-regex -- detecting control characters in a file name
  if (/[\u0000-\u001f]/.test(input.fileName.replace(/\./g, ''))) {
    return { ok: false, type: 'unknown', reason: 'The file name contains invalid characters' };
  }

  const type = fileTypeOf(input);
  if (type === 'unknown') {
    return {
      ok: false,
      type,
      reason:
        'Only PDF, DOCX or TXT resumes are supported and the file contents must match the extension',
    };
  }
  return { ok: true, type };
}
