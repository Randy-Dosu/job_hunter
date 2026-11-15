import { z } from 'zod';
import { FACT_KINDS } from '@job-hunter/shared-types';
import { isoDateSchema, safeText, trimmedString, urlSchema } from './primitives.js';

const bullet = safeText(600);
const shortText = safeText(200);

export const contactSchema = z.object({
  fullName: shortText.pipe(z.string().min(1, 'Your name is required')),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: trimmedString(40).optional(),
  location: trimmedString(120).optional(),
  website: urlSchema.optional().or(z.literal('')),
  linkedin: urlSchema.optional().or(z.literal('')),
  github: urlSchema.optional().or(z.literal('')),
});

export const experienceSchema = z
  .object({
    company: shortText.pipe(z.string().min(1, 'Company is required')),
    title: shortText.pipe(z.string().min(1, 'Job title is required')),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    current: z.boolean().optional(),
    location: trimmedString(120).optional(),
    bullets: z.array(bullet).max(20).default([]),
    keywords: z.array(trimmedString(60)).max(40).default([]),
  })
  .refine((value) => value.current !== true || !value.endDate, {
    message: 'A current role cannot have an end date',
    path: ['endDate'],
  });

export const educationSchema = z.object({
  institution: shortText.pipe(z.string().min(1, 'Institution is required')),
  degree: trimmedString(120).optional(),
  field: trimmedString(120).optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  grade: trimmedString(40).optional(),
});

export const projectSchema = z.object({
  name: shortText.pipe(z.string().min(1, 'Project name is required')),
  description: safeText(1200),
  url: urlSchema.optional().or(z.literal('')),
  keywords: z.array(trimmedString(60)).max(40).default([]),
});

export const certificationSchema = z.object({
  name: shortText.pipe(z.string().min(1, 'Certification name is required')),
  issuer: trimmedString(120).optional(),
  issuedAt: isoDateSchema.optional(),
  expiresAt: isoDateSchema.optional(),
  credentialUrl: urlSchema.optional().or(z.literal('')),
});

export const profileContentSchema = z.object({
  contact: contactSchema,
  headline: safeText(160).optional(),
  summary: safeText(2000).optional(),
  skills: z
    .array(trimmedString(60).pipe(z.string().min(1)))
    .max(200)
    .default([]),
  experience: z.array(experienceSchema).max(50).default([]),
  education: z.array(educationSchema).max(20).default([]),
  projects: z.array(projectSchema).max(50).default([]),
  certifications: z.array(certificationSchema).max(50).default([]),
  languages: z.array(trimmedString(60)).max(30).default([]),
});

export const updateProfileSchema = z.object({
  content: profileContentSchema,
  headline: safeText(160).optional(),
  summary: safeText(2000).optional(),
});

export const factSchema = z.object({
  kind: z.enum(FACT_KINDS),
  label: shortText.pipe(z.string().min(1, 'Label is required')),
  detail: safeText(1000).optional(),
  keywords: z.array(trimmedString(60)).max(40).default([]),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  organisation: trimmedString(160).optional(),
  role: trimmedString(160).optional(),
  evidenceRef: trimmedString(300).optional(),
});

export const createFactSchema = factSchema;

export const updateFactSchema = factSchema.partial().extend({
  verified: z.boolean().optional(),
});

export const verifyFactsSchema = z.object({
  factIds: z.array(z.string().uuid()).min(1, 'Select at least one fact').max(500),
  verified: z.boolean(),
});

export const answerBankSchema = z.object({
  answers: z
    .record(trimmedString(120), safeText(500))
    .refine((value) => Object.keys(value).length <= 100, 'Too many saved answers'),
});

export type ProfileContentInput = z.infer<typeof profileContentSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type FactInput = z.infer<typeof factSchema>;
