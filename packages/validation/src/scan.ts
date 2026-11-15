import { z } from 'zod';
import { JOB_SOURCE_IDS } from '@job-hunter/shared-types';
import { trimmedString } from './primitives.js';

export const startScanSchema = z.object({
  /** Restrict to specific sources; defaults to the user's enabled sources. */
  sources: z.array(z.enum(JOB_SOURCE_IDS)).max(20).optional(),
  /** Safety valve: the engine also enforces its own per-source cap. */
  limitPerSource: z.number().int().min(1).max(100).default(25),
});

export const jobListQuerySchema = z.object({
  search: trimmedString(200).optional(),
  sources: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const list = Array.isArray(value) ? value : value.split(',');
      return list
        .map((item) => item.trim())
        .filter((item): item is (typeof JOB_SOURCE_IDS)[number] =>
          (JOB_SOURCE_IDS as readonly string[]).includes(item),
        );
    }),
  remote: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  countryCode: trimmedString(2).optional(),
  employmentType: trimmedString(30).optional(),
  seniority: trimmedString(30).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  saved: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  dismissed: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  sort: z.enum(['newest', 'score', 'company']).default('newest'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const jobFeedbackSchema = z.object({
  relevance: z.enum(['relevant', 'not_relevant']),
  reason: trimmedString(300).optional(),
});

export const jobStateSchema = z.object({
  saved: z.boolean().optional(),
  dismissed: z.boolean().optional(),
  feedback: z.enum(['relevant', 'not_relevant']).nullable().optional(),
});

export type JobListQuery = z.infer<typeof jobListQuerySchema>;
export type StartScanInput = z.infer<typeof startScanSchema>;
