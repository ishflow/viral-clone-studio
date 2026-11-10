import { describe, expect, it } from 'vitest';
import { FakeGenerator } from '../adapters/fakes.ts';
import { refusalOf } from '../adapters/routes.ts';
import type { Generator } from '../ports.ts';
import { planOf } from './plan.ts';
import { dryRun, requestProblem, within } from './preflight.ts';
import { golden, goldenWithStill, seed, workspace } from './testing.ts';

workspace();
const FAST = { model: 'seedance-2-mini', resolution: '720p' };

describe('dryRun: what the customer\'s copy can break is found before anything is paid', () => {
  it.each(['layering-01', 'lashly-01'] as const)('%s: the golden fill passes', (id) => {
    const { template, fill } = golden(id);
    expect(dryRun(template, fill)).toEqual({ problems: [], notes: [] });
  });

  it('a fill that is not complete for the template', () => {
    const { template, fill } = golden('layering-01');
    delete fill.texts['name-2'];
    expect(dryRun(template, fill).problems[0]).toMatch(/^fill-missing: /);
  });

  it('a copy that cannot fit its box', () => {
    const { template, fill } = golden('layering-01');
    fill.texts.hook = 'the most unbelievably long compliment-magnet scent layering combination that anybody has ever written on a screen '.repeat(2).trim().slice(0, 200);
    const { problems } = dryRun(template, fill);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toMatch(/texts\[0\]|hook/);
  });

  it('a script that lost a mark', () => {
    const { template, fill } = golden('lashly-01');
    fill.script!.formula = fill.script!.formula!.replace('[name]', '').replace('[/name]', '');
    expect(dryRun(template, fill).problems[0]).toMatch(/^mark-lost: /);
  });

  it('keeps what checkFill says the customer will not see', () => {
    const { template, fill } = golden('lashly-01');
    fill.products[0]!.images = [fill.products[0]!.images[0]!];
    const { problems, notes } = dryRun(template, fill);
    expect(problems).toEqual([]);
    expect(notes.map((note) => note.code)).toEqual(['left-out', 'left-out']);
  });
});

describe('requestProblem: what the provider or the disk would refuse', () => {
  const real: Generator = Object.assign(new FakeGenerator(), { refusal: refusalOf });        // the rules of the real client

  it('nothing for the golden plans with the tiers of the settings', () => {
    for (const id of ['layering-01', 'lashly-01'] as const) {
      const { template, fill } = golden(id);
      seed(template, fill);
      expect(requestProblem(real, planOf(template, fill, 'r1', 1, FAST))).toBeNull();
    }
  });

  it('a first frame that is made from a still: nothing, as long as the request that makes the still stands before it', () => {
    const { template, fill } = goldenWithStill();
    seed(template, fill);
    const plan = planOf(template, fill, 'r1', 1, FAST);
    expect(requestProblem(real, plan)).toBeNull();
    expect(requestProblem(real, [...plan.slice(1), plan[0]!])).toMatch(/v1:image:s2: it reads image-lead\.png, which is not there/);
  });

  it('a model that cannot make a talking clip', () => {
    const { template, fill } = golden('lashly-01');
    seed(template, fill);
    expect(requestProblem(real, planOf(template, fill, 'r1', 1, { model: 'kling-v3-pro', resolution: '1080p' }))).toMatch(/v1:clip:s1.*first frame only/);
  });

  it('a clip longer than the model takes', () => {
    const { template, fill } = golden('lashly-01');
    seed(template, fill);
    const plan = planOf(template, fill, 'r1', 1, FAST).map((item) => (item.paid.kind === 'clip' ? { ...item, paid: { ...item.paid, request: { ...item.paid.request, seconds: 16 } } } : item));
    expect(requestProblem(real, plan)).toMatch(/4 to 15 whole seconds/);
  });

  it('a photograph of the customer that is not on the disk', () => {
    const { template, fill } = golden('layering-01');
    seed(template, fill);
    fill.products[2]!.images = ['uploads/seed/layering-01/never-uploaded.png'];
    expect(requestProblem(real, planOf(template, fill, 'r1', 1, FAST))).toMatch(/never-uploaded\.png/);
  });

  it('two requests under one key (a still named like the presenter still)', () => {
    const { template, fill } = golden('lashly-01');
    seed(template, fill);
    const plan = planOf(template, fill, 'r1', 1, FAST);
    expect(requestProblem(real, [...plan, plan[1]!])).toMatch(/v1:image:proof-before.*twice/);
  });

  it('asks the generator about every request, and sends none', () => {
    const { template, fill } = golden('layering-01');
    seed(template, fill);
    const generator = new FakeGenerator({ refusals: { clip: { 4: 'no such model' } } });
    expect(requestProblem(generator, planOf(template, fill, 'r1', 1, FAST))).toMatch(/v1:clip:s4: no such model/);
    expect(generator.calls.every((call) => call.kind === 'refusal')).toBe(true);
  });
});

describe('within', () => {
  const need = { images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 };
  it('every field of the need is inside the approval', () => {
    expect(within(need, need)).toBe(true);
    expect(within(need, { ...need, images: 9 })).toBe(true);
    for (const field of ['images', 'clips', 'clipSeconds', 'music'] as const) expect(within(need, { ...need, [field]: need[field] - 1 })).toBe(false);
    expect(within({ ...need, voice: 1 }, need)).toBe(false);
    expect(within(need, null)).toBe(false);
  });
});
