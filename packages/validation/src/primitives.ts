import { z } from 'zod';

/** Reusable constrained strings. Trim aggressively: users paste from everywhere. */
export const trimmedString = (max: number) => z.string().trim().max(max);
export const nonEmptyString = (max: number) => trimmedString(max).min(1, 'Required');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address');

/**
 * Password policy: length-first (NIST-aligned), no composition theatre.
 * 12 characters minimum, 200 max to bound hashing cost.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200, 'Password is too long');

export const uuidSchema = z.string().uuid();

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Use YYYY-MM or YYYY-MM-DD');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

export const urlSchema = z
  .string()
  .trim()
  .max(2048)
  .url('Enter a valid URL')
  .refine((value) => /^https?:\/\//i.test(value), 'Only http(s) URLs are allowed');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Defence-in-depth string hygiene. Values are always rendered as text (never
 * HTML) in the UI, but we also strip control characters and obvious markup to
 * keep stored data clean and exports safe.
 */
export function sanitizeText(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- deliberately stripping control characters
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .trim()
  );
}

export const safeText = (max: number) =>
  z
    .string()
    .transform((value) => sanitizeText(value))
    .pipe(z.string().max(max));
