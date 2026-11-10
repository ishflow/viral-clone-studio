import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { LlmInvalid } from '../ports.ts';
import { createScriptedLlm } from './scripted-llm.ts';

const dir = mkdtempSync(join(tmpdir(), 'vc-sllm-'));
const file = join(dir, 'script.json');
const write = (v: unknown) => writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v));
const schema = z.object({ n: z.number() });

describe('createScriptedLlm', () => {
  it('answers from the matching entry', async () => {
    write({ answers: [{ match: 'alpha', answer: { n: 1 } }] });
    expect(await createScriptedLlm(file).run({ prompt: 'an alpha prompt', files: [], schema })).toEqual({ n: 1 });
  });
  it('takes the first of two matches', async () => {
    write({ answers: [{ match: 'a', answer: { n: 1 } }, { match: 'alpha', answer: { n: 2 } }] });
    expect(await createScriptedLlm(file).run({ prompt: 'alpha', files: [], schema })).toEqual({ n: 1 });
  });
  it('re-reads the file on every call', async () => {
    const llm = createScriptedLlm(file);
    write({ answers: [{ match: 'x', answer: { n: 1 } }] });
    expect(await llm.run({ prompt: 'x', files: [], schema })).toEqual({ n: 1 });
    write({ answers: [{ match: 'x', answer: { n: 5 } }] });
    expect(await llm.run({ prompt: 'x', files: [], schema })).toEqual({ n: 5 });
  });
  it('no match: LlmInvalid naming the file and the start of the prompt', async () => {
    write({ answers: [] });
    const err = await createScriptedLlm(file).run({ prompt: 'p'.repeat(100), files: [], schema }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmInvalid);
    expect(err.message).toContain(file);
    expect(err.message).toContain('p'.repeat(80));
    expect(err.message).not.toContain('p'.repeat(81));
  });
  it('an answer the schema refuses: LlmInvalid', async () => {
    write({ answers: [{ match: 'x', answer: { n: 'no' } }] });
    const err = await createScriptedLlm(file).run({ prompt: 'x', files: [], schema }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmInvalid);
    expect(err.message).toContain(file);
  });
  it('a file that is not JSON: LlmInvalid', async () => {
    write('not json');
    const err = await createScriptedLlm(file).run({ prompt: 'x', files: [], schema }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmInvalid);
    expect(err.message).toContain(file);
  });
});
