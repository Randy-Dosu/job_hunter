/**
 * ATS-friendly export.
 *
 * Design constraints (ATS readability):
 *  - single column, no tables, no text boxes, no images, no headers/footers
 *  - standard fonts, real selectable text, logical heading order
 *  - DOCX uses built-in styles; PDF uses plain text runs
 *
 * PDF and DOCX writers are hand-rolled here to avoid heavy/native dependencies in
 * the free-tier deployment; both produce valid files and are covered by tests.
 */

import type { CandidateProfileContent, GeneratedDocumentContent } from '@job-hunter/shared-types';

export interface ExportInput {
  document: GeneratedDocumentContent;
  contact: {
    fullName: string;
    email: string;
    phone?: string | undefined;
    location?: string | undefined;
    website?: string | undefined;
    linkedin?: string | undefined;
  };
}

/** Flatten a document into the plain-text block structure both writers use. */
export interface RenderBlock {
  kind: 'name' | 'contact' | 'headline' | 'heading' | 'paragraph' | 'bullet';
  text: string;
}

export function toBlocks(input: ExportInput): RenderBlock[] {
  const { document, contact } = input;
  const contactLine = [
    contact.email,
    contact.phone,
    contact.location,
    contact.linkedin,
    contact.website,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join('  |  ');

  const blocks: RenderBlock[] = [
    { kind: 'name', text: contact.fullName || 'Candidate' },
    ...(contactLine ? [{ kind: 'contact' as const, text: contactLine }] : []),
    { kind: 'headline', text: document.headline },
  ];

  if (document.summary) blocks.push({ kind: 'paragraph', text: document.summary });

  for (const section of document.sections) {
    if (section.bullets.length === 0) continue;
    blocks.push({ kind: 'heading', text: section.heading });
    for (const bullet of section.bullets) {
      blocks.push({
        kind: document.kind === 'cover_letter' ? 'paragraph' : 'bullet',
        text: bullet,
      });
    }
  }
  return blocks;
}

/** Plain text (used for TXT export, clipboard and tests). */
export function toPlainText(input: ExportInput): string {
  return toBlocks(input)
    .map((block) => {
      switch (block.kind) {
        case 'name':
        case 'contact':
        case 'headline':
          return block.text;
        case 'heading':
          return `\n${block.text.toUpperCase()}`;
        case 'bullet':
          return `• ${block.text}`;
        case 'paragraph':
          return block.text;
      }
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Build a resume document from the master profile (base CV export). */
export function profileToDocument(profile: CandidateProfileContent): GeneratedDocumentContent {
  const sections: GeneratedDocumentContent['sections'] = [];
  if (profile.skills.length > 0) {
    sections.push({ heading: 'Skills', bullets: [profile.skills.join(' · ')], evidenceIds: [] });
  }
  if (profile.experience.length > 0) {
    sections.push({
      heading: 'Experience',
      bullets: profile.experience.flatMap((entry) => [
        `${entry.title} — ${entry.company}${entry.startDate ? ` (${formatRange(entry.startDate, entry.endDate, entry.current)})` : ''}`,
        ...entry.bullets,
      ]),
      evidenceIds: [],
    });
  }
  if (profile.projects.length > 0) {
    sections.push({
      heading: 'Projects',
      bullets: profile.projects.map((project) => `${project.name} — ${project.description}`),
      evidenceIds: [],
    });
  }
  if (profile.education.length > 0) {
    sections.push({
      heading: 'Education',
      bullets: profile.education.map((entry) =>
        [entry.degree, entry.field, entry.institution, entry.endDate?.slice(0, 4)]
          .filter(Boolean)
          .join(', '),
      ),
      evidenceIds: [],
    });
  }
  if (profile.certifications.length > 0) {
    sections.push({
      heading: 'Certifications',
      bullets: profile.certifications.map((cert) =>
        [cert.name, cert.issuer].filter(Boolean).join(' — '),
      ),
      evidenceIds: [],
    });
  }

  return {
    kind: 'resume',
    headline: profile.headline ?? profile.experience[0]?.title ?? 'Candidate',
    ...(profile.summary ? { summary: profile.summary } : {}),
    sections,
    warnings: [],
    wordCount: 0,
  };
}

function formatRange(
  start?: string | undefined,
  end?: string | undefined,
  current?: boolean | undefined,
): string {
  const format = (value: string | undefined) => {
    if (!value) return '';
    const [year, month] = value.split('-');
    if (!month) return year ?? '';
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${months[Number(month) - 1] ?? month} ${year}`;
  };
  return [format(start), current ? 'Present' : format(end)].filter(Boolean).join(' – ');
}

// --------------------------------------------------------------------- PDF
/**
 * Minimal, dependency-free PDF writer.
 * Uses Helvetica (standard 14 font) so text stays selectable and ATS-parseable.
 */
export function toPdf(input: ExportInput): Buffer {
  const blocks = toBlocks(input);
  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const marginX = 56;
  const marginTop = 56;
  const marginBottom = 56;
  const maxWidth = pageWidth - marginX * 2;

  const lines: Array<{
    text: string;
    size: number;
    bold: boolean;
    gapBefore: number;
    indent: number;
  }> = [];
  for (const block of blocks) {
    const style = styleFor(block.kind);
    const prefix = block.kind === 'bullet' ? '• ' : '';
    for (const [index, line] of wrapText(
      `${prefix}${block.text}`,
      maxWidth - style.indent,
      style.size,
      style.bold,
    ).entries()) {
      lines.push({
        text: line,
        size: style.size,
        bold: style.bold,
        gapBefore: index === 0 ? style.gapBefore : 0,
        indent: style.indent,
      });
    }
  }

  const pages: string[][] = [];
  let current: string[] = [];
  let y = pageHeight - marginTop;

  for (const line of lines) {
    const lineHeight = line.size * 1.35;
    const needed = lineHeight + line.gapBefore;
    if (y - needed < marginBottom) {
      pages.push(current);
      current = [];
      y = pageHeight - marginTop;
    }
    y -= line.gapBefore;
    current.push(renderTextLine(line.text, line.size, line.bold, marginX + line.indent, y));
    y -= lineHeight;
  }
  if (current.length > 0) pages.push(current);

  return buildPdf(pages, pageWidth, pageHeight);
}

function styleFor(kind: RenderBlock['kind']): {
  size: number;
  bold: boolean;
  gapBefore: number;
  indent: number;
} {
  switch (kind) {
    case 'name':
      return { size: 18, bold: true, gapBefore: 0, indent: 0 };
    case 'contact':
      return { size: 9.5, bold: false, gapBefore: 4, indent: 0 };
    case 'headline':
      return { size: 11.5, bold: true, gapBefore: 10, indent: 0 };
    case 'heading':
      return { size: 11, bold: true, gapBefore: 14, indent: 0 };
    case 'bullet':
      return { size: 10, bold: false, gapBefore: 2, indent: 10 };
    default:
      return { size: 10, bold: false, gapBefore: 4, indent: 0 };
  }
}

function renderTextLine(text: string, size: number, bold: boolean, x: number, y: number): string {
  const font = bold ? '/F2' : '/F1';
  return `BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`;
}

function buildPdf(pages: string[][], width: number, height: number): Buffer {
  const objects: string[] = [];
  const pageObjectIds: number[] = [];

  // 1: catalog, 2: pages, 3: font F1, 4: font F2, then page/content pairs.
  const firstPageId = 5;
  pages.forEach((_, index) => pageObjectIds.push(firstPageId + index * 2));

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  pages.forEach((pageLines, index) => {
    const pageId = firstPageId + index * 2;
    const contentId = pageId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const stream = pageLines.join('\n');
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

function escapePdfText(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      // WinAnsi-safe: drop characters outside latin1 to keep the file valid.
      .replace(/[^\x20-\x7e\u00a0-\u00ff]/g, ' ')
      .replace(/\u00a0/g, ' ')
  );
}

const HELVETICA_WIDTHS: Record<string, number> = {
  // Approximate average glyph widths (in 1/1000 em) for Helvetica/Helvetica-Bold.
  normal: 0.5,
  bold: 0.55,
};

/** Word-wrap using approximate Helvetica metrics (good enough for layout). */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  bold: boolean,
): string[] {
  const averageWidth = (bold ? HELVETICA_WIDTHS.bold : HELVETICA_WIDTHS.normal) ?? 0.5;
  const charWidth = averageWidth * fontSize;
  const maxChars = Math.max(20, Math.floor(maxWidth / charWidth));

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (word.length > maxChars) {
      if (line) lines.push(line);
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars));
      }
      line = '';
      continue;
    }
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= maxChars) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

// -------------------------------------------------------------------- DOCX
/**
 * Minimal, dependency-free DOCX writer.
 * OOXML package with a single document.xml using Word's built-in Heading1 /
 * Normal styles — the structure ATS parsers expect.
 */
export function toDocx(input: ExportInput): Buffer {
  const blocks = toBlocks(input);
  const paragraphs = blocks
    .map((block) => {
      switch (block.kind) {
        case 'name':
          return paragraphXml(block.text, { bold: true, size: 36, spaceAfter: 60 });
        case 'contact':
          return paragraphXml(block.text, { size: 19, color: '444444', spaceAfter: 120 });
        case 'headline':
          return paragraphXml(block.text, { bold: true, size: 24, spaceAfter: 120 });
        case 'heading':
          return paragraphXml(block.text, {
            bold: true,
            size: 24,
            spaceBefore: 240,
            spaceAfter: 60,
            style: 'Heading1',
          });
        case 'bullet':
          return paragraphXml(block.text, { size: 21, bullet: true });
        default:
          return paragraphXml(block.text, { size: 21, spaceAfter: 120 });
      }
    })
    .join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const files: Array<{ path: string; content: string }> = [
    {
      path: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    },
    {
      path: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      path: 'word/_rels/document.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { path: 'word/document.xml', content: documentXml },
    { path: 'word/styles.xml', content: STYLES_XML },
  ];

  return buildZip(files);
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
        <w:sz w:val="21"/>
        <w:lang w:val="en-GB"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
</w:styles>`;

function paragraphXml(
  text: string,
  options: {
    bold?: boolean | undefined;
    size?: number | undefined;
    color?: string | undefined;
    bullet?: boolean | undefined;
    spaceBefore?: number | undefined;
    spaceAfter?: number | undefined;
    style?: string | undefined;
  },
): string {
  const runProps = [
    options.bold ? '<w:b/>' : '',
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '',
    options.color ? `<w:color w:val="${options.color}"/>` : '',
  ].join('');

  const paragraphProps = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    options.bullet ? '<w:ind w:left="360" w:hanging="360"/>' : '',
    options.spaceBefore ? `<w:spacing w:before="${options.spaceBefore}"/>` : '',
    options.spaceAfter ? `<w:spacing w:after="${options.spaceAfter}"/>` : '',
  ].join('');

  const content = options.bullet ? `•\t${escapeXml(text)}` : escapeXml(text);

  return `<w:p>${paragraphProps ? `<w:pPr>${paragraphProps}</w:pPr>` : ''}<w:r>${
    runProps ? `<w:rPr>${runProps}</w:rPr>` : ''
  }<w:t xml:space="preserve">${content}</w:t></w:r></w:p>`;
}

function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // Strip control characters that are illegal in XML 1.0.
      // eslint-disable-next-line no-control-regex -- deliberately stripping control characters
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  );
}

// ------------------------------------------------------------- ZIP writer
/** Store-only ZIP (no compression) — valid OOXML, zero dependencies. */
export function buildZip(files: Array<{ path: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const data = Buffer.from(file.content, 'utf8');
    const name = Buffer.from(file.path, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function exportDocument(
  input: ExportInput,
  format: 'pdf' | 'docx' | 'txt' | 'json',
): { buffer: Buffer; contentType: string; extension: string } {
  switch (format) {
    case 'pdf':
      return { buffer: toPdf(input), contentType: 'application/pdf', extension: 'pdf' };
    case 'docx':
      return {
        buffer: toDocx(input),
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      };
    case 'json':
      return {
        buffer: Buffer.from(JSON.stringify(input, null, 2), 'utf8'),
        contentType: 'application/json',
        extension: 'json',
      };
    default:
      return {
        buffer: Buffer.from(toPlainText(input), 'utf8'),
        contentType: 'text/plain; charset=utf-8',
        extension: 'txt',
      };
  }
}

/** ATS lint: catch formatting an ATS would struggle with. */
export function lintAts(input: ExportInput): string[] {
  const issues: string[] = [];
  const text = toPlainText(input);
  if (input.document.sections.length === 0) issues.push('The document has no sections yet.');
  if (text.length < 300 && input.document.kind === 'resume') {
    issues.push('The resume is very short — ATS parsers may find little to read.');
  }
  if (/[\u2022]/.test(text) === false && input.document.kind === 'resume') {
    issues.push('Consider using bullet points for experience entries.');
  }
  if (/\t{2,}| {5,}/.test(text))
    issues.push('Multiple consecutive spaces or tabs can confuse parsers.');
  if (!/[@]/.test(text)) issues.push('No email address found in the document header.');
  return issues;
}
