import { z } from 'zod';
import type { AdminSettings, SiteLimits } from '@/data/ports';

export const TIME_FIELDS = ['time1', 'time2', 'time3'] as const;
const NUMBER_FIELDS = ['threshold', 'dailyCandidates', 'dailyTemplates', 'secondsMin', 'secondsMax', 'shortsMinViews', 'topAdsCards', 'perScan'] as const;
/** "Limits and safety": saved with the same button, but to the site's limits (they apply at once), not to the scanner. */
export const LIMIT_FIELDS = ['jobsAtOnce', 'ownVideosPerDay', 'freeFirstVideo', 'showTalkingTemplates', 'dailySpendingLimit', 'warnAtPercent', 'onLimitReached', 'generationPaused', 'personSwap', 'swapReview'] as const;
export const SETTING_FIELDS = [...TIME_FIELDS, ...NUMBER_FIELDS, 'sourceTopads', 'sourceShorts', 'searches', 'topAdsIndustry', 'topAdsCountry', 'topAdsPeriod', ...LIMIT_FIELDS] as const;
export type SettingField = (typeof SETTING_FIELDS)[number];
export type SettingErrors = Partial<Record<SettingField | 'form', 'invalid' | 'duplicate' | 'failed' | 'order' | 'required'>>;
export type FullSettings = AdminSettings; // Optional new filters use defaults for older installations.
const OPTIONAL_FIELDS: readonly string[] = [...LIMIT_FIELDS, 'topAdsIndustry', 'topAdsCountry', 'topAdsPeriod'];

export const MAX_SEARCHES = 50;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// Digits only: `1e2`, `0x10`, `-1` and `2.5` are refused rather than read as some other number.
const whole = ({ min, max }: Range) => z.string().regex(/^\d{1,12}$/).transform(Number).pipe(z.number().int().min(min).max(max));
export type Range = { min: number; max: number };
/** The whole numbers each field takes: the schema checks them and the form tells them, from this one table. */
export const RANGES = {
  threshold: { min: 0, max: 100 },
  dailyCandidates: { min: 1, max: 1_000_000 },
  dailyTemplates: { min: 1, max: 1_000_000 },
  secondsMin: { min: 1, max: 600 },
  secondsMax: { min: 1, max: 600 },
  shortsMinViews: { min: 0, max: 10_000_000_000 },
  topAdsCards: { min: 1, max: 1_000_000 },
  perScan: { min: 1, max: 1_000_000 },
  jobsAtOnce: { min: 1, max: 100 },
  ownVideosPerDay: { min: 1, max: 1000 },
  dailySpendingLimit: { min: 1, max: 1_000_000_000 },
  warnAtPercent: { min: 1, max: 100 },
} as const satisfies Partial<Record<SettingField, Range>>;
const toggle = z.enum(['0', '1']).transform((value) => value === '1');
// A tag: letters, digits, `_`, and single spaces inside (the scanner joins a phrase into one tag).
const tag = /^[\p{L}\p{N}_]+( [\p{L}\p{N}_]+)*$/u;
/**
 * One hashtag per line (a comma also separates). A leading # is not part of the tag, inner spaces are squeezed, and a tag that
 * is already in the list (case and spaces ignored, as the scanner reads it) is dropped: each tag costs a request per scan.
 */
const hashtags = z.string().max(10_000).transform((text) => {
  const seen = new Set<string>();
  return text.split(/[\n,]/).map((line) => line.trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ')).filter((item) => {
    const key = item.toLocaleLowerCase('en').replace(/ /g, '');
    if (item === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}).pipe(z.array(z.string().max(100).regex(tag)).max(MAX_SEARCHES));
// The limits are optional: a form without them leaves them as they are. The spending limit is empty (not set) or a positive whole number.
const limitSchema = z.object({
  jobsAtOnce: whole(RANGES.jobsAtOnce).optional(),
  ownVideosPerDay: whole(RANGES.ownVideosPerDay).optional(),
  freeFirstVideo: toggle.optional(),
  showTalkingTemplates: toggle.optional(),
  dailySpendingLimit: z.union([z.literal('').transform(() => null), whole(RANGES.dailySpendingLimit)]).optional(),
  warnAtPercent: whole(RANGES.warnAtPercent).optional(),
  onLimitReached: z.literal('pause-new-jobs').optional(),
  generationPaused: toggle.optional(),
  personSwap: toggle.optional(),
  swapReview: toggle.optional(),
});
const schema = limitSchema.extend({
  time1: time, time2: time.or(z.literal('')), time3: time.or(z.literal('')),
  threshold: whole(RANGES.threshold),
  dailyCandidates: whole(RANGES.dailyCandidates),
  dailyTemplates: whole(RANGES.dailyTemplates),
  secondsMin: whole(RANGES.secondsMin),
  secondsMax: whole(RANGES.secondsMax),
  shortsMinViews: whole(RANGES.shortsMinViews),
  topAdsCards: whole(RANGES.topAdsCards),
  perScan: whole(RANGES.perScan),
  topAdsIndustry: z.enum(['beauty-personal-care', 'skincare', 'makeup', 'haircare', 'all']).optional(),
  topAdsCountry: z.string().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}$/)).optional(),
  topAdsPeriod: z.enum(['7', '30', '180']).transform(v => Number(v) as 7 | 30 | 180).optional(),
  sourceTopads: toggle,
  sourceShorts: toggle,
  searches: hashtags,
});

type Patch = Omit<FullSettings, 'providerAccount'>;
/** The settings form → the patch for `saveSettings`, or the fields that failed (codes, never prose). An empty number field is not 0; a number is digits only. */
export function parseSettings(form: FormData): { ok: true; value: Patch; limits: Partial<SiteLimits> } | { ok: false; errors: SettingErrors } {
  const raw = Object.fromEntries(
    SETTING_FIELDS.filter((k) => !OPTIONAL_FIELDS.includes(k) || form.has(k)).map((k) => [k, String(form.get(k) ?? '').replace(/\r\n?/g, '\n').trim()]),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const errors: SettingErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (SETTING_FIELDS.includes(field as SettingField)) errors[field as SettingField] = 'invalid';
      else errors.form = 'failed';
    }
    return { ok: false, errors };
  }
  const { time1, time2, time3, sourceTopads, sourceShorts, jobsAtOnce, ownVideosPerDay, freeFirstVideo, showTalkingTemplates, dailySpendingLimit, warnAtPercent, onLimitReached, generationPaused, personSwap, swapReview, ...rest } = parsed.data;
  const limits = Object.fromEntries(Object.entries({ jobsAtOnce, ownVideosPerDay, freeFirstVideo, showTalkingTemplates, dailySpendingLimit, warnAtPercent, onLimitReached, generationPaused, personSwap, swapReview }).filter(([, value]) => value !== undefined)) as Partial<SiteLimits>;
  const errors: SettingErrors = {};
  [time1, time2, time3].forEach((value, i, all) => {
    if (value !== '' && all.indexOf(value) < i) errors[TIME_FIELDS[i]!] = 'duplicate';
  });
  if (rest.secondsMin > rest.secondsMax) errors.secondsMax = 'order';
  if (sourceShorts && rest.searches.length === 0) errors.searches = 'required';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { scanTimes: [time1, time2, time3].filter(Boolean).sort(), sources: { topads: sourceTopads, shorts: sourceShorts }, ...rest }, limits };
}
