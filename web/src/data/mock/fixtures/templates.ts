import type { Candidate, Id, Shot, Template } from '../../ports';
import type { Ago } from '../store';

/** [what happens, on-screen text, product shown (1-based) or null] */
type ShotRow = [action: string, text: string, product: number | null];

const sample = (hash: string): string => `/samples/${hash}.jpg`;

/** Shots that divide the length evenly. */
function evenShots(seconds: number, rows: ShotRow[]): Shot[] {
  const at = (index: number) => Math.round((seconds * index * 10) / rows.length) / 10;
  return rows.map(([action, text, product], index) => ({ n: index + 1, from: at(index), to: at(index + 1), action, text, product }));
}

type Seed = Pick<Template, 'id' | 'title' | 'category' | 'format' | 'seconds' | 'referenceViews' | 'video' | 'products' | 'source' | 'description' | 'tags'> & {
  imageHash: string; editedAt: string; shots: ShotRow[];
};

/** Fixture counters use the same explicit source units as the real adapter. */
function fixtureMetric(count: string, source: Template['source']): Template['referenceMetric'] {
  const match = /^(\d+(?:\.\d+)?)([KMB]?)$/.exec(count);
  if (!match) return undefined;
  const scale: Record<string, number> = { '': 1, K: 1000, M: 1000000, B: 1000000000 };
  return { count: Number(match[1]) * scale[match[2]!]!, kind: source === 'topads' ? 'likes' : 'views' };
}

function published({ imageHash, shots, ...seed }: Seed): Template {
  return {
    ...seed, referenceMetric: fixtureMetric(seed.referenceViews, seed.source), referenceImage: sample(imageHash), referenceVideo: seed.video, referenceLikes: seed.id === 'tpl-layering' ? '10.1%' : null, image: sample(imageHash), shots: evenShots(seed.seconds, shots), status: 'published', ownerId: null, timesGenerated: 0,
    preparation: null, preparationNote: null, sample: seed.video ? 'current' : 'none',
  };
}

/**
 * The six templates of the canvas (`docs/design/uretec/parts.py` TEMPLATES): titles, categories, formats, lengths, views word for word.
 * Shot texts of the first two come from the boards `A-Detay` and `A-Sablon-Duzenle`; the others are neutral descriptions.
 * The description and tag of the first one are the text of the board `A-Detay`; the others describe the structure only.
 * After them: the two templates usr-demo made from own videos, one ready and one that did not fit (board `A-Video-Ekle`).
 * `timesGenerated` is filled in by the store from the jobs of the fixtures.
 */
export function templateFixtures(ago: Ago): Template[] {
  return [
    published({
      id: 'tpl-layering', title: 'Fragrance layering recipe', category: 'Fragrance', format: 'no-talking', seconds: 8, referenceViews: '1.9M',
      imageHash: 'f20a7ed7a7bc172a7da483415800077f', video: '/samples/layering.mp4', products: 4, source: 'link', editedAt: ago(9),
      description: 'First the products side by side with the hook text in the middle. Then, on every beat, one product in hand with a small label. No face, no talking, just music.',
      tags: ['Hands and product'],
      shots: [
        ['Products side by side', 'hook text, two lines in the middle', null],
        ['Product 1 in hand', 'product name, top left', 1],
        ['Product 2 in hand', 'product name, bottom right', 2],
        ['Product 3 in hand', 'product name, top center', 3],
        ['Product 4 in hand', 'product name, bottom center', 4],
      ],
    }),
    published({
      id: 'tpl-eye', title: 'Eye close-up with a day counter', category: 'Lashes', format: 'no-talking', seconds: 13, referenceViews: '19.8M',
      imageHash: '1377349dbc87784232ac59cf9cf04986', video: null, products: 1, source: 'topads', editedAt: ago(8),
      description: 'A close-up of an eye comes back on later days from the same angle, with a day counter at the top. The product goes on the lash line and is held next to the eye at the end.',
      tags: ['Face close-up'],
      shots: [
        ['Close-up of one bare eye', 'hook text, middle', null],
        ['Product goes on the lash line', 'day counter, top', 1],
        ['Same angle on a later day', 'day counter, top', null],
        ['Slow look into the camera', 'day counter, top', null],
        ['Product held next to the eye', 'product name, bottom', 1],
      ],
    }),
    published({
      id: 'tpl-story', title: '"I tried it for 4 weeks" presenter story', category: 'Lashes', format: 'talking', seconds: 30, referenceViews: '8.9M',
      imageHash: '874b55ddf9761a230dda46e2aa4afa85', video: '/samples/lashly.mp4', products: 1, source: 'link', editedAt: ago(9),
      description: 'A presenter speaks to the camera and tells the story from start to finish. Close-ups from before and after sit in between, and the product is held up to the camera.',
      tags: ['Presenter'],
      shots: [
        ['Presenter speaks to the camera', 'hook text, top center', null],
        ['Close-up of the eye before', 'none', null],
        ['Close-up of the eye after four weeks', 'none', null],
        ['Product held up to the camera', 'product name, bottom center', 1],
        ['Presenter shows the result', 'closing line, middle', null],
      ],
    }),
    published({
      id: 'tpl-stop', title: 'Dupe comparison', category: 'Fragrance', format: 'no-talking', seconds: 17, referenceViews: '1.9M',
      imageHash: '586c7628c6d07d797378740fedc4c97f', video: null, products: 2, source: 'topads', editedAt: ago(6),
      description: 'The products stand side by side, then each is shown in hand with its name. A line of text compares them before the closing frame.',
      tags: ['Hands and product'],
      shots: [
        ['Two products side by side', 'hook text, top center', null],
        ['Product 1 in hand', 'product name, top left', 1],
        ['Product 2 in hand', 'product name, top left', 2],
        ['Both products held together', 'one line that compares them, middle', null],
        ['Product 2 placed in front', 'closing line, bottom center', 2],
      ],
    }),
    published({
      id: 'tpl-shower', title: 'Shower routine: problem, result, how to use', category: 'Hair', format: 'no-talking', seconds: 15, referenceViews: '12.7M',
      imageHash: 'de5244c861eb9107996b5404d64ca159', video: null, products: 1, source: 'shorts', editedAt: ago(5),
      description: 'The video opens on the hair before, with the problem written on screen. The product is shown in hand and worked in under the shower, and a close-up after closes the video.',
      tags: ['On-screen text'],
      shots: [
        ['Close-up of the hair before', 'the problem, top center', null],
        ['Product in hand in the shower', 'product name, bottom center', 1],
        ['Product worked into the hair', 'how to use, middle', 1],
        ['Hair rinsed', 'none', null],
        ['Close-up of the hair after', 'the result, top center', null],
      ],
    }),
    published({
      id: 'tpl-refused', title: '"I refused to accept it" story and routine', category: 'Hair', format: 'no-talking', seconds: 9, referenceViews: '17.1M',
      imageHash: '619ee0e5a13e318118b291c1451be9b8', video: null, products: 1, source: 'shorts', editedAt: ago(3),
      description: 'A short story in on-screen text opens over a close-up of the hair line. The steps follow in order: the product is picked up, applied and brushed through, and the video ends in front of the mirror.',
      tags: ['On-screen text'],
      shots: [
        ['Close-up of the hair line', 'hook text, two lines in the middle', null],
        ['Product picked up from the shelf', 'product name, bottom center', 1],
        ['Product applied', 'step one, top center', 1],
        ['Hair brushed through', 'step two, top center', null],
        ['Final look in the mirror', 'closing line, middle', null],
      ],
    }),
    { ...privateTemplate('tpl-own-ready', 'usr-demo', ago(7)), preparation: 'ready' },
    {
      ...privateTemplate('tpl-own-failed', 'usr-demo', ago(1)), title: 'Split-screen reaction video', shots: [],
      preparation: 'failed', preparationNote: 'split-screen',
    },
  ];
}

/**
 * What the fake "add your own video" makes from any link: the private template of the board `A-Detay-Ozel`, word for word.
 * It has no category, no reference views, no description, no tags and no sample video. It starts as "preparing"; the catalog turns it ready.
 */
export function privateTemplate(id: Id, ownerId: Id, editedAt: string): Template {
  return {
    id, referenceImage: null, referenceVideo: null, title: 'Desk unboxing in five shots', category: '', format: 'no-talking', seconds: 12, referenceViews: '',
    image: sample('1377349dbc87784232ac59cf9cf04986'), video: null, products: 1, status: 'private', ownerId,
    timesGenerated: 0, editedAt, source: 'link', description: '', tags: [], preparation: 'preparing', preparationNote: null, sample: 'none',
    shots: [
      { n: 1, from: 0, to: 2.1, action: 'Box on the desk, hands enter', text: 'hook text, top center', product: null },
      { n: 2, from: 2.1, to: 4, action: 'Lid comes off', text: 'none', product: null },
      { n: 3, from: 4, to: 6.4, action: 'Product lifted to the camera', text: 'product name, bottom center', product: 1 },
      { n: 4, from: 6.4, to: 9.2, action: 'Close-up of the label', text: 'one benefit, middle', product: 1 },
      { n: 5, from: 9.2, to: 12, action: 'Product placed back, final frame', text: 'closing line, middle', product: 1 },
    ],
  };
}

/** What the fake "prepare" makes from a scan candidate: a template that waits to be published, with a neutral shot list. */
export function candidateTemplate(id: Id, candidate: Candidate, editedAt: string): Template {
  return {
    id, referenceImage: candidate.image, referenceVideo: null, referenceMetric: candidate.referenceMetric ?? fixtureMetric(candidate.views, candidate.source), title: candidate.title, category: '', format: 'no-talking', seconds: candidate.seconds, referenceViews: candidate.views,
    image: candidate.image, video: null, products: 1, status: 'waiting', ownerId: null, timesGenerated: 0, editedAt, source: candidate.source,
    description: '', tags: [], preparation: null, preparationNote: null, sample: 'none',
    shots: evenShots(candidate.seconds, [
      ['Opening shot', 'hook text, top center', null],
      ['Product comes into view', 'none', 1],
      ['Product in use', 'none', 1],
      ['Close-up of the product', 'product name, bottom center', 1],
      ['Final frame', 'closing line, middle', null],
    ]),
  };
}
