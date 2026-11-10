// C6 case 4, the document side: a style can only name a font the engine ships (Inter, Montserrat); any other is refused before anything is written.
import { describe, expect, it } from 'vitest';
import { shortEdit } from '../compose/fixture.ts';
import { EditSchema } from '../edit/schema.ts';

describe('a document that names a font the machine does not have (C6 case 4)', () => {
  it('is refused by the schema at styles.<name>.font', () => {
    const edit = { ...shortEdit(720), styles: { mine: { font: 'Comic Sans MS', size: 40 } } };
    const r = EditSchema.safeParse(edit);
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path.join('.') === 'styles.mine.font')).toBe(true);
  });
});
