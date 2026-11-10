// An Llm that answers from a JSON file: the end-to-end test and offline trials run with no model call.
// { "answers": [ { "match": "<text the prompt contains>", "answer": <any JSON> }, … ] }  — the first entry whose match is in the prompt wins.
import { readFileSync } from 'node:fs';
import type { ZodType } from 'zod';
import { LlmInvalid } from '../ports.ts';
import type { Llm } from '../ports.ts';

interface Entry { match: string; answer: unknown }

function entriesOf(file: string): Entry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new LlmInvalid(`${file}: cannot read the script: ${e instanceof Error ? e.message : String(e)}`);
  }
  const answers = (parsed as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers)) throw new LlmInvalid(`${file}: the script has no "answers" list`);
  return answers.filter((a): a is Entry => typeof a === 'object' && a !== null && typeof (a as Entry).match === 'string');
}

export function createScriptedLlm(file: string): Llm {
  return {
    async run<T>(request: { prompt: string; files: string[]; schema: ZodType<T> }): Promise<T> {
      const head = request.prompt.slice(0, 80);
      const entry = entriesOf(file).find((e) => request.prompt.includes(e.match));
      if (!entry) throw new LlmInvalid(`${file}: no scripted answer for the prompt "${head}"`);
      const parsed = request.schema.safeParse(entry.answer);
      if (!parsed.success) throw new LlmInvalid(`${file}: the answer for "${head}" does not match the schema: ${parsed.error.message}`);
      return parsed.data;
    },
  };
}
