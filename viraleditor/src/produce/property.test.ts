// Whatever the generator answers, over a run and its resumes, with an approval that is not exactly the need, ids that
// look like a retry, and a write of the run that fails once: never more is sent than was approved, no operation key is
// sent twice, every request the generator sees has its row written before it and is made while the run is running,
// nothing is in flight when the handler returns, and what a resume approves is exactly what is not approved yet.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeLlm, FakeMedia, FakeRenderer, FakeTranscriber } from '../adapters/fakes.ts';
import type { Paid } from '../contracts.ts';
import { getRun, stop } from '../db/runs.ts';
import { abs } from '../paths.ts';
import { GeneratorError } from '../ports.ts';
import type { Generated, Generator, GeneratorErrorCode, Measure, OnSubmitted, PaidRequest } from '../ports.ts';
import { paidFor } from '../template/estimate.ts';
import type { Assemble } from './deps.ts';
import { produceHandler } from './index.ts';
import { unsentOf } from './missing.ts';
import { countOf, needsOf } from './plan.ts';
import { attemptOf, countRows, firstKey, operationsOf } from './rows.ts';
import { answerOf, goldenWith, goldenWithStill, inputOf, MEDIA, probesOf, resumeRun, seed, startRun, workspace } from './testing.ts';

type Outcome = 'ok' | GeneratorErrorCode | 'ticket-not-stored' | 'throws';
const AFTER_ACCEPTANCE: Outcome[] = ['ok', 'task-failed', 'empty-result', 'timeout', 'download-failed'];
const FIELDS = ['images', 'clips', 'clipSeconds', 'music', 'voice'] as const;
const FIELD = { image: 'images', clip: 'clips', music: 'music', voice: 'voice' } as const;
const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const outcome: fc.Arbitrary<Outcome> = fc.oneof(
  { weight: 12, arbitrary: fc.constant<Outcome>('ok') },
  { weight: 4, arbitrary: fc.constantFrom<Outcome>('task-failed', 'empty-result', 'timeout', 'download-failed') },
  { weight: 1, arbitrary: fc.constantFrom<Outcome>('rejected', 'upload-failed', 'not-configured', 'submission-unknown', 'ticket-not-stored', 'throws') },
);
/** More approved than needed, in some fields and not in others. */
const slack: fc.Arbitrary<Paid> = fc.record({
  images: fc.constantFrom(0, 0, 1, 2), clips: fc.constantFrom(0, 0, 1, 3), clipSeconds: fc.constantFrom(0, 0, 4, 9), music: fc.constantFrom(0, 0, 1), voice: fc.constantFrom(0, 0, 1),
});

/** The database with its Nth write of a run (`UPDATE runs …`) throwing, once. */
function failingOnce(db: DatabaseSync, nth: number | null): DatabaseSync {
  let writes = 0;
  return new Proxy(db, { get(target, property) {
    const value: unknown = Reflect.get(target, property);
    if (property === 'prepare') return (sql: string) => {
      if (nth !== null && /^UPDATE runs SET/.test(sql) && (writes += 1) === nth) throw new Error('database is locked');
      return target.prepare(sql);
    };
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  } });
}

describe('produce, for any script of generator outcomes', () => {
  it('sent never exceeds approved, no key is sent twice, a row is written before every request, a stop is a stop', async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom('layering-01' as const, 'lashly-01' as const, 'layering-01 with a still' as const),
      fc.constantFrom<1 | 2 | 3>(1, 2, 3),
      fc.array(outcome, { minLength: 1, maxLength: 40 }),
      fc.array(outcome, { minLength: 1, maxLength: 6 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
      fc.boolean(), slack, fc.option(fc.integer({ min: 1, max: 120 }), { nil: null }),
      async (id, variants, script, resumeScript, pictures, retryLikeIds, extra, failedWrite) => {
        const { db } = workspace();
        const clock = new FakeClock();
        // shots r1 … r5 and a segment r2: ids that the old retry suffix would have swallowed
        const renamed = (json: string) => (retryLikeIds ? json.replace(/"s([1-5])"/g, '"r$1"').replace(/"formula"/g, '"r2"') : json);
        // the third template has a still that three first frames are made from: requests that wait for another one of their own step
        const { template, fill } = id === 'layering-01 with a still' ? goldenWithStill(renamed) : goldenWith(id, renamed);
        seed(template, fill);
        const need = paidFor(template, variants);
        const first = Object.fromEntries(FIELDS.map((field) => [field, need[field] + extra[field]])) as unknown as Paid;
        let run = startRun(db, clock, template, inputOf(template, fill, variants), first);
        const needs = [1, 2, 3].slice(0, variants).flatMap((n) => needsOf(template, run.id, n));
        const seconds = new Map(needs.map((each) => [each.key, each.seconds]));
        const billed = (key: string) => seconds.get(firstKey(key)) ?? 0;

        const problems: string[] = [];
        const sentKeys = new Set<string>();
        const accepted = { ...ZERO };
        let calls = 0, resumes = 0, tickets = 0, flying = 0;
        const accept = (paid: PaidRequest) => {
          accepted[FIELD[paid.kind]] += 1;
          if (paid.kind === 'clip') accepted.clipSeconds += paid.request.seconds;
        };

        const submit = async (paid: PaidRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated> => {
          flying += 1;
          try {
            if (flying > 3) problems.push(`${flying} requests in flight`);
            const now = getRun(db, run.id)!;
            if (now.state !== 'running') problems.push(`a ${paid.kind} was requested while the run was ${now.state}`);
            // the moment of the request: its row is there, pending, without a ticket, under a key never sent before
            const wanted = needs.find((candidate) => to.startsWith(abs(candidate.file).replace(/\.[a-z0-9]+$/, '.')));
            const { key, row } = wanted ? attemptOf(db, run.id, wanted.key) : { key: '?', row: null };
            if (!wanted || row === null || row.state !== 'pending' || row.externalId !== null || row.kind !== paid.kind) problems.push(`no pending row before the request for ${to}: ${JSON.stringify(row)}`);
            if (sentKeys.has(key)) problems.push(`${key} was sent twice`);
            sentKeys.add(key);
            const what = script[calls % script.length]!;
            calls += 1;
            await tick();
            if (what === 'throws') throw new Error('the client broke');
            if (what === 'ticket-not-stored') {
              accept(paid);
              throw new GeneratorError('submission-unknown', 'accepted, but the ticket could not be recorded', `ticket-${tickets += 1}`);
            }
            if (!AFTER_ACCEPTANCE.includes(what)) throw new GeneratorError(what as GeneratorErrorCode, `scripted ${what}`);
            const ticket = `ticket-${tickets += 1}`;
            accept(paid);
            // as the real clients do: a ticket that cannot be recorded is an unknown submission that carries it
            try { onSubmitted(ticket); } catch (error) { throw new GeneratorError('submission-unknown', `not recorded (${(error as Error).message})`, ticket); }
            await tick();
            if (what !== 'ok') throw new GeneratorError(what as GeneratorErrorCode, `scripted ${what}`, ticket);
            mkdirSync(dirname(to), { recursive: true });
            writeFileSync(to, MEDIA[paid.kind]);
            return { taskId: ticket, file: to };
          } finally { flying -= 1; }
        };
        const generator: Generator = {
          refusal: () => null,
          image: (request, to, onSubmitted) => submit({ kind: 'image', request }, to, onSubmitted),
          clip: (request, to, onSubmitted) => submit({ kind: 'clip', request }, to, onSubmitted),
          music: (request, to, onSubmitted) => submit({ kind: 'music', request }, to, onSubmitted),
          voice: (request, to, onSubmitted) => submit({ kind: 'voice', request }, to, onSubmitted),
          resume: async (ticket, to) => {
            flying += 1;
            try {
              const what = resumeScript[resumes % resumeScript.length]!;
              resumes += 1;
              await tick();
              if (what === 'throws') throw new Error('the client broke');
              if (what !== 'ok') throw new GeneratorError(what === 'ticket-not-stored' ? 'timeout' : what, `scripted ${what}`, ticket);
              mkdirSync(dirname(to), { recursive: true });
              writeFileSync(to, MEDIA[needs.find((candidate) => to.startsWith(abs(candidate.file).replace(/\.[a-z0-9]+$/, '.')))!.kind]);
              return { taskId: ticket, file: to };
            } finally { flying -= 1; }
          },
          ready: async () => ({ ready: true, note: null }),
        };
        let pictured = 0;
        const assemble: Assemble = async (deps, _run, _template, media) => {
          deps.onRender?.();
          const ok = pictures[pictured % pictures.length]!;
          pictured += 1;
          return ok ? { ok: true, video: `${media.dir}/final.mp4`, image: `${media.dir}/poster.jpg` } : { ok: false, reason: 'render-failed' };
        };
        const handler = produceHandler({
          db: failingOnce(db, failedWrite), clock, generator, assemble, llm: new FakeLlm([answerOf(fill, variants)]), measure: {} as Measure,
          renderer: new FakeRenderer(), transcriber: new FakeTranscriber(), media: new FakeMedia({ probes: { by: probesOf(fill) } }),
        });

        for (let round = 0; round < 4; round += 1) {
          const approved = run.approved!;
          // a handler that throws is the worker loop's to stop: it does so with `engine-error`
          try { await handler(run); } catch { stop(db, run.id, 'engine-error', null, clock.now()); }
          expect(flying).toBe(0);                                                            // nothing is in flight when the handler returns
          const requested = calls;
          for (let i = 0; i < 8; i += 1) await tick();
          expect(calls).toBe(requested);                                                     // and nothing is requested afterwards
          const after = getRun(db, run.id)!;
          expect(problems).toEqual([]);
          expect(after.state === 'done' || after.state === 'stopped').toBe(true);
          const rows = operationsOf(db, run.id);
          expect(rows.length).toBe(sentKeys.size);                                           // a row for every request, a request for every row
          const used = countRows(rows, billed, 'spent');
          for (const field of FIELDS) expect(used[field]).toBeLessThanOrEqual(approved[field]);
          // `sent` is what the provider accepted. The one exception: the count itself was the write that failed; the next call puts it right from the rows.
          const sent = after.sent ?? ZERO;
          for (const field of FIELDS) {
            expect(sent[field]).toBeLessThanOrEqual(approved[field]);
            expect(sent[field]).toBeLessThanOrEqual(accepted[field]);
            if (failedWrite === null) expect(sent[field]).toBe(accepted[field]);
          }
          if (after.state === 'done') {
            expect(after.variants.every((variant) => variant.status === 'done')).toBe(true);
            expect(after.result).toMatchObject({ variants: { length: variants } });
            for (const field of FIELDS) expect(sent[field]).toBeGreaterThanOrEqual(need[field]);
            expect(after.missing).toBeNull();
            break;
          }
          // stopped: the finished variants are the result, and nothing of the run is shown as under way
          if (after.variants.length > 0) {
            expect(after.variants.filter((variant) => variant.status !== 'done' && variant.status !== 'stopped')).toEqual([]);
            expect(after.steps.filter((step) => step.status === 'running').map((step) => step.key)).toEqual([]);
          }
          // what a resume approves: exactly what is not approved yet (nothing for a run with an unknown submission)
          if (after.missing !== null) {
            const open = after.variants.filter((variant) => variant.status !== 'done').map((variant) => variant.n);
            const toSend = countOf(unsentOf(db, run.id, needs.filter((each) => open.includes(each.n))));
            const unknown = rows.some((row) => row.state === 'unknown');
            for (const field of FIELDS) {
              expect(after.missing[field]).toBe(unknown ? 0 : Math.max(0, toSend[field] - (approved[field] - sent[field])));
            }
          }
          run = resumeRun(db, clock, run.id);                                                // the customer continues: what is missing is approved
        }
      },
    ), { numRuns: 120, examples: [
      // found by this property: the write of the variants failed inside the stop, and the second try wrote nothing
      ['layering-01', 1, ['ok', 'timeout', 'ok'], ['task-failed', 'ok'], [false], false, { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 }, 28],
    ] });
  }, 300_000);
});
