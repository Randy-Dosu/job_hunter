import { z } from 'zod';
import { EXPORT_FORMATS } from '@job-hunter/shared-types';
import { safeText, trimmedString } from './primitives.js';

export const generateDocumentSchema = z.object({
  kind: z.enum(['resume', 'cover_letter']),
  /** Use verified facts only; enforced server-side regardless of this flag. */
  tone: z.enum(['professional', 'concise', 'warm']).default('professional'),
});

export const editDocumentSchema = z.object({
  content: z.object({
    headline: safeText(200),
    summary: safeText(3000).optional(),
    sections: z
      .array(
        z.object({
          heading: safeText(120),
          bullets: z.array(safeText(600)).max(30),
          evidenceIds: z.array(z.string()).max(60).default([]),
        }),
      )
      .max(20),
  }),
});

export const approveDocumentSchema = z.object({
  acknowledgeWarnings: z.boolean().default(false),
});

export const exportDocumentSchema = z.object({
  format: z.enum(EXPORT_FORMATS),
});

export const documentIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const documentListQuerySchema = z.object({
  jobId: z.string().uuid().optional(),
  kind: z.enum(['resume', 'cover_letter']).optional(),
});

export const answerUnknownSchema = z.object({
  fieldLabel: trimmedString(200).min(1),
  answer: safeText(500),
  saveToAnswerBank: z.boolean().default(false),
});

export type GenerateDocumentInput = z.infer<typeof generateDocumentSchema>;
export type EditDocumentInput = z.infer<typeof editDocumentSchema>;
