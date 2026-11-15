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

/**
 * Preparing (or re-preparing) a package by hand, for jobs the automatic run
 * skipped. `jobIds` is explicit: preparation is never a fire-and-forget "do
 * everything" button, and the response reports each job's outcome.
 */
export const prepareApplicationsSchema = z.object({
  jobIds: z.array(z.string().uuid()).min(1, 'Select at least one job').max(50),
});

/** Accept several packages at once, from the review queue. */
export const acceptPreparedApplicationsSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1, 'Select at least one application').max(50),
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
export type PrepareApplicationsInput = z.infer<typeof prepareApplicationsSchema>;
export type AcceptPreparedApplicationsInput = z.infer<typeof acceptPreparedApplicationsSchema>;
