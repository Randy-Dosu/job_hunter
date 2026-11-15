import { z } from 'zod';
import { APPLICATION_STATUSES } from '@job-hunter/shared-types';
import { safeText, trimmedString } from './primitives.js';

export const createApplicationSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(APPLICATION_STATUSES).default('saved'),
  resumeDocumentId: z.string().uuid().optional(),
  coverLetterDocumentId: z.string().uuid().optional(),
  notes: safeText(4000).optional(),
  nextActionAt: z.string().datetime({ offset: true }).optional(),
});

export const updateApplicationSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  notes: safeText(4000).optional(),
  nextActionAt: z.string().datetime({ offset: true }).nullable().optional(),
  resumeDocumentId: z.string().uuid().nullable().optional(),
  coverLetterDocumentId: z.string().uuid().nullable().optional(),
});

export const addApplicationNoteSchema = z.object({
  message: trimmedString(2000).min(1, 'Note cannot be empty'),
});

export const applicationListQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
