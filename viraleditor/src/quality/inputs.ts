import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ToolUnavailable } from '../adapters/measure.ts';
import { MediaError } from '../adapters/media.ts';
import { tailOf } from '../edit/presets.ts';
import type { Edit } from '../edit/types.ts';
import type { Measure, StreamFacts } from '../ports.ts';
import type { QualityIssue } from './issue.ts';
import { FPS_TOLERANCE, KEYFRAME_SECONDS, LOUDNESS_WINDOW_SECONDS, SILENT_LUFS } from './thresholds.ts';

/** Where a picture is shown, and so how many pixels it needs. */
interface Use { where: string; width: number; height: number }

/** Every use of an image in the edit with the size it is shown at: full canvas (shot, window `behind`) or the pixels of a card's box. */
function imageUses(edit: Edit): Map<string, Use[]> {
  const { width, height } = edit.canvas;
  const uses = new Map<string, Use[]>();
  const add = (key: string, use: Use) => uses.set(key, [...(uses.get(key) ?? []), use]);
  for (const s of edit.shots) {
    add(s.media, { where: `shot ${s.id}`, width, height });
    for (const w of s.windows ?? []) add(w.behind, { where: `the picture behind ${s.id}`, width, height });
  }
  for (const c of edit.cards ?? []) {
    add(c.media, { where: `card ${c.id}`, width: Math.round(((c.box.right - c.box.left) / 100) * width), height: Math.round(((c.box.bottom - c.box.top) / 100) * height) });
  }
  return uses;
}

export async function checkInputs(edit: Edit, dir: string, measure: Measure): Promise<QualityIssue[]> {
  const issues: QualityIssue[] = [];
  try {
    await examine(edit, dir, measure, issues);
  } catch (e) {
    if (!(e instanceof ToolUnavailable)) throw e;
    // one finding about the tool, not "corrupt" for every file it could not open
    issues.push({ code: 'tool-failed', severity: 'error', message: `${e.bin} is missing or cannot start (${e.message}): no media file could be examined.`,
      fix: 'Install ffmpeg (ffprobe comes with it) and make sure both can be started; `viraleditor doctor` shows which tools are found. Then check again.', at: null, target: null });
  }
  return issues;
}

/** Every finding about the media files of the edit, added to `issues`. Throws ToolUnavailable when ffprobe or ffmpeg cannot be started. */
async function examine(edit: Edit, dir: string, measure: Measure, issues: QualityIssue[]): Promise<void> {
  const { width: W, height: H, fps: FPS } = edit.canvas;
  const uses = imageUses(edit);
  const tell = (code: string, severity: 'error' | 'warning', target: string, message: string, fix: string, at: number | null = null) =>
    issues.push({ code, severity, message, fix, at, target });

  for (const [key, entry] of Object.entries(edit.media)) {
    const path = join(dir, entry.file);
    if (!existsSync(path)) {
      tell('media-missing', 'error', key, `Media "${key}" (${entry.kind}) is not there: ${path}.`, `Put the ${entry.kind} file at ${path}, or point edit.media.${key}.file at a file that exists.`);
      continue;
    }
    let facts: StreamFacts;
    try {
      facts = await measure.streams(path);
    } catch (e) {
      if (!(e instanceof MediaError) || e instanceof ToolUnavailable) throw e;
      tell('media-corrupt', 'error', key, `Media "${key}" cannot be read (${e.message}).`, `Make the ${entry.kind} file ${entry.file} again (download, generate or export it once more) and replace it; do not use this one.`);
      continue;
    }
    const picture = entry.kind !== 'audio';
    if ((picture && facts.width === 0) || (entry.kind === 'audio' && !facts.sound) || (entry.kind === 'video' && facts.frames < 1)) {
      const found = facts.width > 0 ? 'a picture' : facts.sound ? 'sound only' : 'nothing usable';
      tell('media-corrupt', 'error', key, `Media "${key}" is declared as ${entry.kind} but ${entry.file} holds ${found}.`, `Make the ${entry.kind} file ${entry.file} again, or declare it with the kind it really is in edit.media.${key}.kind.`);
      continue;
    }

    if (entry.kind === 'video') {
      const fpsOk = Math.abs(facts.fps - FPS) <= FPS_TOLERANCE;
      const copy = entry.file.replace(/(\.[A-Za-z0-9]+)?$/, '-norm.mp4');
      const normalise = `Run \`viraleditor normalize ${path} ${join(dir, copy)} --canvas ${W}x${H}\` (it writes a ${W}x${H}, ${FPS} fps copy with a keyframe every second and BT.709 colour), then set edit.media.${key}.file to "${copy}".`;
      if (!fpsOk) tell('media-fps', 'error', key, `Video "${key}" runs at ${facts.fps} fps; the canvas runs at ${FPS} fps, and frames would play at the wrong time.`, normalise);
      if (facts.width !== W || facts.height !== H) {
        tell('media-size', 'warning', key, `Video "${key}" is ${facts.width}x${facts.height}; the canvas is ${W}x${H}. It will be scaled in the browser and cover-crop may cut the subject off.`, normalise);
      }
      const rate = Math.round(facts.fps) * KEYFRAME_SECONDS;
      const marks = [...facts.keyframes, facts.frames];
      const gap = Math.max(...marks.map((k, i) => (i === 0 ? k : k - marks[i - 1]!)));
      if (gap > rate) tell('media-keyframes', 'warning', key, `Video "${key}" has a keyframe only every ${gap} frames at most (${facts.keyframes.length} in ${facts.frames} frames); at least one per second (${rate} frames) is needed for exact seeking.`, normalise);
      if (!facts.constantRate) {
        tell('media-vfr', 'warning', key, `Video "${key}" has a variable frame rate (frames do not all last the same; ${facts.frames} frames in ${facts.seconds.toFixed(2)} s, counted as ${facts.fps} fps): its frame numbers are not its times, so a shot may show another picture than the one at its "from".`, normalise);
      }
      const c = facts.colour;
      if (c.space !== 'bt709' || c.transfer !== 'bt709' || c.primaries !== 'bt709') {
        tell('media-colour', 'warning', key, `Video "${key}" does not carry BT.709 colour tags (matrix ${c.space ?? 'none'}, transfer ${c.transfer ?? 'none'}, primaries ${c.primaries ?? 'none'}); colours may shift in the render.`, normalise);
      }
      if (fpsOk) {
        // media-black-edge: the part of the clip a shot uses begins or ends in black
        const blackRuns = await measure.black(path);
        edit.shots.forEach((s, i) => {
          if (s.media !== key) return;
          const first = s.from ?? 0;
          const last = Math.min(facts.frames, first + s.for + tailOf(edit.shots, i)) - 1;
          const head = blackRuns.find((r) => r.at <= first && first < r.at + r.for);
          const tail = blackRuns.find((r) => r.at <= last && last < r.at + r.for);
          const whole = [head, tail].find((r) => r && r.at <= first && r.at + r.for > last);
          if (whole) {
            tell('media-black-edge', 'warning', key, `The part of "${key}" that shot ${s.id} uses (source frames ${first}-${last}) is black from start to end.`,
              `Use another clip for shot ${s.id}, or another part of "${key}" (change the shot's "from" to a place where the clip has picture).`, s.at);
            return;
          }
          if (head) {
            const skip = head.at + head.for;
            tell('media-black-edge', 'warning', key, `The part of "${key}" that shot ${s.id} uses begins with ${skip - first} black frame(s) (source frames ${first}-${skip - 1}): the cut into the shot flickers.`,
              `Set shot ${s.id}'s "from" to ${skip} to skip the black frames (the clip then needs ${skip + s.for + tailOf(edit.shots, i)} frames), or use another clip.`, s.at);
          }
          if (tail && tail !== head) {
            const n = last - tail.at + 1;
            tell('media-black-edge', 'warning', key, `The part of "${key}" that shot ${s.id} uses ends with ${n} black frame(s) (source frames ${tail.at}-${last}): the cut out of the shot flickers.`,
              `Shorten shot ${s.id} by ${n} frames (its "for" ${s.for} to ${s.for - n}) or set its "from" ${n} lower, so that source frames ${tail.at}-${last} are not shown; or use another clip. In a run driven by a template the edit is not written by hand: the parts of one clip are placed so that the last one ends on the clip's last frame, with no spare frames, so the end cannot be moved away from the black. Then shorten the last part (the \`for\` of the last template shot that uses this clip) by ${n} frames, or use a clip that ends clean.`, s.at);
          }
        });
        // media-short only when the rate is right: at another rate the frame count means something else, and media-fps already stops the run
        edit.shots.forEach((s, i) => {
          if (s.media !== key) return;
          const need = (s.from ?? 0) + s.for + tailOf(edit.shots, i);
          if (need > facts.frames) {
            tell('media-short', 'error', key, `Shot ${s.id} (frame ${s.at}) needs ${need} frames of "${key}" (from ${s.from ?? 0} + for ${s.for} + ${tailOf(edit.shots, i)} for the next transition) but the file has ${facts.frames}.`,
              `Use a longer file, or lower shot ${s.id}'s "from" or "for" by ${need - facts.frames} frames${tailOf(edit.shots, i) > 0 ? ', or give the next shot a cut instead of a transition that needs source frames' : ''}.`, s.at);
          }
        });
      }
    }

    if (entry.kind === 'image') {
      const list = uses.get(key) ?? [];
      // the use that needs the biggest enlargement; the image is covered over its box, so both sides must reach the box
      const worst = list.map((u) => ({ u, scale: Math.max(u.width / facts.width, u.height / facts.height) })).sort((a, b) => b.scale - a.scale)[0];
      if (worst && worst.scale > 1) {
        const need = `${worst.u.width}x${worst.u.height}`;
        tell('image-small', 'warning', key, `Image "${key}" is ${facts.width}x${facts.height}, smaller than the ${need} box it fills in ${worst.u.where}; it will be blown up ${worst.scale.toFixed(2)}x and look soft.`,
          `Use an image of at least ${need} pixels (same aspect), or give ${worst.u.where} a smaller box.`);
      }
    }

    if (entry.kind === 'audio') {
      // Under the measuring window (one 400 ms block) the integrated loudness has nothing to gate and reads the floor, -70: a short sound is not judged
      const loud = facts.seconds < LOUDNESS_WINDOW_SECONDS ? null : await measure.loudness(path);
      if (loud && loud.integrated < SILENT_LUFS) {
        tell('audio-silent', 'warning', key, `Sound file "${key}" is silent (${Number.isFinite(loud.integrated) ? loud.integrated.toFixed(1) : '-inf'} LUFS, limit ${SILENT_LUFS}).`, `Use another file for edit.media.${key}; this one has no audible sound.`);
      }
    }
  }
}
