import { existsSync, readFileSync } from 'node:fs';
import { AlignError } from '../../adapters/aligner.ts';
import { TranscribeError } from '../../adapters/transcriber.ts';
import type { AlignedWord, Word } from '../../ports.ts';
import { ResolveError } from '../../resolve/error.ts';
import { parseScript } from '../../resolve/script.ts';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { Stop, issue } from '../issue.ts';
import type { Issue } from '../issue.ts';
import { isFolder, pathOf } from '../project.ts';
import { streamsOf } from './probe.ts';

const FPS = 30;          // the frames of an edit document: 30 per second on both canvases

/** A word as the edit document counts it: the frame it starts on and its length in frames (at least one). */
export function framesOf(word: Word): { frame: number; frames: number } {
  const frame = Math.round(word.start * FPS);
  return { frame, frames: Math.max(1, Math.round(word.end * FPS) - frame) };
}

export const words: Command<Context> = {
  name: 'words',
  summary: 'The times of the spoken words in a sound: each word with its start and end in seconds, the frame it starts on and its length in frames, ready to copy into captions.words, a card or a window. With --script the words of that script are placed on the sound (exact to a few hundredths); without it the transcriber finds the words (its times can be up to a second early after a pause).',
  args: [{ name: 'media', help: 'a video with its own sound, or a sound file' }],
  flags: [
    { name: 'script', type: 'string', value: '<file>', help: 'a text file with the spoken words; [marks] and line breaks are not words' },
    { name: 'language', type: 'string', value: '<code>', default: 'en', help: 'the language spoken' },
  ],
  async run(input, context) {
    const media = pathOf(context, input.args.media!);
    const language = input.flags.language as string;
    if (isFolder(media)) throw new Stop([issue('argument-value', { target: '<media>' }, `${media} is a folder; words reads one video or sound file.`, 'Give the file the voice is on.')]);
    const facts = await streamsOf(context, media);
    if (facts.sound === null) throw new Stop([issue('media-silent', { target: media }, `${media} has no sound track: there are no spoken words in it.`)]);

    const started = context.clock.now().getTime();
    let found: AlignedWord[] | Word[];
    let source: 'aligner' | 'transcriber';
    if (input.flags.script === undefined) {
      source = 'transcriber';
      found = await context.tools.transcriber.words(media, language).catch((error: unknown) => { throw fromTool(error, 'the transcriber'); });
    } else {
      source = 'aligner';
      const file = pathOf(context, input.flags.script as string);
      if (!existsSync(file) || isFolder(file)) throw new Stop([issue('file-missing', { target: file }, `--script of words is a file with the spoken words, but ${file} is ${isFolder(file) ? 'a folder' : 'not there'}.`)]);
      let spoken: string[];
      try { spoken = parseScript(readFileSync(file, 'utf8')).words; } catch (error) {
        if (error instanceof ResolveError) throw new Stop([issue('script-invalid', { target: file }, `The script ${file}: ${error.message}`)]);
        throw error;
      }
      if (spoken.length === 0) throw new Stop([issue('script-empty', { target: file }, `The script ${file} has no word in it.`)]);
      const ready = await context.tools.aligner.ready();
      if (!ready.ready) throw new Stop([issue('aligner-missing', { target: 'aligner' }, `The aligner is not ready: ${ready.note ?? 'no reason given'}.`)]);
      found = await context.tools.aligner.align(media, spoken, language).catch((error: unknown) => { throw fromTool(error, 'the aligner'); });
    }

    const warnings: Issue[] = [];
    const list = found.map((word, i) => {
      const score = 'score' in word ? { score: word.score } : {};
      if ('score' in word && word.score === 0) warnings.push(issue('word-unplaced', { target: `words[${i}]` }, `The word "${word.text}" (number ${i + 1}) was not placed by the aligner: its time is shared out from its neighbours.`));
      return { text: word.text, start: word.start, end: word.end, ...framesOf(word), ...score };
    });
    return {
      warnings,
      result: {
        words: list, source, seconds: Number(((context.clock.now().getTime() - started) / 1000).toFixed(1)),
        next: 'Copy `text`, `frame` (at) and `frames` (for) into captions.words, or put a card or a window on the frame of the word it belongs to. `viraleditor frames` with that frame shows it.',
      },
    };
  },
  text(result) {
    const { words: list, source } = result as { words: { text: string; frame: number; frames: number }[]; source: string };
    return [`${list.length} words (${source})`, ...list.map((w) => `  frame ${String(w.frame).padStart(4)}  ${String(w.frames).padStart(3)} frames  ${w.text}`)].join('\n');
  },
};

/** What a word tool threw, as an issue to stop with; the errors it does not know pass through. */
function fromTool(error: unknown, who: string): unknown {
  if (error instanceof AlignError) {
    if (error.code === 'language-unsupported') return new Stop([issue('language-unsupported', { target: '--language' }, `${who} has no model for this language: ${error.message}`)]);
    if (error.code === 'not-installed') return new Stop([issue('aligner-missing', { target: 'aligner' }, `The aligner is not set up: ${error.message}`)]);
    if (error.code === 'bad-media') return new Stop([issue('media-unreadable', { target: 'media' }, `The aligner cannot read the media: ${error.message}`)]);
    return new Stop([issue('tool-failed', { target: 'aligner' }, `The aligner failed: ${error.message}`)]);
  }
  if (error instanceof TranscribeError) return new Stop([issue('tool-failed', { target: 'transcriber' }, `The transcriber failed: ${error.message}`)]);
  return error;
}
