import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { markdownOf, reference } from '../reference.ts';
import type { Reference } from '../reference.ts';

export const schema: Command<Context> = {
  name: 'schema',
  summary: 'The field reference of the edit document: every field with its type, its range, what it is when left out and one line on what it does; then the text styles, the safe areas and the limits. Generated from the schema the editor checks with.',
  args: [],
  flags: [{ name: 'markdown', type: 'boolean', help: 'the reference as a markdown document: what docs/reference/edit-format.md holds' }],
  async run(input) {
    const ref = reference();
    return {
      result: input.flags.markdown === true ? { markdown: markdownOf(ref) }
        : { ...ref, next: 'A working document to start from: `viraleditor init <dir>`. A field that is not listed here is the error `schema`.' },
    };
  },
  text(result) {
    if (typeof (result as { markdown?: string }).markdown === 'string') return (result as { markdown: string }).markdown.trimEnd();
    const ref = result as Reference & { next: string };
    const out: string[] = [...ref.reading, ''];
    for (const section of ref.sections) {
      out.push(`${section.title}: ${section.about}`);
      for (const field of section.fields) out.push(`  ${field.path}: ${field.type}${field.default === '' ? '' : field.default === 'required' ? ', required' : `, default ${field.default}`}. ${field.note}`);
      out.push('');
    }
    out.push('Text styles (font weight, size on 1080 / 720, fill, outline, plate, other, enter, exit):');
    for (const s of ref.styles) out.push(`  ${s.name}: ${s.font} ${s.weight}, ${s.size1080} / ${s.size720} px, ${s.fill}, outline ${s.outline}, plate ${s.plate}, ${s.other}, enter ${s.enter}, exit ${s.exit}`);
    out.push('', 'Safe areas (percent of the canvas):');
    for (const row of ref.safeAreas) out.push(`  ${row.safe}: ${row.area}; column of the buttons: ${row.buttons}`);
    out.push('', 'Easings:', ...ref.easings.map((row) => `  ${row.name}: ${row.css}`));
    out.push('', 'Limits:', ...ref.limits.map((row) => `  ${row.what}: ${row.limit}`), '', ref.next);
    return out.join('\n');
  },
};
