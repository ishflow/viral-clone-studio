import { existsSync } from 'node:fs';
import { pathOf as placeOf } from '../../edit/schema.ts';
import { needsOf } from '../../produce/plan.ts';
import { paidFor } from '../../template/estimate.ts';
import { Template } from '../../template/schema.ts';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { Stop, issue } from '../issue.ts';
import { isFolder, pathOf, readJson } from '../project.ts';

const LISTED = 20;
const KINDS = ['image', 'clip', 'music', 'voice'] as const;

export const plan: Command<Context> = {
  name: 'plan',
  summary: 'What a job of a template would ask from the paid services: how many images, clips (with the seconds each is billed), music and voice requests, per variant. It reads the template and counts; nothing is sent and nothing is paid.',
  args: [{ name: 'template.json', help: 'the template of the pipeline (not an edit document)' }],
  flags: [{ name: 'variants', type: 'integer', min: 1, max: 3, default: 1, value: '<n>', help: 'how many variants of the video the job makes' }],
  async run(input, context) {
    const file = pathOf(context, input.args['template.json']!);
    if (!existsSync(file) || isFolder(file)) throw new Stop([issue('file-missing', { target: file }, `The template is not there: ${file}.`, 'Give the path of a template.json: the file the pipeline keeps for one video structure.')]);
    const json = readJson(file, 'The template');
    const parsed = Template.safeParse(json);
    if (!parsed.success) {
      const isEdit = typeof json === 'object' && json !== null && Object.hasOwn(json, 'version') && Object.hasOwn(json, 'media');
      const fix = isEdit ? 'This is an edit document, not a template: an edit document asks nothing from a paid service. Check it with `viraleditor check`.' : undefined;
      throw new Stop(parsed.error.issues.slice(0, LISTED).map((fault) => issue('template-invalid', { path: placeOf(fault.path) }, `${file}: ${placeOf(fault.path)}: ${fault.message}`, fix)));
    }
    const template = parsed.data;
    const variants = input.flags.variants as number;
    const needs = Array.from({ length: variants }, (_, n) => needsOf(template, 'plan', n + 1)).flat();
    return {
      result: {
        template: file, id: template.id, mode: template.mode, variants,
        paid: paidFor(template, variants),                 // what the pipeline may send at most: the customer sees these numbers before a job starts
        requests: Object.fromEntries(KINDS.map((kind) => [kind, needs.filter((need) => need.kind === kind).map((need) => ({
          variant: need.n, for: need.id ?? 'the video', ...(kind === 'clip' ? { seconds: need.seconds } : {}),
        }))])),
        sent: 0,
        next: 'Nothing was sent. A job of this template is started by the pipeline, not by this command line.',
      },
    };
  },
};
