/**
 * Form field mapping.
 *
 * Pure functions that turn form markup plus approved profile data into a list of
 * proposed field values. Two hard rules:
 *   1. Only verified/approved data may be proposed.
 *   2. Legal declarations, eligibility and demographic questions are never
 *      guessed — they are surfaced to the user as unresolved.
 */

import type {
  ApprovedProfileData,
  FormDescriptor,
  FormFieldDescriptor,
} from '@job-hunter/shared-types';

interface ParsedField {
  name: string;
  id: string;
  type: string;
  label: string;
  required: boolean;
  options?: string[] | undefined;
  tag: string;
  sensitive: boolean;
}

/**
 * Terms that mark a field as a legal/eligibility declaration. These are never
 * autofilled: an incorrect guess here can be deceptive or unlawful.
 */
const SENSITIVE_PATTERNS = [
  /sponsor/i,
  /visa/i,
  /authoriz/i,
  /work\s*permit/i,
  /right\s*to\s*work/i,
  /citizen/i,
  /felony/i,
  /criminal/i,
  /convict/i,
  /background\s*check/i,
  /drug\s*test/i,
  /disabilit/i,
  /veteran/i,
  /gender/i,
  /race|ethnic/i,
  /sexual\s*orientation/i,
  /religio/i,
  /salary\s*expect/i,
  /notice\s*period/i,
  /consent|terms|privacy|policy|gdpr/i,
  /signature|attest|declare|certif/i,
  /referr/i,
];

type FieldKey =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'location'
  | 'website'
  | 'linkedin'
  | 'github'
  | 'headline'
  | 'summary'
  | 'skills'
  | 'company'
  | 'title';

/** Ordered: more specific matchers first. */
const FIELD_MATCHERS: Array<{ key: FieldKey; patterns: RegExp[] }> = [
  { key: 'firstName', patterns: [/first\s*name/i, /given\s*name/i, /\bfname\b/i] },
  { key: 'lastName', patterns: [/last\s*name/i, /family\s*name/i, /surname/i, /\blname\b/i] },
  {
    key: 'fullName',
    patterns: [/full\s*name/i, /your\s*name/i, /^name$/i, /legal\s*name/i, /candidate\s*name/i],
  },
  { key: 'email', patterns: [/e-?mail/i] },
  { key: 'phone', patterns: [/phone/i, /mobile/i, /telephone/i, /\btel\b/i, /contact\s*number/i] },
  { key: 'linkedin', patterns: [/linked\s*in/i, /linkedin/i] },
  { key: 'github', patterns: [/git\s*hub/i, /github/i] },
  { key: 'website', patterns: [/website/i, /portfolio/i, /personal\s*site/i, /homepage/i] },
  {
    key: 'location',
    patterns: [/location/i, /city/i, /address/i, /where.*based/i, /current\s*residence/i],
  },
  { key: 'headline', patterns: [/headline/i, /current\s*(role|title|position)/i] },
  { key: 'company', patterns: [/current\s*company/i, /employer/i] },
  {
    key: 'summary',
    patterns: [/summary/i, /about\s*you/i, /cover\s*letter/i, /why.*(join|interested)/i],
  },
  { key: 'skills', patterns: [/skills/i, /technologies/i, /tech\s*stack/i] },
];

/** Parse an accessible label for an input. Mirrors how browsers build the name. */
export function labelFor(attributes: {
  html: string;
  labelText?: string | undefined;
  placeholder?: string | undefined;
  ariaLabel?: string | undefined;
  name?: string | undefined;
  id?: string | undefined;
}): string {
  const candidates = [
    attributes.labelText,
    attributes.ariaLabel,
    attributes.placeholder,
    attributes.name,
    attributes.id,
  ];
  const usable = candidates.find(
    (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
  );
  return (usable ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function isSensitiveField(label: string, type: string): boolean {
  if (type === 'password' || type === 'file' || type === 'hidden') return true;
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(label));
}

/** Map a parsed field to a key in the approved profile, if any. */
export function matchFieldKey(label: string): FieldKey | undefined {
  for (const matcher of FIELD_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(label))) return matcher.key;
  }
  return undefined;
}

export function valueFor(key: FieldKey, profile: ApprovedProfileData): string | undefined {
  switch (key) {
    case 'firstName':
      return profile.contact.firstName ?? profile.contact.fullName.split(' ')[0];
    case 'lastName': {
      if (profile.contact.lastName) return profile.contact.lastName;
      const parts = profile.contact.fullName.trim().split(/\s+/);
      return parts.length > 1 ? parts.slice(1).join(' ') : undefined;
    }
    case 'fullName':
      return profile.contact.fullName;
    case 'email':
      return profile.contact.email;
    case 'phone':
      return profile.contact.phone;
    case 'location':
      return profile.contact.location;
    case 'website':
      return profile.contact.website;
    case 'linkedin':
      return profile.contact.linkedin;
    case 'github':
      return profile.contact.github;
    case 'headline':
      return profile.headline;
    case 'summary':
      return profile.summary;
    case 'skills':
      return profile.skills.length > 0 ? profile.skills.join(', ') : undefined;
    case 'company':
      return profile.mostRecentRole?.company;
    case 'title':
      return profile.mostRecentRole?.title;
  }
}

/**
 * Build the form descriptor for a set of parsed fields. Pure: the same markup +
 * profile always yields the same mapping, which is what the E2E tests assert.
 */
export function mapFormFields(parsed: ParsedField[], profile: ApprovedProfileData): FormDescriptor {
  const fields: FormFieldDescriptor[] = parsed
    // Never propose a value for hidden/password/file inputs at all.
    .filter((field) => field.type !== 'hidden' && field.type !== 'password')
    .map((field) => {
      const label = labelFor({
        html: '',
        labelText: field.label,
        name: field.name,
        id: field.id,
      });
      const key = matchFieldKey(label);
      const proposed = key ? valueFor(key, profile) : undefined;
      const fromAnswerBank = profile.answers[label];

      // File uploads are checked before the generic sensitive rule so the user
      // gets an accurate instruction instead of a generic disclaimer.
      if (field.type === 'file') {
        return {
          selector: selectorFor(field),
          label,
          type: 'file',
          required: field.required,
          options: field.options,
          value: null,
          sensitive: true,
          confidence: 'low',
          skippedReason: 'Upload the file yourself from your approved documents.',
        } satisfies FormFieldDescriptor;
      }

      if (field.sensitive) {
        return {
          selector: selectorFor(field),
          label,
          type: normalizeFieldType(field),
          required: field.required,
          options: field.options,
          value: null,
          sensitive: true,
          confidence: 'low',
          skippedReason: 'Legal or sensitive question — you must answer this yourself.',
        } satisfies FormFieldDescriptor;
      }

      if (fromAnswerBank !== undefined && fromAnswerBank.length > 0) {
        return {
          selector: selectorFor(field),
          label,
          type: normalizeFieldType(field),
          required: field.required,
          options: field.options,
          value: fromAnswerBank,
          source: 'answer_bank',
          sensitive: false,
          confidence: 'high',
        } satisfies FormFieldDescriptor;
      }

      if (proposed !== undefined && proposed.trim().length > 0) {
        return {
          selector: selectorFor(field),
          label,
          type: normalizeFieldType(field),
          required: field.required,
          options: field.options,
          value: proposed,
          source:
            key === 'company' || key === 'title'
              ? 'experience'
              : key === 'skills'
                ? 'skills'
                : key === 'summary' || key === 'headline'
                  ? 'contact'
                  : 'contact',
          sensitive: false,
          confidence: key ? 'high' : 'low',
        } satisfies FormFieldDescriptor;
      }

      return {
        selector: selectorFor(field),
        label,
        type: normalizeFieldType(field),
        required: field.required,
        options: field.options,
        value: null,
        sensitive: false,
        confidence: 'low',
        skippedReason: 'No approved answer on file — please fill this in.',
      } satisfies FormFieldDescriptor;
    });

  const unresolvedFieldCount = fields.filter((field) => field.value === null).length;
  return {
    adapterId: 'generic',
    fields,
    unresolvedFieldCount,
    challengeDetected: false,
  };
}

function normalizeFieldType(field: ParsedField): FormFieldDescriptor['type'] {
  if (field.tag === 'textarea') return 'textarea';
  if (field.tag === 'select') return 'select';
  switch (field.type) {
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'url':
      return 'url';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'file':
      return 'file';
    default:
      return 'text';
  }
}

function selectorFor(field: ParsedField): string {
  if (field.name) return `[name="${cssEscape(field.name)}"]`;
  if (field.id) return `#${cssEscape(field.id)}`;
  return field.tag;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Parse the parts of an HTML form we care about, without a DOM dependency. */
export function extractFormFields(html: string): ParsedField[] {
  const fields: ParsedField[] = [];
  const inputRegex = /<(input|textarea|select)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = inputRegex.exec(html)) !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    const attributes = match[2] ?? '';
    const type = (
      findAttribute(attributes, 'type') ?? (tag === 'input' ? 'text' : tag)
    ).toLowerCase();
    // Hidden inputs carry CSRF tokens and tracking values. They are never
    // fillable by a human, so they must not appear in a user-facing plan.
    if (
      type === 'hidden' ||
      type === 'submit' ||
      type === 'button' ||
      type === 'reset' ||
      type === 'search'
    ) {
      continue;
    }

    const name = findAttribute(attributes, 'name') ?? '';
    const id = findAttribute(attributes, 'id') ?? '';
    const required =
      /(^|\s)required(\s|=|$)/i.test(attributes) ||
      findAttribute(attributes, 'aria-required') === 'true';

    const labelText =
      findLabelFor(html, id, name) ??
      findAttribute(attributes, 'aria-label') ??
      findAttribute(attributes, 'placeholder') ??
      findAttribute(attributes, 'title') ??
      '';

    const options =
      tag === 'select'
        ? [...(html.slice(match.index).match(/<option[^>]*>([^<]*)<\/option>/gi) ?? [])]
            .map((option) => option.replace(/<[^>]+>/g, '').trim())
            .filter((option) => option.length > 0)
        : undefined;

    const label = labelText.replace(/\s+/g, ' ').trim();
    fields.push({
      name,
      id,
      type,
      label,
      required,
      options,
      tag,
      sensitive: isSensitiveField(label, type),
    });
  }
  return fields;
}

function findAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match ? (match[2] ?? match[3] ?? match[4]) : undefined;
}

function findLabelFor(html: string, id: string, name: string): string | undefined {
  if (id) {
    const forId = html.match(
      new RegExp(
        `<label[^>]*\\bfor\\s*=\\s*["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)</label>`,
        'i',
      ),
    );
    if (forId?.[1]) return stripTags(forId[1]);
  }
  if (name) {
    const labelled = html.match(
      new RegExp(
        `<label[^>]*>([\\s\\S]*?)<(input|textarea|select)[^>]*\\bname\\s*=\\s*["']${escapeRegExp(name)}["'][^>]*>[\\s\\S]*?</label>`,
        'i',
      ),
    );
    if (labelled?.[1]) return stripTags(labelled[1]);
  }
  return undefined;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
