import { z } from 'zod';
import { CONSENT_KINDS } from '@job-hunter/shared-types';
import { emailSchema, passwordSchema, trimmedString } from './primitives.js';

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: trimmedString(80).min(1, 'Tell us your name'),
  acceptedTerms: z.literal(true, { error: 'You must accept the terms to continue' }),
  timeZone: trimmedString(64).optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});

export const consentSchema = z.object({
  kind: z.enum(CONSENT_KINDS),
  granted: z.boolean(),
  version: trimmedString(32).min(1),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ConsentInput = z.infer<typeof consentSchema>;
