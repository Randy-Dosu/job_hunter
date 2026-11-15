import { z } from 'zod';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_RESUME_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const;
export type AllowedResumeMime = (typeof ALLOWED_RESUME_MIME_TYPES)[number];

/** Extension allowlist used in addition to MIME sniffing (defence in depth). */
export const ALLOWED_RESUME_EXTENSIONS = ['.pdf', '.docx', '.txt'] as const;

export const resumeUploadMetaSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, 'File name is required')
    .max(200, 'File name is too long')
    .refine(
      (name) => ALLOWED_RESUME_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)),
      `Only ${ALLOWED_RESUME_EXTENSIONS.join(', ')} files are supported`,
    )
    .refine((name) => !name.includes('\u0000'), 'Invalid file name'),
  mimeType: z.enum(ALLOWED_RESUME_MIME_TYPES, { error: 'Unsupported file type' }),
  sizeBytes: z
    .number()
    .int()
    .min(1, 'File is empty')
    .max(MAX_RESUME_BYTES, 'File is larger than 5 MB'),
});

export const updateFactFromResumeSchema = z.object({
  facts: z.array(
    z.object({
      kind: z.string(),
      label: z.string().trim().min(1).max(200),
      verified: z.boolean(),
    }),
  ),
});

export type ResumeUploadMeta = z.infer<typeof resumeUploadMetaSchema>;
