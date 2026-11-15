import { z } from 'zod';
import { trimmedString, urlSchema } from './primitives.js';

/**
 * Starting a browser session requires an explicit consent flag that must be
 * literally `true` — there is no default. The API also re-checks the site
 * allowlist and feature flag server-side.
 */
export const startBrowserSessionSchema = z.object({
  jobId: z.string().uuid(),
  applicationUrl: urlSchema,
  consent: z.literal(true, { error: 'You must confirm you want the assistant to start' }),
});

export const pauseBrowserSessionSchema = z.object({
  reason: z.enum([
    'user_review',
    'captcha',
    'login_required',
    'unsupported_form',
    'unknown_field',
    'access_restriction',
    'session_expired',
    'error',
  ]),
  note: trimmedString(300).optional(),
});

export const fillBrowserFieldSchema = z.object({
  fieldLabel: trimmedString(200).min(1),
  value: trimmedString(1000),
});

export const recordBrowserActionSchema = z.object({
  action: z.enum([
    'session_started',
    'navigated',
    'form_detected',
    'field_filled',
    'field_skipped',
    'paused',
    'resumed',
    'handed_off',
    'session_ended',
  ]),
  detail: trimmedString(300).optional(),
});

export type StartBrowserSessionInput = z.infer<typeof startBrowserSessionSchema>;
