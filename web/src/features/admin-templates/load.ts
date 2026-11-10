import { notFound } from 'next/navigation';
import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import type { Candidate, Scan, ScanSource, Template } from '@/data/ports';
import { runningSample, type RunningSample } from './sample';
import { parseListQuery, parsePeriod, parseSource, periodStart, scanSchedule, type ScanPeriod, type SourceFilter, type TemplateFilter } from './query';

export type TemplateRow = Pick<Template, 'id' | 'title' | 'category' | 'format' | 'seconds' | 'referenceViews' | 'image' | 'status' | 'editedAt' | 'timesGenerated' | 'sample' | 'referenceMetric' | 'referenceImage'> & Partial<Pick<Template, 'preparation' | 'preparationNote'>> & { swapVideo?: true };
const toRow = (t: Template): TemplateRow => ({
  id: t.id, title: t.title, category: t.category, format: t.format, seconds: t.seconds, referenceViews: t.referenceViews, image: t.image,
  status: t.status, editedAt: t.editedAt, timesGenerated: t.timesGenerated, sample: t.sample, referenceMetric: t.referenceMetric, referenceImage: t.referenceImage, preparation: t.preparation, preparationNote: t.preparationNote,
  ...(t.swap && { swapVideo: true as const }),
});

export type ListData = { rows: TemplateRow[]; total: number; status: TemplateFilter; q: string };
/** `/admin/templates`. Admin only. */
export async function loadList(params: Record<string, string | string[] | undefined>): Promise<ListData> {
  await requireAdmin();
  const { status, q } = parseListQuery(params);
  const [rows, all] = await Promise.all([data.admin.templates({ status: status === 'all' ? undefined : status, search: q || undefined }), data.admin.templates({})]);
  return { rows: rows.map(toRow), total: all.length, status, q };
}

export type WaitingCard = Pick<Template, 'id' | 'title' | 'category' | 'format' | 'seconds' | 'referenceViews' | 'image' | 'products' | 'preparation' | 'preparationNote' | 'referenceImage' | 'referenceVideo' | 'referenceMetric'>
  & { sampleRunning: RunningSample | null };
export type InboxData = {
  waiting: WaitingCard[]; candidates: Candidate[]; source: SourceFilter; threshold: number; scanTimes: string[]; next: string; tomorrow: boolean;
  stoppedSources: { source: ScanSource; reason: Scan['reason'] }[];
};
/** The newest scan of each source, when it stopped. */
const stoppedSources = (scans: Scan[]) =>
  (['topads', 'shorts'] as const).flatMap((source) => {
    const newest = scans.find((scan) => scan.source === source); // scans() is newest first
    return newest?.status === 'stopped' ? [{ source, reason: newest.reason }] : [];
  });

/** `/admin/templates/inbox`. Admin only. */
export async function loadInbox(params: Record<string, string | string[] | undefined>, now = new Date()): Promise<InboxData> {
  await requireAdmin();
  const source = parseSource(params);
  const [waiting, candidates, scans, settings] = await Promise.all([
    data.admin.templates({ status: 'waiting' }), data.admin.candidates(), data.admin.scans(), data.admin.settings(),
  ]);
  const schedule = scanSchedule(settings.scanTimes, now);
  return {
    // A person-swap video has no sample to pay for and no gallery to join: it is read and published on its own page.
    waiting: waiting.filter((template) => !template.swap).map((template) => {
      const { id, title, category, format, seconds, referenceViews, image, products, preparation, preparationNote } = template;
      return { id, title, category, format, seconds, referenceViews, image, products, preparation, preparationNote, referenceMetric: template.referenceMetric, referenceImage: template.referenceImage, referenceVideo: template.referenceVideo, sampleRunning: runningSample(template) };
    }),
    candidates: candidates.filter((c) => source === 'all' || c.source === source),
    source, threshold: settings.threshold, scanTimes: schedule.times, next: schedule.next, tomorrow: schedule.tomorrow, stoppedSources: stoppedSources(scans),
  };
}

export type ScansData = {
  scans: Scan[]; total: number; period: ScanPeriod; threshold: number; published: number; times: string[]; next: string; tomorrow: boolean;
};
/** `/admin/templates/scans`. Admin only. */
export async function loadScans(params: Record<string, string | string[] | undefined>, now = new Date()): Promise<ScansData> {
  await requireAdmin();
  const period = parsePeriod(params);
  const [all, settings, published] = await Promise.all([data.admin.scans(), data.admin.settings(), data.admin.templates({ status: 'published' })]);
  const since = periodStart(period, now);
  const schedule = scanSchedule(settings.scanTimes, now);
  return {
    scans: all.filter((scan) => since === null || new Date(scan.startedAt).getTime() >= since), total: all.length, period,
    threshold: settings.threshold, published: published.filter((t) => t.source !== 'link').length, times: schedule.times, next: schedule.next, tomorrow: schedule.tomorrow,
  };
}

export type EditorData = { template: Template; categories: string[]; sampleRunning: RunningSample | null };
/** `/admin/templates/[id]`. Unknown id → 404. Admin only. */
export async function loadEditor(id: string): Promise<EditorData> {
  await requireAdmin();
  const [template, categories] = await Promise.all([data.admin.template(id), data.catalog.categories()]);
  if (!template) notFound();
  return { template, categories, sampleRunning: runningSample(template) };
}
