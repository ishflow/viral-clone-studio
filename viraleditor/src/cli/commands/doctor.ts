import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HYPERFRAMES_VERSION } from '../../adapters/renderer.ts';
import { fontFiles } from '../../compose/css.ts';
import type { Context, ToolName } from '../context.ts';
import type { Command } from '../framework.ts';
import { issue } from '../issue.ts';
import type { Issue } from '../issue.ts';

const FAST_MS = 2 * 60_000;
const FONTS = ['Inter', 'Montserrat'] as const;
interface Check { name: string; ok: boolean; detail: string }

/** Is the font file of a composition (assets/fonts/<name>) installed with the project. */
function fontInstalled(file: string): boolean {
  const name = basename(file);
  try { return existsSync(fileURLToPath(import.meta.resolve(`@fontsource-variable/${name.split('-')[0]}/files/${name}`))); } catch { return false; }
}

export const doctor: Command<Context> = {
  name: 'doctor',
  summary: 'Is everything ready to check and render: the HyperFrames CLI at the version the editor reads, its Chrome, ffmpeg, ffprobe and the fonts. Names what is missing and how to get it.',
  args: [],
  flags: [],
  async run(_input, context) {
    const { where } = context.tools;
    const checks: Check[] = [];
    const issues: Issue[] = [];
    const tell = (name: string, ok: boolean, detail: string, fix: string) => {
      checks.push({ name, ok, detail });
      if (!ok) issues.push(issue('tool-missing', { target: name }, `${name}: ${detail}.`, fix));
    };
    /** The tool's output, or the reason it did not run. */
    const tryRun = async (tool: ToolName, args: string[]): Promise<{ stdout: string } | { failed: string }> => {
      try {
        const run = await context.tools.exec(tool, args, FAST_MS);
        return run.code === 0 ? { stdout: run.stdout } : { failed: `\`${tool} ${args.join(' ')}\` exited ${run.code}` };
      } catch (error) { return { failed: error instanceof Error ? error.message : String(error) }; }
    };
    const install = `Run \`pnpm install\` in ${where.root} (it installs HyperFrames ${HYPERFRAMES_VERSION} and the fonts), then \`viraleditor doctor\` again.`;

    const version = await tryRun('hyperframes', ['--version']);
    if ('failed' in version) tell('hyperframes', false, `the HyperFrames CLI does not run (${version.failed})`, install);
    else if (version.stdout.trim() !== HYPERFRAMES_VERSION) tell('hyperframes', false, `the HyperFrames CLI is version ${version.stdout.trim().slice(0, 40) || 'unknown'}, the editor reads only ${HYPERFRAMES_VERSION}`, install);
    else tell('hyperframes', true, `${HYPERFRAMES_VERSION} at ${where.hyperframes}`, install);

    const report = await tryRun('hyperframes', ['doctor', '--json']);
    let chrome: { ok?: boolean; detail?: string; hint?: string } | undefined;
    if (!('failed' in report)) {
      try { chrome = (JSON.parse(report.stdout.slice(report.stdout.indexOf('{'))) as { checks?: { name?: string; ok?: boolean; detail?: string; hint?: string }[] }).checks?.find((c) => c.name === 'Chrome'); } catch { chrome = undefined; }
    }
    const chromeFix = chrome?.hint ? `${chrome.hint} (the hint of \`hyperframes doctor\`), then \`viraleditor doctor\` again.` : `Run \`${where.hyperframes} doctor\` and follow what it says about Chrome, then \`viraleditor doctor\` again.`;
    if (chrome?.ok === true) tell('chrome', true, chrome.detail ?? 'found by the HyperFrames CLI', chromeFix);
    else tell('chrome', false, `the Chrome of the HyperFrames CLI is not ready (${'failed' in report ? report.failed : chrome?.detail ?? 'its doctor printed no report on Chrome'})`, chromeFix);

    for (const tool of ['ffmpeg', 'ffprobe'] as const) {
      const run = await tryRun(tool, ['-version']);
      const brew = `Install ffmpeg (it brings ffprobe): \`brew install ffmpeg\` on macOS, the package "ffmpeg" elsewhere; it must be on the PATH. Then \`viraleditor doctor\` again.`;
      if ('failed' in run) tell(tool, false, `${tool} does not run (${run.failed})`, brew);
      else tell(tool, true, `${run.stdout.split('\n')[0]!.trim().slice(0, 60)} at ${where[tool]}`, brew);
    }

    const files = FONTS.flatMap((font) => fontFiles(font));
    const absent = files.filter((file) => !fontInstalled(file));
    tell('fonts', absent.length === 0, absent.length === 0 ? `${FONTS.join(', ')} (${files.length} files)` : `${absent.length} of ${files.length} font files are not installed: ${absent.map((file) => basename(file)).join(', ')}`, install);

    // optional: only `words --script` needs it, so a missing aligner is a warning and `ready` stays true
    const aligner = await context.tools.aligner.ready();
    checks.push({ name: 'aligner', ok: aligner.ready, detail: aligner.ready ? 'the Python environment of tools/align is there' : aligner.note ?? 'not set up' });
    const warnings = aligner.ready ? [] : [issue('tool-missing', { target: 'aligner' }, `aligner: ${aligner.note ?? 'not set up'}. Only \`viraleditor words --script\` needs it.`, 'Run tools/align/setup.sh in the viraleditor folder (offline), then `viraleditor doctor` again.')];

    const ready = issues.length === 0;
    return { issues, warnings, result: { ready, checks, next: ready ? 'Everything is ready: `viraleditor check <edit.json>`.' : 'Do what each issue says under "fix", then run `viraleditor doctor` again.' } };
  },
};
