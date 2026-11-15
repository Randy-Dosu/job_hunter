import { z } from 'zod';
import {
  EMPLOYMENT_TYPES,
  JOB_SOURCE_IDS,
  SENIORITY_LEVELS,
  WORKPLACE_TYPES,
} from '@job-hunter/shared-types';
import { safeText, timeZoneSchema, trimmedString } from './primitives.js';

const keyword = safeText(80).pipe(z.string().min(1).max(80));

export const jobPreferencesSchema = z.object({
  targetTitles: z.array(keyword).max(20).default([]),
  targetKeywords: z.array(keyword).max(50).default([]),
  excludedKeywords: z.array(keyword).max(50).default([]),
  excludedCompanies: z.array(keyword).max(50).default([]),
  locations: z.array(trimmedString(120)).max(30).default([]),
  countryCodes: z
    .array(z.string().trim().length(2, 'Use a 2-letter country code').toUpperCase())
    .max(250)
    .default([]),
  remoteOnly: z.boolean().default(false),
  workplaceTypes: z.array(z.enum(WORKPLACE_TYPES)).max(4).default([]),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(7).default([]),
  seniorityLevels: z.array(z.enum(SENIORITY_LEVELS)).max(10).default([]),
  minSalary: z.number().int().min(0).max(100_000_000).optional(),
  salaryCurrency: z.string().trim().length(3).toUpperCase().optional(),
  enabledSources: z.array(z.enum(JOB_SOURCE_IDS)).max(20).default([]),
  timeZone: timeZoneSchema.default('UTC'),
  scanHourLocal: z.number().int().min(0).max(23).default(8),
});

export const scheduleSchema = z.object({
  enabled: z.boolean(),
  timeZone: timeZoneSchema,
  scanHourLocal: z.number().int().min(0).max(23),
});

export type JobPreferencesInput = z.infer<typeof jobPreferencesSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
