// The model writes template.json. What the handler knows (the id, the source) it writes itself; an answer that carries
// something of the reference, or a placeholder where none is replaced, is refused and the model is asked once more.
import { LlmInvalid } from '../ports.ts';
import type { Llm } from '../ports.ts';
import { Template } from '../template/schema.ts';
import type { TemplateJson } from '../template/schema.ts';
import { referenceOf, refusalsOf } from './brand.ts';
import type { Again } from './prompts.ts';
import { EXAMPLE_NAMES, refusedPrompt, VOICE_ID, writePrompt } from './prompts.ts';
import type { Look } from './read.ts';
import type { Scored } from './score.ts';

export interface TemplateWriter {
  /** A template that passed its schema and the rules of brand.ts. `again`: the answer of an earlier call and what the check found in it. Throws LlmInvalid. */
  write(again: Again | null): Promise<TemplateJson>;
}

/**
 * The writer of one run. `pictures` are the only files of the reference the model is given: for a beats template the shot
 * sheets, whose shots it has to keep, for a speech template the frame sheet. In a run it re-asks once for a
 * refused answer, whichever call that happens in: with the one re-ask the handler makes after a failed check, a run sends
 * at most three template requests.
 */
export function templateWriter(llm: Llm, look: Look, pictures: string[], scored: Pick<Scored, 'mode' | 'brands'>, facts: { id: string; source: TemplateJson['source'] }): TemplateWriter {
  const reference = referenceOf(look, scored.brands);
  const kept = { ...reference, names: [...reference.names, ...EXAMPLE_NAMES] };   // the invented names of the prompt's example are not borrowed either
  let reasks = 1;
  return {
    async write(again) {
      const prompt = writePrompt(look, scored.mode, reference.names, facts.id, again);
      let asked = prompt;
      for (;;) {
        const answer = await llm.run({ prompt: asked, files: pictures, schema: Template });
        const template: TemplateJson = { ...answer, id: facts.id, source: facts.source, ...(answer.presenter === undefined ? {} : { presenter: { ...answer.presenter, voice: { ...answer.presenter.voice, voice_id: VOICE_ID } } }) };
        const findings = refusalsOf(template, kept);
        if (findings.length === 0) return template;
        if (reasks === 0) throw new LlmInvalid(`the template still breaks a rule: ${findings.map((finding) => `${finding.path} (${finding.kind})`).join(', ')}`, 'template-rule');
        reasks -= 1;
        asked = `${prompt}\n\n${refusedPrompt(findings)}`;
      }
    },
  };
}
