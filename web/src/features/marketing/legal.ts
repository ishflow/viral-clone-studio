export const LEGAL_DOCS = ['terms', 'privacy', 'refunds', 'cookies', 'content'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export function isLegalDoc(value: string): value is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(value);
}

/** Number of sections per doc (titles are messages `marketing.legal.sections.<doc>.<n>`). */
export const LEGAL_SECTIONS: Record<LegalDoc, number> = { terms: 10, privacy: 6, refunds: 6, cookies: 3, content: 4 };

/** All five documents have section-specific copy. */
export const LEGAL_WRITTEN: readonly LegalDoc[] = LEGAL_DOCS;

export type LegalBlock = { list: boolean; lines: string[] };

/** A section's text is lines: a line starting with "- " is a bullet, any other line a paragraph; neighbouring bullets form one list. */
export function legalBlocks(text: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  for (const line of text.split('\n')) {
    const list = line.startsWith('- ');
    const last = blocks.at(-1);
    const content = list ? line.slice(2) : line;
    if (list && last?.list) last.lines.push(content);
    else blocks.push({ list, lines: [content] });
  }
  return blocks;
}
