import type { Card, CardShot } from '../contracts.ts';
import type { TemplateJson } from './schema.ts';

type Window = { from: number; to: number };

/** What the site shows of a template. Only fields written for a person reach it (`action`, `description`, `title`, the text patterns): never a generation prompt, the script or the reference's own text. */
export function cardOf(template: TemplateJson, media: { image: string | null; video: string | null }): Card {
  const fps = template.canvas.fps;
  const speech = template.mode === 'speech';
  const segments = template.script?.segments ?? [];

  const windows: Window[] = [];
  if (speech) {
    let t = 0;
    for (const shot of template.shots) {
      const seg = segments.find((s) => s.id === shot.segment);
      const seconds = seg?.seconds ?? shot.clip_seconds ?? 0;
      windows.push({ from: t, to: t + seconds });
      t += seconds;
    }
  } else {
    for (const shot of template.shots) windows.push({ from: (shot.at ?? 0) / fps, to: ((shot.at ?? 0) + (shot.for ?? 0)) / fps });
  }

  const seconds = speech
    ? segments.reduce((sum, s) => sum + s.seconds, 0)
    : template.shots.reduce((max, s) => Math.max(max, (s.at ?? 0) + (s.for ?? 0)), 0) / fps;

  const textWindow = (t: TemplateJson['texts'][number]): Window | null =>
    t.at === undefined || t.for === undefined ? null : { from: t.at / fps, to: (t.at + t.for) / fps };

  const shots: CardShot[] = template.shots.map((shot, i) => {
    const w = windows[i]!;
    const text = template.texts.find((t) => {
      const tw = textWindow(t);
      return tw !== null && tw.from < w.to && tw.to > w.from;
    });
    const owner = shot.continues === undefined ? shot : template.shots.find((s) => s.id === shot.continues) ?? shot;   // a part shows its owner's product
    const first = owner.products.map(Number).find((n) => Number.isInteger(n));
    return { n: i + 1, from: w.from, to: w.to, action: shot.action, text: text?.copy ?? '', product: first ?? null };
  });

  return {
    title: template.title,
    category: template.category,
    format: speech ? 'talking' : 'no-talking',
    seconds,
    referenceViews: compact(template.source.metrics.views),
    image: media.image,
    video: media.video,
    products: template.products.min,
    shots,
    description: template.description,
    tags: template.tags,
  };
}

const UNITS = [['', 1], ['K', 1e3], ['M', 1e6], ['B', 1e9]] as const;

/** A view count as the site shows it: 1 900 000 → "1.9M", 500 000 → "500K", 999 → "999", 0 → "". One decimal, dropped when it is 0. */
function compact(views: number): string {
  if (!(views > 0)) return '';
  let unit = UNITS.findLastIndex(([, size]) => views >= size);
  if (unit <= 0) return String(Math.round(views));
  let tenths = Math.round(views / UNITS[unit]![1] * 10);
  if (tenths >= 10_000 && unit < UNITS.length - 1) { unit += 1; tenths = Math.round(views / UNITS[unit]![1] * 10); }   // 999 960 is "1M", not "1000K"
  return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)}${UNITS[unit]![0]}`;
}
