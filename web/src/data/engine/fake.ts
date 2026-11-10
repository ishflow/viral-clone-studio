import { videoUploadOf, videoUploadTitle } from '../real/uploads';
import { CLIP_SECONDS, CONTENT_RULE_MARK, JOB_MINUTES, PREPARE_SECONDS, SCAN_SECONDS, SPLIT_SCREEN_MARK, STEP_KEYS, STEP_RUN_ORDER, STEP_SECONDS,
  STOP_CLIPS, STOP_REASON, STOP_TEMPLATE_ID, SWAP_STEP_KEYS, SWAP_STOP_MARKS, swapTemplateFixture } from '../mock/demo-values';
import { candidateTemplate, privateTemplate } from '../mock/fixtures/templates';
import { fakeSpeed, getStore, newestFirst, now } from '../mock/store';
import type { JobRecord, ScanRecord } from '../mock/store';
import { NotFoundError, rangeProblem, swapPeopleProblem } from '../ports';
import type { AdminSettings, Candidate, Id, JobMade, JobShot, JobStep, JobVariant, Paid, PreparationNote, Scan, SourceRange, StepKey, StopDetail, StopReason, Template } from '../ports';
import { sourceLink } from '../source-link';
import type { Engine } from './port';

// The fake production system. It keeps its data in the fake store (`templates`, `candidates`, `scans`, `settings`), so `resetStore()` resets it too.
// Nothing is produced: a job, the preparation of a template and a scan are done when their fake time has passed (`VC_FAKE_SPEED`).

/** When each step starts and ends, in milliseconds of fake time: the steps run one after the other. */
function timeline(order: StepKey[] = STEP_RUN_ORDER): { slots: Record<StepKey, { start: number; end: number }>; total: number } {
  const slots = {} as Record<StepKey, { start: number; end: number }>;
  let total = 0;
  for (const key of order) {
    slots[key] = { start: total, end: total + STEP_SECONDS[key] * 1000 };
    total = slots[key].end;
  }
  return { slots, total };
}
const { slots: SLOTS, total: TOTAL_MS } = timeline();
/** The moment a job on the stop template halts: part of the clips are ready, the rest never come. */
const STOP_AT_MS = SLOTS.clips.start + ((SLOTS.clips.end - SLOTS.clips.start) * STOP_CLIPS.done) / STOP_CLIPS.of;
/** A person swap has its own three steps, one after the other; one that stops does so halfway through its parts. */
const SWAP = timeline(SWAP_STEP_KEYS);
const SWAP_STOP_AT_MS = (SWAP.slots.clips.start + SWAP.slots.clips.end) / 2;
/** The steps a job shows, when each runs, how long all of them take, and where a job that stops halts. */
const clockOf = (job: JobRecord) => (job.swap
  ? { keys: SWAP_STEP_KEYS, slots: SWAP.slots, total: SWAP.total, stopAt: SWAP_STOP_AT_MS }
  : { keys: STEP_KEYS, slots: SLOTS, total: TOTAL_MS, stopAt: STOP_AT_MS });

function elapsedMs(job: JobRecord, at: Date, speed: number): number {
  if (job.pinnedElapsed != null) return job.pinnedElapsed * 1000;
  if (job.resumedAt) return clockOf(job).stopAt + (at.getTime() - Date.parse(job.resumedAt)) * speed;
  return (at.getTime() - Date.parse(job.clockFrom ?? job.startedAt)) * speed;
}

/** A job whose products hold `CONTENT_RULE_MARK` breaks the content rules: it stops halfway through the adaptation (B12). */
const breaksRules = (job: JobRecord): boolean =>
  job.input.products.some((product) => `${product.name} ${product.description}`.includes(CONTENT_RULE_MARK));
const CONTENT_STOP_MS = (SLOTS.adaptation.start + SLOTS.adaptation.end) / 2;

/** Where a job halts and why: the content rules, a one-variant job on the stop template, or a person swap with a marked photograph. Null: it runs to the end. */
function haltOf(job: JobRecord): { at: number; reason: StopReason; detail?: StopDetail | null } | null {
  if (job.resumedAt) return null;
  if (job.swap) {
    const names = job.swap.people.flatMap((person) => [person.body, person.face ?? '']);
    const marked = SWAP_STOP_MARKS.find(([mark]) => names.some((name) => name.includes(mark)));
    return marked ? { at: SWAP_STOP_AT_MS, reason: 'clips-failed', detail: marked[1] } : null;
  }
  if (breaksRules(job)) return { at: CONTENT_STOP_MS, reason: 'content-rule' };
  if (job.templateId === STOP_TEMPLATE_ID && job.input.variants === 1) return { at: STOP_AT_MS, reason: STOP_REASON };
  return null;
}

/**
 * Elapsed time → step states. Pure: it reads the job and the given time, and changes nothing.
 * It takes the stored record, not the port's `Job`: only the record knows whether the job was resumed or is frozen.
 */
export function progress(job: JobRecord, at: Date, speed = fakeSpeed()): JobStep[] {
  const elapsed = elapsedMs(job, at, speed);
  const halt = haltOf(job);
  const halted = halt !== null && elapsed >= halt.at;
  const time = halted ? halt.at : elapsed;
  const { keys, slots } = clockOf(job);
  return keys.map((key): JobStep => {
    const { start, end } = slots[key];
    const total = job.steps.find((step) => step.key === key)?.total ?? 1;
    if (time >= end) return { key, status: 'done', done: total, total };
    if (time < start) return { key, status: 'waiting', done: 0, total };
    return { key, status: halted ? 'stopped' : 'running', done: Math.floor((total * (time - start)) / (end - start)), total };
  });
}

/**
 * The shots with something made, by the steps: the first `images.done` pictures and the first `clips.done` clips, variant after variant.
 * The fake makes no files: the picture of a shot is the sample picture of the template, its clip the sample video.
 */
function shotsOf(job: JobRecord): JobShot[] {
  const made = (key: StepKey) => job.steps.find((step) => step.key === key)?.done ?? 0;
  const perVariant = Math.max(1, Math.ceil((job.steps.find((step) => step.key === 'clips')?.total ?? 0) / job.input.variants));
  const template = getStore().templates.find((item) => item.id === job.templateId);
  const [picture, clip] = [template?.image || null, template?.video ?? null];
  return Array.from({ length: Math.max(made('images'), made('clips')) }, (_, index): JobShot => ({
    variant: Math.floor(index / perVariant) + 1, n: (index % perVariant) + 1, image: index < made('images') ? picture : null, clip: index < made('clips'),
    clipUrl: index < made('clips') ? clip : null,
  }));
}

/** A tenth of a second of silence as a WAV address: the fake makes no sound, and a page that plays the music still has something to play. */
const SILENCE = (() => {
  const text = (word: string) => [...word].map((letter) => letter.charCodeAt(0));
  // 8-bit mono, 8000 Hz, 800 samples: the file is 844 bytes: the RIFF size is 836, the data size 800
  const header = [...text('RIFF'), 0x44, 0x03, 0, 0, ...text('WAVEfmt '), 16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x40, 0x1f, 0, 0, 1, 0, 8, 0, ...text('data'), 0x20, 0x03, 0, 0];
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...header, ...Array<number>(800).fill(128)))}`;
})();

/** The music, once its step is done (one track, for the first variant). */
function madeOf(job: JobRecord): JobMade {
  const done = job.steps.find((step) => step.key === 'music')?.status === 'done';
  return { music: done ? [{ variant: 1, url: SILENCE }] : [], shared: [] };
}

function finishedAt(job: JobRecord, speed: number): string {
  const { total, stopAt } = clockOf(job);
  const [from, left] = job.resumedAt ? [Date.parse(job.resumedAt), total - stopAt] : [Date.parse((job.swap && job.clockFrom) || job.startedAt), total];   // a person swap may have waited long for the admin's look: its end is counted from when its work began
  return new Date(from + left / speed).toISOString();
}

/**
 * The variants of a job as of now (B2). The variants are made one after the other: while the job runs, the ones whose share of the
 * time has passed are `done`. A finished job on the stop template with several variants delivers all but the last, which stops.
 * A variant started again (`variantRuns`) is `generating` for one job's time, then `done`. The output is the sample of the template.
 */
function variantsOf(job: JobRecord, elapsed: number): JobVariant[] {
  const template = getStore().templates.find((item) => item.id === job.templateId);
  const count = job.input.variants;
  const output = { image: template?.image ?? '', video: template?.video ?? null };
  const pending = { image: '', video: null };
  return Array.from({ length: count }, (_, index): JobVariant => {
    const id = `${job.id}-v${index + 1}`;
    const rerun = job.variantRuns[id];
    if (rerun) {
      const done = (now().getTime() - Date.parse(rerun)) * fakeSpeed() >= TOTAL_MS;
      return { id, ...(done ? output : pending), status: done ? 'done' : 'generating', reason: null };
    }
    if (job.status === 'stopped') return { id, ...pending, status: 'stopped', reason: job.stoppedReason };
    if (job.status === 'done') {
      const lost = job.templateId === STOP_TEMPLATE_ID && count > 1 && index === count - 1 && !job.resumedAt;
      return lost ? { id, ...pending, status: 'stopped', reason: STOP_REASON } : { id, ...output, status: 'done', reason: null };
    }
    const share = TOTAL_MS / count;
    if (elapsed >= share * (index + 1)) return { id, ...output, status: 'done', reason: null };
    return { id, ...pending, status: elapsed >= share * index ? 'generating' : 'waiting', reason: null };
  });
}

/** Templates whose preparation fails in the fake, and why (a link with `SPLIT_SCREEN_MARK`, or a video the part does not fit). */
const failing = new Map<Id, PreparationNote>();

/** The fake does not read a link, but a link holding one of these words stands for a video of that length, so that a part of it can be refused as the real engine does. */
const LINK_VIDEO_SECONDS: readonly (readonly [mark: string, seconds: number])[] = [['too-long', 400], ['long-video', 150]];
/** The real engine's limits: a video is used whole up to a minute, and a part of one up to 5 minutes (half a second past its end is cut at the end). */
const WHOLE_VIDEO_SECONDS_MAX = 60, SOURCE_SECONDS_MAX = 300, PAST_END_SECONDS = 0.5;

/** Why a video of the link cannot be prepared with `range`, or null: only a link that stands for a video of known length can be told. */
function unfitting(url: string, range: SourceRange | undefined): PreparationNote | null {
  const seconds = LINK_VIDEO_SECONDS.find(([mark]) => url.includes(mark))?.[1];
  if (seconds === undefined) return null;
  if (seconds > (range ? SOURCE_SECONDS_MAX : WHOLE_VIDEO_SECONDS_MAX)) return 'too-long';
  return range && range.to > seconds + PAST_END_SECONDS ? 'bad-range' : null;
}

/** A template that is being prepared turns ready `PREPARE_SECONDS` after it was added (`editedAt`), in fake time like the jobs. */
function refreshTemplate(template: Template): Template {
  if (template.preparation === 'preparing') {
    const elapsed = (now().getTime() - Date.parse(template.editedAt)) * fakeSpeed();
    const note = failing.get(template.id);
    if (elapsed >= PREPARE_SECONDS * 1000 && note) {
      template.preparation = 'failed';
      template.preparationNote = note;
    } else if (elapsed >= PREPARE_SECONDS * 1000) template.preparation = 'ready';
  }
  return template;
}

/** Every stored template, brought up to the current time. */
function liveTemplates(): Template[] {
  return getStore().templates.map(refreshTemplate);
}

function mustFindTemplate(id: Id): Template {
  const template = liveTemplates().find((item) => item.id === id);
  if (!template) throw new NotFoundError('template');
  return template;
}

/** Takes a candidate out of the inbox. A second call for the same id does not find it. */
function takeCandidate(id: Id): Candidate {
  const { candidates } = getStore();
  const index = candidates.findIndex((candidate) => candidate.id === id);
  const [candidate] = index < 0 ? [] : candidates.splice(index, 1);
  if (!candidate) throw new NotFoundError('candidate');
  return candidate;
}

/** Brings a running scan up to the current time: it is done `SCAN_SECONDS` after its clock started, in fake time like the jobs. */
function refreshScan(scan: ScanRecord): ScanRecord {
  if (scan.status === 'running' && scan.clockFrom) {
    const elapsed = (now().getTime() - Date.parse(scan.clockFrom)) * fakeSpeed();
    if (elapsed >= SCAN_SECONDS * 1000) scan.status = 'done';
  }
  return scan;
}

/** A copy for the caller, without the field only the fake needs. */
function toScan({ id, startedAt, source, checked, queued, aboveThreshold, prepared, status, reason }: ScanRecord): Scan {
  return { id, startedAt, source, checked, queued, aboveThreshold, prepared, status, reason };
}

const SETTING_KEYS = [
  'scanTimes', 'threshold', 'dailyCandidates', 'dailyTemplates', 'providerAccount',
  'sources', 'searches', 'secondsMin', 'secondsMax', 'shortsMinViews', 'topAdsCards', 'perScan', 'topAdsIndustry', 'topAdsCountry', 'topAdsPeriod',
] as const satisfies readonly (keyof AdminSettings)[];

/**
 * The fake reads no video: every person-swap video an admin adds is the one of the fixtures under a new id, prepared at once, and
 * waits for the admin (who sets the person's box and words, and publishes it).
 */
function addSwapVideo(title?: string): Template {
  const template: Template = { ...swapTemplateFixture(now().toISOString()), id: crypto.randomUUID(), status: 'waiting', ...(title && { title }) };
  getStore().templates.push(template);
  return structuredClone({ referenceLikes: null, ...template });
}

export const fakeEngine: Engine = {
  templates() {
    return liveTemplates().map((template) => structuredClone({ referenceLikes: null, ...template }));
  },

  template(id) {
    const template = liveTemplates().find((item) => item.id === id);
    return template ? structuredClone({ referenceLikes: null, ...template }) : null;
  },

  /**
   * Only the seven fields of the patch can change; a field that is undefined is left as it is.
   * New shots make a current sample `outdated`; publishing with an outdated sample is refused and changes nothing (B11).
   * The people of a person-swap video (`patch.swap`) are taken at once: the fake has no worker that would write them later.
   * A person-swap video whose people are not set is not published.
   */
  updateTemplate(id, patch) {
    const template = mustFindTemplate(id);
    const shotsChange = patch.shots !== undefined && JSON.stringify(patch.shots) !== JSON.stringify(template.shots);
    const sample = shotsChange && template.sample === 'current' ? 'outdated' : template.sample;
    if (patch.status === 'published' && template.status !== 'published' && sample === 'outdated') throw new Error('sample-outdated');
    if (patch.status === 'published' && template.status !== 'published' && template.swapPeople) throw new Error('swap-people-unset');
    if (patch.swap !== undefined) {
      if (!template.swap) throw new NotFoundError('template');
      if (swapPeopleProblem(patch.swap.persons)) throw new Error('swap-people-invalid');
      const persons = structuredClone(patch.swap.persons);
      template.swap = { ...template.swap, people: persons.length as 1 | 2, persons };
      delete template.swapPeople;
    }
    template.sample = sample;
    if (patch.title !== undefined) template.title = patch.title;
    if (patch.category !== undefined) template.category = patch.category;
    if (patch.products !== undefined) template.products = patch.products;
    if (patch.status !== undefined) template.status = patch.status;
    if (patch.shots !== undefined) template.shots = structuredClone(patch.shots);
    if (patch.description !== undefined) template.description = patch.description;
    if (patch.tags !== undefined) template.tags = [...patch.tags];
    template.editedAt = now().toISOString();
    return structuredClone({ referenceLikes: null, ...template });
  },

  removeTemplate(id) {
    const store = getStore();
    mustFindTemplate(id);
    store.templates = store.templates.filter((template) => template.id !== id);
  },

  /**
   * The fake does not read the link: every link gives the same private template, first as "preparing". A part that is not one is
   * refused at once, as the real engine does; a link that stands for a video of known length fails its preparation when the part does not fit.
   */
  addFromLink(ownerId, url, range, mode) {
    if (range && rangeProblem(range)) throw new Error('source-rejected:range');
    if (mode) return addSwapVideo();
    const template = privateTemplate(crypto.randomUUID(), ownerId, now().toISOString());
    const note = unfitting(url, range) ?? (url.includes(SPLIT_SCREEN_MARK) ? 'split-screen' : null);
    if (note) failing.set(template.id, note);
    getStore().templates.push(template);
    return structuredClone({ referenceLikes: null, ...template });
  },

  /** The fake does not read the file either: the same private template as a link. */
  addFromUpload(ownerId, uploadId, _range, mode) {
    const upload = videoUploadOf(uploadId, ownerId);
    if (!upload) throw new Error('upload-not-found');
    if (mode) return addSwapVideo(videoUploadTitle(upload));
    const template = privateTemplate(crypto.randomUUID(), ownerId, now().toISOString());
    template.title = videoUploadTitle(upload);
    getStore().templates.push(template);
    return structuredClone({ referenceLikes: null, ...template });
  },

  /** One image and one clip per shot and variant, one music track for the job, a voice per variant of a talking template. */
  paid(templateId, variants) {
    const template = mustFindTemplate(templateId);
    // A person swap: one clip for each part of the video, billed by the whole seconds of the part; nothing else is paid for.
    if (template.swap) return { images: 0, clips: template.swap.parts.length, clipSeconds: template.swap.parts.reduce((sum, part) => sum + Math.ceil(part.to - part.from), 0), music: 0, voice: 0 };
    const shots = template.shots.length * variants;
    return { images: shots, clips: shots, clipSeconds: shots * CLIP_SECONDS, music: 1, voice: template.format === 'talking' ? variants : 0 };
  },

  minutes(templateId, variants) {
    return JOB_MINUTES[mustFindTemplate(templateId).format] * variants;
  },

  /**
   * Writes the steps of a job that has not begun, and counts the job on its template unless it is a sample.
   * The fake asks nobody for what was approved, and a sample runs like any job.
   */
  start(job, _approved, sample) {
    const template = mustFindTemplate(job.templateId);
    // One sample run per template at a time: a second one would pay for the same sample twice (S11 review I1).
    const twin = sample && getStore().jobs.some((other) => other.sample && other.id !== job.id && other.templateId === job.templateId && other.status === 'running');
    if (twin) throw new Error('sample-running');
    const shots = template.swap ? template.swap.parts.length : template.shots.length * job.input.variants;
    job.steps = clockOf(job).keys.map((key) => ({ key, status: 'waiting', done: 0, total: key === 'images' || key === 'clips' ? shots : 1 }));
    job.clockFrom = now().toISOString();
    job.variants = variantsOf(job, 0);
    if (!sample) template.timesGenerated += 1;
  },

  /** Stopped → running, from the stopped step: the job does not stop again. */
  resume(job) {
    job.status = 'running';
    job.stoppedReason = null;
    job.stoppedDetail = null;
    job.resumedAt = now().toISOString();
    job.steps = progress(job, now());
  },

  /** Nothing to release: the fake has no worker, a job runs by the clock from the moment it started. */
  committed() {},

  /**
   * Brings a running job up to the current time, and the variants of a done job that is generating one again.
   * A job that is done (with nothing generating) or stopped stays as it is. A sample that is done makes its template's sample current.
   */
  refresh(job) {
    if (job.status === 'done') {
      if (job.variants.some((variant) => variant.status === 'generating')) job.variants = variantsOf(job, TOTAL_MS);
      return job;
    }
    if (job.status !== 'running') return job;
    const speed = fakeSpeed();
    job.steps = progress(job, now(), speed);
    if (!job.swap) job.shots = shotsOf(job);                               // a person swap has parts, not shots: no box of the page is one
    job.made = madeOf(job);
    if (job.steps.every((step) => step.status === 'done')) {
      job.status = 'done';
      job.finishedAt = finishedAt(job, speed);
      const template = job.sample ? getStore().templates.find((item) => item.id === job.templateId) : undefined;
      if (template) template.sample = 'current';
    } else if (job.steps.some((step) => step.status === 'stopped')) {
      const halt = haltOf(job);
      job.status = 'stopped';
      job.stoppedReason = halt?.reason ?? STOP_REASON;
      if (halt?.detail) job.stoppedDetail = halt.detail;
      job.stoppedAt = new Date(Date.parse(job.clockFrom ?? job.startedAt) + (halt?.at ?? 0) / speed).toISOString();
    }
    job.variants = variantsOf(job, elapsedMs(job, now(), speed));
    return job;
  },

  /** A stopped variant of a done job runs again for one job's time; it does not stop again. */
  regenerateVariant(job, variantId) {
    if (!job.variants.some((variant) => variant.id === variantId)) throw new NotFoundError('variant');
    job.variantRuns[variantId] = now().toISOString();
    job.variants = variantsOf(job, TOTAL_MS);
    return crypto.randomUUID();
  },

  /** The fake keeps no parts and no files: closing and deleting forget nothing. */
  close() {},
  deleteMedia() {},

  /** The fake stops at the clips step only: what is missing is the clips that never came. */
  missing(job): Paid {
    const clips = job.steps.find((step) => step.key === 'clips');
    const left = job.status === 'stopped' && clips ? clips.total - clips.done : 0;
    return { images: 0, clips: left, clipSeconds: left * CLIP_SECONDS, music: 0, voice: 0 };
  },

  candidates() {
    return getStore().candidates.map(({ url: _url, ...candidate }) => ({ ...candidate, ...(candidate.scoreNotes ? { scoreNotes: [...candidate.scoreNotes] } : {}) }));
  },

  /**
   * The fake reads no video: a link becomes a candidate with the same look as any other (its title is the link). The day's limits are
   * counted from the links taken today (UTC day), as the real engine counts what the day has used.
   */
  addLinkCandidate(url) {
    const link = sourceLink(url);
    if (link === null) throw new Error('source-rejected:unsupported-site');
    const store = getStore();
    const known = [...(store.linkKeys ?? []).map((entry) => entry.key), ...store.candidates.flatMap((candidate) => (candidate.url ? [sourceLink(candidate.url)?.key ?? candidate.url] : []))];
    if (known.includes(link.key)) return { status: 'exists' };
    const today = now().toISOString().slice(0, 10);
    const taken = (store.linkKeys ?? []).filter((entry) => entry.at.slice(0, 10) === today).length;
    if (taken >= store.settings.dailyTemplates || taken >= store.settings.dailyCandidates) return { status: 'limit' };
    const candidate = { id: crypto.randomUUID(), title: link.url, source: 'shorts' as const, views: '0', seconds: 0, score: 0, image: '', foundAt: now().toISOString(), url: link.url };
    store.candidates.push(candidate);
    (store.linkKeys ??= []).push({ key: link.key, at: candidate.foundAt });
    return { status: 'added', id: candidate.id };
  },

  /** Candidate → a template that waits to be published. The candidate leaves the inbox. */
  prepareCandidate(id) {
    const template = candidateTemplate(crypto.randomUUID(), takeCandidate(id), now().toISOString());
    getStore().templates.push(template);
    return structuredClone({ referenceLikes: null, ...template });
  },

  rejectCandidate(id) {
    takeCandidate(id);
  },

  /** Newest first. */
  scans() {
    return newestFirst(getStore().scans.map(refreshScan), (scan) => scan.startedAt).map(toScan);
  },

  /**
   * Starts a Top Ads scan. One scan runs at a time: while one is running, that one is returned.
   * A running scan finishes `SCAN_SECONDS` of fake time after its clock started (see `ScanRecord.clockFrom`).
   */
  runScan() {
    const { scans } = getStore();
    const running = scans.map(refreshScan).find((scan) => scan.status === 'running');
    if (running) {
      running.clockFrom ??= now().toISOString();
      return toScan(running);
    }
    const startedAt = now().toISOString();
    const scan: ScanRecord = {
      id: crypto.randomUUID(), startedAt, source: 'topads', checked: 0, queued: 0, aboveThreshold: 0, prepared: 0,
      status: 'running', reason: null, clockFrom: startedAt,
    };
    scans.push(scan);
    return toScan(scan);
  },

  settings() {
    return structuredClone(getStore().settings);
  },

  /** Only the fields of the settings can change; a field that is undefined is left as it is. */
  saveSettings(patch) {
    const given = SETTING_KEYS.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]);
    Object.assign(getStore().settings, structuredClone(Object.fromEntries(given)));
    return structuredClone(getStore().settings);
  },

  /** The fake has no worker to lose. */
  health() {
    return { worker: 'running', lastSeen: now().toISOString(), provider: 'fake', swap: 'fake' };
  },
};
