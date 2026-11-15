import { describe, expect, it } from 'vitest';
import {
  buildFallbackDocument,
  checkEvidence,
  countWords,
  crc32,
  exportDocument,
  generateDocument,
  hasUnresolvedWarnings,
  lintAts,
  profileToDocument,
  toBlocks,
  toDocx,
  toPdf,
  toPlainText,
} from '../src/index.js';
import type { GeneratedDocumentContent } from '@job-hunter/shared-types';
import { makeFacts, makeProfile } from '../../matching/test/fixtures.js';

const facts = makeFacts();
const job = {
  title: 'Senior Backend Engineer',
  company: 'Zola Systems',
  description:
    'Build payment services in TypeScript and PostgreSQL. Requires 5+ years experience. Reports to the Head of Platform.',
};

const contact = {
  fullName: 'Ama Mensah',
  email: 'ama@example.test',
  phone: '+233200000000',
  location: 'Kumasi, Ghana',
};

/** A gateway stub returning a fixed structured payload (or throwing). */
function gateway(payload: unknown) {
  return {
    generateStructured: async <T>() => ({
      data: payload as T,
      provider: 'mock',
      model: 'mock-1',
      promptVersion: 'resume-tailor-v1',
      latencyMs: 12,
    }),
  };
}

const prompts = {
  buildResumeTailorPrompt: () => ({ system: 'sys', prompt: 'prompt' }),
  buildCoverLetterPrompt: () => ({ system: 'sys', prompt: 'prompt' }),
};

const draft = {
  headline: 'Senior Backend Engineer',
  summary: 'Backend engineer building payment services in TypeScript and PostgreSQL.',
  sections: [
    {
      heading: 'Experience',
      bullets: [
        'Built TypeScript payment services and led a PostgreSQL migration at Kente Pay.',
        'Built REST APIs with Node.js for a logistics platform at Accra Labs.',
      ],
      evidenceIds: ['f6', 'f7'],
    },
    {
      heading: 'Skills',
      bullets: ['TypeScript · Node.js · PostgreSQL · AWS · Docker'],
      evidenceIds: ['f1', 'f2', 'f3', 'f4', 'f5'],
    },
  ],
};

const generate = (payload: unknown = draft) =>
  generateDocument({ job, facts, kind: 'resume' }, { gateway: gateway(payload), prompts });

describe('generateDocument', () => {
  it('refuses to generate from an unverified profile', async () => {
    await expect(
      generateDocument(
        { job, facts: facts.map((fact) => ({ ...fact, verified: false })), kind: 'resume' },
        { gateway: gateway(draft), prompts },
      ),
    ).rejects.toThrow(/No verified facts/i);
  });

  it('only ever sends verified facts to the model', async () => {
    let seen: { verifiedFacts: Array<{ id: string }> } | undefined;
    const spy = {
      generateStructured: async <T>() => {
        return {
          data: draft as unknown as T,
          provider: 'mock',
          model: 'mock-1',
          promptVersion: 'v1',
          latencyMs: 1,
        };
      },
    };
    const unverified = makeFacts([
      { id: 'f-bad', kind: 'skill', label: 'Kubernetes', verified: false },
    ]);
    await generateDocument(
      { job, facts: unverified, kind: 'resume' },
      {
        gateway: spy,
        prompts: {
          buildResumeTailorPrompt: (input) => {
            seen = input as unknown as { verifiedFacts: Array<{ id: string }> };
            return { system: 's', prompt: 'p' };
          },
          buildCoverLetterPrompt: () => ({ system: 's', prompt: 'p' }),
        },
      },
    );
    expect(seen?.verifiedFacts.map((fact) => fact.id)).not.toContain('f-bad');
  });

  it('returns structured content with provenance metadata', async () => {
    const result = await generate();
    expect(result.content.kind).toBe('resume');
    expect(result.content.sections).toHaveLength(2);
    expect(result.provider).toBe('mock');
    expect(result.promptVersion).toBe('resume-tailor-v1');
  });
});

describe('checkEvidence — the truthfulness gate', () => {
  const content = (): GeneratedDocumentContent => ({
    kind: 'resume',
    headline: 'Senior Backend Engineer',
    summary: 'Backend engineer.',
    sections: [
      {
        heading: 'Experience',
        bullets: ['Built TypeScript payment services at Kente Pay.'],
        evidenceIds: ['f6'],
      },
      { heading: 'Skills', bullets: ['TypeScript'], evidenceIds: ['f1'] },
    ],
    warnings: [],
    wordCount: 10,
  });

  it('accepts claims supported by verified facts', () => {
    const result = checkEvidence({
      content: content(),
      providedFacts: facts,
      verifiedFacts: facts,
    });
    expect(result.content.sections[0]!.evidenceIds).toEqual(['f6']);
    expect(result.warnings).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('accepts decimals, thousands separators and unit suffixes from verified facts', () => {
    // Regression: comparing only digits ("1.4" -> "14") flagged true statements
    // as unsupported, which trains users to approve warnings without reading them.
    const withNumbers: GeneratedDocumentContent = {
      kind: 'resume',
      headline: 'Senior Backend Engineer',
      summary: 'Cut p95 latency from 1.4s to 180ms.',
      sections: [
        {
          heading: 'Experience',
          bullets: [
            'Cut p95 latency from 1.4s to 180ms.',
            'Handled 40,000 transactions per day.',
            'Led 12 engineers across 3 teams.',
          ],
          evidenceIds: ['num-1', 'num-2', 'num-3'],
        },
      ],
      warnings: [],
      wordCount: 20,
    };

    const verified = [
      ...facts,
      {
        ...facts[0]!,
        id: 'num-1',
        label: 'Cut p95 latency from 1.4s to 180ms.',
        verified: true,
      },
      { ...facts[0]!, id: 'num-2', label: 'Handled 40,000 transactions per day.', verified: true },
      { ...facts[0]!, id: 'num-3', label: 'Led 12 engineers across 3 teams.', verified: true },
    ];

    const result = checkEvidence({
      content: withNumbers,
      providedFacts: verified,
      verifiedFacts: verified,
    });
    expect(result.warnings).toEqual([]);
  });

  it('still flags a figure that appears nowhere in the verified facts', () => {
    const invented: GeneratedDocumentContent = {
      kind: 'resume',
      headline: 'Engineer',
      summary: 'Backend engineer.',
      sections: [
        { heading: 'Experience', bullets: ['Increased revenue by 47,500 USD.'], evidenceIds: [] },
      ],
      warnings: [],
      wordCount: 8,
    };
    const result = checkEvidence({ content: invented, providedFacts: facts, verifiedFacts: facts });
    expect(result.warnings.join(' ')).toMatch(/Unverified figure "47,500"/);
  });

  it('strips evidence ids that were not provided or are unverified', () => {
    const tampered = content();
    tampered.sections[0]!.evidenceIds = ['f6', 'made-up'];
    const result = checkEvidence({ content: tampered, providedFacts: facts, verifiedFacts: facts });
    expect(result.content.sections[0]!.evidenceIds).toEqual(['f6']);
    expect(result.warnings.join(' ')).toMatch(/cited facts that are missing or unverified/i);
    expect(result.content.sections[0]!.bullets).toHaveLength(1);
  });

  it('strips an id whose fact exists but is not verified', () => {
    const pending = makeFacts([
      { id: 'f-pending', kind: 'skill', label: 'Kubernetes', verified: false },
    ]);
    const tampered = content();
    tampered.sections[0]!.evidenceIds = ['f6', 'f-pending'];
    // The fact was provided to the model but never verified by the user.
    const result = checkEvidence({
      content: tampered,
      providedFacts: pending,
      verifiedFacts: facts,
    });
    expect(result.content.sections[0]!.evidenceIds).not.toContain('f-pending');
    expect(result.warnings.join(' ')).toMatch(/missing or unverified/i);
  });

  it('flags a number that no verified fact supports', () => {
    const inflated = content();
    inflated.sections[0]!.bullets = ['Reduced infrastructure spend by 72% across nine regions.'];
    inflated.sections[0]!.evidenceIds = ['f6'];
    const result = checkEvidence({ content: inflated, providedFacts: facts, verifiedFacts: facts });
    expect(result.warnings.join(' ')).toMatch(/72/);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]!.sectionIndex).toBe(0);
  });

  it('accepts numbers that do appear in verified source material', () => {
    const supported = content();
    supported.sections[0]!.bullets = ['Cut latency by 40% at Kente Pay.'];
    supported.sections[0]!.evidenceIds = ['f6'];
    const result = checkEvidence({
      content: supported,
      providedFacts: facts,
      verifiedFacts: facts,
    });
    expect(result.warnings.join(' ')).not.toMatch(/40/);
  });

  it('flags an invented credential', () => {
    const invented = content();
    invented.sections.push({
      heading: 'Certifications',
      bullets: ['Google Cloud Professional Cloud Architect'],
      evidenceIds: ['f9'],
    });
    const result = checkEvidence({ content: invented, providedFacts: facts, verifiedFacts: facts });
    expect(result.warnings.join(' ')).toMatch(/Google Cloud|credential/i);
    expect(hasUnresolvedWarnings(result.content)).toBe(true);
  });

  it('leaves clean content without unresolved warnings', () => {
    const result = checkEvidence({
      content: content(),
      providedFacts: facts,
      verifiedFacts: facts,
    });
    expect(hasUnresolvedWarnings(result.content)).toBe(false);
  });
});

describe('fallback document', () => {
  it('is deterministic and grounded in verified facts only', () => {
    const unverified = makeFacts([
      { id: 'f-x', kind: 'skill', label: 'Kubernetes', verified: false },
    ]);
    const a = buildFallbackDocument({ kind: 'resume', job, facts: unverified });
    const b = buildFallbackDocument({ kind: 'resume', job, facts: unverified });
    expect(a).toEqual(b);

    const text = toPlainText({ document: a, contact }).toLowerCase();
    expect(text).not.toContain('kubernetes');
    expect(text).toContain('typescript');

    const known = new Set(unverified.filter((fact) => fact.verified).map((fact) => fact.id));
    const ids = a.sections.flatMap((section) => section.evidenceIds);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => known.has(id))).toBe(true);
  });

  it('flags itself for review so it cannot be approved silently', () => {
    const doc = buildFallbackDocument({ kind: 'cover_letter', job, facts });
    expect(doc.warnings.join(' ')).toMatch(/review/i);
    expect(doc.wordCount).toBeGreaterThan(0);
  });

  it('never claims employment at the target company', () => {
    const doc = buildFallbackDocument({ kind: 'cover_letter', job, facts });
    expect(toPlainText({ document: doc, contact })).not.toMatch(
      /I (worked|was employed) at Zola Systems/i,
    );
  });
});

describe('ATS export', () => {
  const doc = buildFallbackDocument({ kind: 'resume', job, facts });
  const input = { document: doc, contact };

  it('renders a single-column block order with contact details', () => {
    const blocks = toBlocks(input);
    expect(blocks[0]).toEqual({ kind: 'name', text: 'Ama Mensah' });
    expect(blocks[1]!.kind).toBe('contact');
    expect(blocks[1]!.text).toContain('ama@example.test');
    expect(blocks.some((block) => block.kind === 'heading')).toBe(true);
  });

  it('produces readable plain text with no markup', () => {
    const text = toPlainText(input);
    expect(text).toContain('Ama Mensah');
    expect(text).toMatch(/SKILLS/);
    expect(text).not.toContain('<');
    expect(text).not.toContain('**');
    expect(countWords(doc.sections, doc.summary)).toBeGreaterThan(10);
  });

  it('produces a structurally valid PDF', () => {
    const pdf = toPdf(input);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1').trim()).toBe('%%EOF');
    expect(pdf.toString('latin1')).toContain('Ama Mensah');
    // Must declare a page tree so readers/ATS can open it.
    expect(pdf.toString('latin1')).toContain('/Type /Catalog');
    expect(pdf.toString('latin1')).toContain('/Type /Page');
  });

  it('escapes PDF special characters instead of corrupting the file', () => {
    const tricky = {
      ...input,
      contact: { ...contact, fullName: 'Ama (Mensah) \\ Osei' },
    };
    const pdf = toPdf(tricky);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('\\(Mensah\\)');
  });

  it('produces a DOCX that is a valid zip with the required parts', () => {
    const docx = toDocx(input);
    expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');
    const text = docx.toString('latin1');
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('word/document.xml');
  });

  it('computes a stable CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.from(''))).toBe(0);
  });

  it('exports every format with correct metadata', () => {
    expect(exportDocument(input, 'pdf')).toMatchObject({
      contentType: 'application/pdf',
      extension: 'pdf',
    });
    expect(exportDocument(input, 'txt')).toMatchObject({ extension: 'txt' });
    const json = exportDocument(input, 'json');
    expect(JSON.parse(json.buffer.toString('utf8')).contact.fullName).toBe('Ama Mensah');
    expect(exportDocument(input, 'docx').contentType).toContain('wordprocessingml');
  });

  it('lints formatting problems an ATS would hit', () => {
    expect(lintAts(input)).toEqual([]);

    const empty: GeneratedDocumentContent = {
      kind: 'resume',
      headline: 'Engineer',
      sections: [],
      warnings: [],
      wordCount: 0,
    };
    const issues = lintAts({ document: empty, contact });
    expect(issues.join(' ')).toMatch(/no sections/i);
    expect(issues.join(' ')).toMatch(/very short/i);
  });

  it('converts a base profile into a factual document', () => {
    const profile = makeProfile();
    const document = profileToDocument(profile);
    const text = toPlainText({ document, contact });
    expect(text).toContain('Kente Pay');
    expect(document.sections.length).toBeGreaterThan(0);
  });
});
