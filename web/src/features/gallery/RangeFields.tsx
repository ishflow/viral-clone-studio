'use client';
import { useId } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { RULES } from '@/data/ports';
import { formatDuration } from '@/shared/lib/format';
import { cx } from '@/shared/lib/cx';
import { Icon, Input } from '@/shared/ui';

/** What the two boxes hold, as typed: `m:ss` or plain seconds. */
export type RangeValue = { from: string; to: string };
export type RangeProblem = 'format' | 'order' | 'short' | 'long' | 'outside';
export type RangeCheck = { seconds: number | null; problem: RangeProblem | null; ready: boolean };

/** Half a second of slack at the end of a file, the same as the engine's own check (`fileLengthProblem`). */
const END_SLACK = 0.5;

/** "1:20" or "80" as seconds; null for anything else (no hours, no decimals, seconds of a minute under 60). */
export function parseClock(text: string): number | null {
  const typed = text.trim();
  if (/^\d{1,3}$/.test(typed)) return Number(typed);
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(typed);
  return clock ? Number(clock[1]) * 60 + Number(clock[2]) : null;
}

/**
 * The state of the two boxes. While one is still empty nothing is said (the customer is typing); then the first thing wrong wins.
 * `videoSeconds` is the length of an uploaded file: the part must lie inside it.
 */
export function rangeCheck({ from, to }: RangeValue, videoSeconds?: number): RangeCheck {
  if (from.trim() === '' || to.trim() === '') return { seconds: null, problem: null, ready: false };
  const start = parseClock(from), end = parseClock(to);
  if (start === null || end === null) return { seconds: null, problem: 'format', ready: false };
  if (end <= start) return { seconds: null, problem: 'order', ready: false };
  const seconds = end - start;
  const problem: RangeProblem | null =
    seconds < RULES.rangeSecondsMin ? 'short'
    : seconds > RULES.rangeSecondsMax ? 'long'
    : videoSeconds !== undefined && end > videoSeconds + END_SLACK ? 'outside'
    : null;
  return { seconds, problem, ready: problem === null };
}

/** Seconds the way a customer types them: 80 → "1:20". */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The length the browser itself reads from a video file; null when it cannot (no metadata, a codec it does not play). Never waits long. */
export function readVideoSeconds(file: File): Promise<number | null> {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (seconds: number | null) => {
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = setTimeout(() => done(null), 4000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

/**
 * "Start – End" boxes for the part of a longer video the customer wants used. The owner holds the text (it needs `rangeCheck` to open or
 * close its own submit button); the two hidden fields `rangeFrom` / `rangeTo` carry the part in seconds when the group sits in a form.
 */
export function RangeFields({ value, onChange, videoSeconds }: { value: RangeValue; onChange: (next: RangeValue) => void; videoSeconds?: number }) {
  const t = useT();
  const uid = useId();
  const { seconds, problem } = rangeCheck(value, videoSeconds);
  const statusId = `${uid}-status`, errorId = `${uid}-error`;
  const describedBy = problem ? `${statusId} ${errorId}` : statusId;
  const sent = (text: string) => { const parsed = parseClock(text); return parsed === null ? text.trim() : String(parsed); };
  const box = (key: keyof RangeValue, label: string, placeholder: string) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`${uid}-${key}`} className="text-15 text-text-2">{label}</label>
      <Input
        id={`${uid}-${key}`}
        value={value[key]}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
        className="bg-surface tabular-nums"
      />
    </div>
  );
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="sr-only">{t('gallery.add.range.legend')}</legend>
      <div className="grid grid-cols-2 gap-3">
        {box('from', t('gallery.add.range.from'), '0:30')}
        {box('to', t('gallery.add.range.to'), '1:20')}
      </div>
      <p id={statusId} role="status" className={cx('m-0 leading-snug', seconds === null ? 'text-13 text-text-3' : cx('text-15 font-semibold', problem ? 'text-text-2' : 'text-accent-text'))}>
        {seconds === null ? t('gallery.add.range.hint') : t('gallery.add.range.picked', { length: formatDuration(seconds, t) })}
      </p>
      {problem && (
        <span id={errorId} role="alert" className="flex items-center gap-1.5 text-13 leading-snug text-warn">
          <Icon name="warning" size={16} className="flex-none" />
          {t(`gallery.add.range.error.${problem}`, { length: formatDuration(videoSeconds ?? 0, t) })}
        </span>
      )}
      <input type="hidden" name="rangeFrom" value={sent(value.from)} />
      <input type="hidden" name="rangeTo" value={sent(value.to)} />
    </fieldset>
  );
}
