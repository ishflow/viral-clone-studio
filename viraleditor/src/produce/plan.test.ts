import { describe, expect, it } from 'vitest';
import { refusalOf } from '../adapters/routes.ts';
import { abs } from '../paths.ts';
import { paidFor } from '../template/estimate.ts';
import { countOf, needOfFaulty, needsOf, planOf } from './plan.ts';
import { golden, goldenWithParts, goldenWithPartsAndStill, goldenWithStill, workspace } from './testing.ts';

workspace();
const FAST = { model: 'seedance-2-mini', resolution: '720p' };
const BEST = { model: 'seedance-2.5-pro', resolution: '1080p' };

describe('needsOf', () => {
  it('beats: one image and one clip per shot, one music, under the keys of the operations table', () => {
    const { template } = golden('layering-01');
    const needs = needsOf(template, 'r1', 2);
    expect(needs.map((need) => need.key)).toEqual([
      'v2:image:s1', 'v2:image:s2', 'v2:image:s3', 'v2:image:s4', 'v2:image:s5',
      'v2:clip:s1', 'v2:clip:s2', 'v2:clip:s3', 'v2:clip:s4', 'v2:clip:s5', 'v2:music',
    ]);
    expect(needs.find((need) => need.key === 'v2:clip:s3')).toEqual({ n: 2, key: 'v2:clip:s3', kind: 'clip', id: 's3', seconds: 4, file: 'jobs/r1/paid/v2/clip-s3.mp4' });
    expect(needs.find((need) => need.key === 'v2:image:s1')?.file).toBe('jobs/r1/paid/v2/image-s1.png');
    expect(needs.at(-1)).toEqual({ n: 2, key: 'v2:music', kind: 'music', id: null, seconds: 0, file: 'jobs/r1/paid/v2/music.mp3' });
  });

  it('speech: the presenter still, every generated still, the voice, one clip per shot, one music', () => {
    const { template } = golden('lashly-01');
    expect(needsOf(template, 'r1', 1).map((need) => need.key)).toEqual([
      'v1:image:presenter', 'v1:image:proof-before', 'v1:image:proof-after', 'v1:voice', 'v1:clip:s1', 'v1:clip:s2', 'v1:clip:s3', 'v1:music',
    ]);
  });

  it('beats with stills: the stills first, in the template\'s order, then one image and one clip per shot, one music', () => {
    const { template } = goldenWithStill();
    const needs = needsOf(template, 'r1', 1);
    expect(needs.map((need) => need.key)).toEqual([
      'v1:image:lead', 'v1:image:s1', 'v1:image:s2', 'v1:image:s3', 'v1:image:s4', 'v1:image:s5',
      'v1:clip:s1', 'v1:clip:s2', 'v1:clip:s3', 'v1:clip:s4', 'v1:clip:s5', 'v1:music',
    ]);
    expect(needs[0]).toEqual({ n: 1, key: 'v1:image:lead', kind: 'image', id: 'lead', seconds: 0, file: 'jobs/r1/paid/v1/image-lead.png' });
  });

  it('beats with shots that continue a clip: an image and a clip for each shot that owns a clip, nothing for a part', () => {
    const { template } = goldenWithParts();
    const needs = needsOf(template, 'r1', 1);
    expect(needs.map((need) => need.key)).toEqual(['v1:image:s1', 'v1:image:s4', 'v1:image:s5', 'v1:clip:s1', 'v1:clip:s4', 'v1:clip:s5', 'v1:music']);
    expect(needs.find((need) => need.key === 'v1:clip:s1')?.seconds).toBe(5);
    // a fault in the clip of s1 (which s2 and s3 also show) is the request of s1
    expect(needOfFaulty(template, needs, { kind: 'clip', id: 's1' })?.key).toBe('v1:clip:s1');
    expect(needOfFaulty(template, needs, { kind: 'clip', id: 's2' })).toBeUndefined();
  });
  it('beats with a still and shots that continue a clip: the still first, then an image and a clip for each owner only', () => {
    const { template } = goldenWithPartsAndStill();
    const needs = needsOf(template, 'r1', 1);
    expect(needs.map((need) => need.key)).toEqual(['v1:image:lead', 'v1:image:s1', 'v1:image:s4', 'v1:image:s5', 'v1:clip:s1', 'v1:clip:s4', 'v1:clip:s5', 'v1:music']);
    expect(countOf(needs)).toEqual({ images: 4, clips: 3, clipSeconds: 13, music: 1, voice: 0 });
    expect(countOf([1, 2].flatMap((n) => needsOf(template, 'r1', n)))).toEqual({ images: 8, clips: 6, clipSeconds: 26, music: 2, voice: 0 });
  });
  it.each([['layering-01', golden('layering-01')], ['lashly-01', golden('lashly-01')], ['layering-01 with a still', goldenWithStill()], ['layering-01 with parts', goldenWithParts()], ['layering-01 with parts and a still', goldenWithPartsAndStill()]] as const)('%s: the needs of a variant count exactly what paidFor says', (_name, { template }) => {
    expect(countOf(needsOf(template, 'r1', 1))).toEqual(paidFor(template, 1));
    expect(countOf([1, 2, 3].flatMap((n) => needsOf(template, 'r1', n)))).toEqual(paidFor(template, 3));
  });

  it('needOfFaulty: a faulty image is the request of its id, a still like the first frame of a shot', () => {
    const { template } = goldenWithStill();
    const needs = needsOf(template, 'r1', 1);
    expect(needOfFaulty(template, needs, { kind: 'image', id: 'lead' })?.key).toBe('v1:image:lead');
    expect(needOfFaulty(template, needs, { kind: 'image', id: 's2' })?.key).toBe('v1:image:s2');
    expect(needOfFaulty(template, needs, { kind: 'image', id: 'nobody' })).toBeUndefined();
  });

  it('a clip of 2.5 s bills 4 s, one of 6.2 s bills 7 s', () => {
    const { template } = golden('layering-01');
    template.shots[0]!.clip_seconds = 2.5; template.shots[1]!.clip_seconds = 6.2;
    expect(needsOf(template, 'r1', 1).filter((need) => need.kind === 'clip').map((need) => need.seconds)).toEqual([4, 7, 4, 4, 4]);
  });
});

describe('planOf', () => {
  it('beats with a still and shots that continue a clip: only owners get a first frame and a clip, and only they wait for the still', () => {
    const { template, fill } = goldenWithPartsAndStill();
    const plan = planOf(template, fill, 'r1', 1, FAST);
    expect(plan.map((item) => item.key)).toEqual(needsOf(template, 'r1', 1).map((need) => need.key));
    const by = Object.fromEntries(plan.map((item) => [item.key, item]));
    const lead = abs('jobs/r1/paid/v1/image-lead.png');
    expect(by['v1:image:s1']).toMatchObject({ needs: ['v1:image:lead'], paid: { request: { references: [lead, ...fill.products.map((product) => abs(product.images[0]!))] } } });   // s1 names all four products
    expect(by['v1:image:s4']!.needs).toEqual(['v1:image:lead']);
    expect(by['v1:image:s5']!.needs).toEqual([]);
    expect(by['v1:clip:s1']).toMatchObject({ needs: ['v1:image:s1'], paid: { request: { firstFrame: abs('jobs/r1/paid/v1/image-s1.png') } } });
    for (const item of plan) expect(refusalOf(item.paid)).toBeNull();
  });
  it('beats: the still from the fill and the first photograph of every product the shot names, then the clip from that still', () => {
    const { template, fill } = golden('layering-01');
    const plan = planOf(template, fill, 'r1', 1, FAST);
    const by = Object.fromEntries(plan.map((item) => [item.key, item]));
    expect(by['v1:image:s1']).toMatchObject({
      needs: [],
      paid: { kind: 'image', request: { prompt: fill.shots.s1!.still_prompt, aspect: '9:16', references: fill.products.map((product) => abs(product.images[0]!)) } },
    });
    expect(by['v1:image:s3']!.paid).toMatchObject({ request: { references: [abs(fill.products[1]!.images[0]!)] } });
    expect(by['v1:clip:s3']).toMatchObject({
      needs: ['v1:image:s3'],
      paid: { kind: 'clip', request: { mode: 'first-frame', firstFrame: abs('jobs/r1/paid/v1/image-s3.png'), prompt: fill.shots.s3!.motion_prompt, seconds: 4, tier: FAST } },
    });
    expect(by['v1:music']).toMatchObject({ needs: [], paid: { kind: 'music', request: { prompt: fill.music.prompt } } });
  });

  it('beats with stills: a first frame is made from the stills its shot names, in that order, then from the photographs; a still is planned as in speech', () => {
    const { template, fill } = goldenWithStill();
    template.stills!.push({ id: 'room', prompt: 'A bedroom.', references: ['still:lead', 'product:1'] });
    template.shots[4]!.stills = ['room', 'lead'];
    fill.stills!.room = { prompt: 'A bedroom with a made bed.' };
    const plan = planOf(template, fill, 'r1', 1, FAST);
    const by = Object.fromEntries(plan.map((item) => [item.key, item]));
    const lead = abs('jobs/r1/paid/v1/image-lead.png'), room = abs('jobs/r1/paid/v1/image-room.png');
    const photograph = (n: number) => abs(fill.products[n - 1]!.images[0]!);
    expect(by['v1:image:lead']).toMatchObject({ needs: [], paid: { kind: 'image', request: { prompt: fill.stills!.lead!.prompt, references: [], aspect: '9:16' } } });
    expect(by['v1:image:room']).toMatchObject({ needs: ['v1:image:lead'], paid: { request: { prompt: 'A bedroom with a made bed.', references: [lead, photograph(1)] } } });
    expect(by['v1:image:s2']).toMatchObject({ needs: ['v1:image:lead'], paid: { kind: 'image', request: { prompt: fill.shots.s2!.still_prompt, references: [lead, photograph(1)], aspect: '9:16' } } });
    expect(by['v1:image:s5']).toMatchObject({ needs: ['v1:image:room', 'v1:image:lead'], paid: { request: { references: [room, lead, photograph(4)] } } });
    // a shot without stills is made from its photographs alone, as before
    expect(by['v1:image:s1']).toMatchObject({ needs: [], paid: { request: { references: fill.products.map((product) => abs(product.images[0]!)) } } });
    expect(by['v1:image:s4']).toMatchObject({ needs: [], paid: { request: { references: [photograph(3)] } } });
    expect(by['v1:clip:s2']).toMatchObject({ needs: ['v1:image:s2'], paid: { request: { firstFrame: abs('jobs/r1/paid/v1/image-s2.png') } } });
    for (const item of plan) expect(refusalOf(item.paid)).toBeNull();
    expect(plan.map((item) => item.key)).toEqual(needsOf(template, 'r1', 1).map((need) => need.key));
  });

  it('beats: a still that is called "presenter" is a still like any other', () => {
    const { template, fill } = JSON.parse(JSON.stringify(goldenWithStill()).replaceAll('"lead"', '"presenter"')) as ReturnType<typeof goldenWithStill>;
    const [still] = planOf(template, fill, 'r1', 1, FAST);
    expect(still).toMatchObject({ key: 'v1:image:presenter', needs: [], paid: { request: { prompt: fill.stills!.presenter!.prompt, references: [] } } });
  });

  it('speech: the presenter from its photographs, a still from the still it names, the voice sample, talking clips that speak the lines', () => {
    const { template, fill } = golden('lashly-01');
    const plan = planOf(template, fill, 'r1', 1, BEST);
    const by = Object.fromEntries(plan.map((item) => [item.key, item]));
    expect(by['v1:image:presenter']!.paid).toEqual({ kind: 'image', request: { prompt: fill.presenter!.still_prompt, references: [abs(fill.products[0]!.images[0]!)], aspect: '9:16' } });
    expect(by['v1:image:proof-before']).toMatchObject({ needs: [], paid: { request: { prompt: fill.stills!['proof-before']!.prompt, references: [] } } });
    expect(by['v1:image:proof-after']).toMatchObject({ needs: ['v1:image:proof-before'], paid: { request: { references: [abs('jobs/r1/paid/v1/image-proof-before.png')] } } });
    expect(by['v1:voice']!.paid).toEqual({ kind: 'voice', request: { text: template.presenter!.voice.sample_text, voiceId: template.presenter!.voice.voice_id } });
    const clip = by['v1:clip:s2']!;
    expect(clip.needs).toEqual(['v1:image:presenter', 'v1:voice']);
    expect(clip.paid).toMatchObject({ kind: 'clip', request: { mode: 'speaker', presenter: abs('jobs/r1/paid/v1/image-presenter.png'), voice: abs('jobs/r1/paid/v1/voice.mp3'), seconds: 9, tier: BEST, aspect: '9:16' } });
    const prompt = (clip.paid.request as { prompt: string }).prompt;
    expect(prompt).toContain(fill.shots.s2!.motion_prompt);
    expect(prompt).toContain("It's the Lashly serum from ACME. Aloe, shea, jojoba, and you just swipe it on your lash line every night, like eyeliner.");
    expect(prompt).not.toMatch(/\[\/?[a-z]/);                         // no mark reaches the provider
  });

  it.each([['layering-01', FAST], ['layering-01', BEST], ['lashly-01', FAST], ['lashly-01', BEST]] as const)('%s with the tier %o: the provider would take every request', (id, tier) => {
    const { template, fill } = golden(id);
    for (const item of planOf(template, fill, 'r1', 1, tier)) expect(refusalOf(item.paid)).toBeNull();
  });

  it('a shot that names "all" takes the products the customer gave; a photograph the customer did not give falls back to the first', () => {
    const { template, fill } = golden('lashly-01');
    template.presenter!.references = ['product:1.2', 'product:1.5'];
    const plan = planOf(template, fill, 'r1', 1, FAST);
    expect((plan[0]!.paid.request as { references: string[] }).references).toEqual([abs(fill.products[0]!.images[1]!), abs(fill.products[0]!.images[0]!)]);
  });
});
