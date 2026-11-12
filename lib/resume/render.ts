import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { TailoredResumeContent } from "./types";
import { resumeToText } from "./grounding";

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

/** ATS-friendly single-column PDF: real text, standard fonts, no images or columns. */
export async function renderPdf(content: TailoredResumeContent): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${content.header.name} — ${content.target.jobTitle}`);
  pdf.setAuthor(content.header.name);
  pdf.setSubject(`Application for ${content.target.jobTitle} at ${content.target.company}`);
  pdf.setProducer("Job Hunter");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const wrap = (text: string, size: number, font = regular, width = PAGE_WIDTH - MARGIN * 2): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const ensure = (height: number) => {
    if (y - height < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const write = (text: string, opts: { size?: number; font?: typeof regular; color?: [number, number, number]; gap?: number; x?: number } = {}) => {
    const size = opts.size ?? 10;
    const font = opts.font ?? regular;
    const color = opts.color ?? [0.12, 0.14, 0.2];
    const lines = wrap(text, size, font, PAGE_WIDTH - MARGIN * 2 - ((opts.x ?? MARGIN) - MARGIN));
    for (const line of lines) {
      ensure(size + 3);
      page.drawText(line, {
        x: opts.x ?? MARGIN,
        y: y - size,
        size,
        font,
        color: rgb(color[0], color[1], color[2]),
      });
      y -= size + 3;
    }
    y -= opts.gap ?? 0;
  };

  const heading = (text: string) => {
    ensure(26);
    y -= 8;
    page.drawText(text.toUpperCase(), { x: MARGIN, y: y - 10, size: 9.5, font: bold, color: rgb(0.12, 0.16, 0.42) });
    y -= 15;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.6, color: rgb(0.78, 0.8, 0.86) });
    y -= 8;
  };

  write(content.header.name.toUpperCase(), { size: 19, font: bold, color: [0.07, 0.09, 0.15] });
  if (content.header.contactLines.length) {
    write(content.header.contactLines.join("  ·  "), { size: 8.5, font: regular, color: [0.35, 0.38, 0.45], gap: 2 });
  }
  if (content.headline.text) write(content.headline.text, { size: 11, font: regular, color: [0.2, 0.28, 0.55] });

  if (content.summary.text) {
    heading("Summary");
    write(content.summary.text, { size: 9.6, gap: 2 });
  }

  const section = (title: string, entries: TailoredResumeContent["experience"]) => {
    if (!entries.length) return;
    heading(title);
    for (const entry of entries) {
      ensure(34);
      write(entry.title, { size: 10.2, font: bold });
      const meta = [entry.organization, entry.location, entry.dates].filter(Boolean).join("  ·  ");
      if (meta) write(meta, { size: 8.6, font: italic, color: [0.36, 0.4, 0.48] });
      for (const bullet of entry.bullets) write(`•  ${bullet.text}`, { size: 9.4, x: MARGIN, gap: 1 });
      y -= 3;
    }
  };

  section("Experience", content.experience);
  section("Education", content.education);
  section("Certifications", content.certifications);
  section("Projects & achievements", content.achievements);

  if (content.skills.core.text) {
    heading("Skills");
    write(content.skills.core.text, { size: 9.6 });
    if (content.skills.learning?.text) {
      write(content.skills.learning.text, { size: 8.8, font: italic, color: [0.4, 0.42, 0.48] });
    }
  }

  const footer = `Tailored for ${content.target.jobTitle} at ${content.target.company} · every claim traceable to verified profile evidence`;
  page.drawText(footer.slice(0, 120), { x: MARGIN, y: 24, size: 6.8, font: regular, color: rgb(0.62, 0.65, 0.72) });

  return pdf.save();
}

export async function renderDocx(content: TailoredResumeContent): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: content.header.name.toUpperCase(), bold: true, size: 36 })],
    }),
  );
  if (content.header.contactLines.length) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: content.header.contactLines.join("  ·  "), size: 18, color: "555555" })],
      }),
    );
  }
  if (content.headline.text) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: content.headline.text, size: 20, color: "2B3A78" })],
        spacing: { after: 120 },
      }),
    );
  }

  const sectionHeading = (text: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 20, color: "1E2A5A" })],
    });

  if (content.summary.text) {
    children.push(sectionHeading("Summary"), new Paragraph({ children: [new TextRun({ text: content.summary.text, size: 19 })] }));
  }

  const section = (title: string, entries: TailoredResumeContent["experience"]) => {
    if (!entries.length) return;
    children.push(sectionHeading(title));
    for (const entry of entries) {
      children.push(
        new Paragraph({
          spacing: { before: 80 },
          children: [new TextRun({ text: entry.title, bold: true, size: 20 })],
        }),
      );
      const meta = [entry.organization, entry.location, entry.dates].filter(Boolean).join("  ·  ");
      if (meta) {
        children.push(new Paragraph({ children: [new TextRun({ text: meta, italics: true, size: 17, color: "555555" })] }));
      }
      for (const bullet of entry.bullets) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: bullet.text, size: 19 })],
          }),
        );
      }
    }
  };

  section("Experience", content.experience);
  section("Education", content.education);
  section("Certifications", content.certifications);
  section("Projects & achievements", content.achievements);

  if (content.skills.core.text) {
    children.push(sectionHeading("Skills"), new Paragraph({ children: [new TextRun({ text: content.skills.core.text, size: 19 })] }));
    if (content.skills.learning?.text) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: content.skills.learning.text, italics: true, size: 17, color: "555555" })] }),
      );
    }
  }

  const doc = new Document({
    creator: "Job Hunter",
    title: `${content.header.name} — ${content.target.jobTitle}`,
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

export { resumeToText };
