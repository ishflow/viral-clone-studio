import { engine } from '../engine';
import { videoUploadOf } from '../real/uploads';
import { DailyLimitError, fileLengthProblem, GenerationPausedError, InsufficientCreditsError, NotFoundError, PriceChangedError, RULES, rangeProblem } from '../ports';
import type { Id, OwnSource, SourceCheck, SourceRange, Template, TemplateCatalog } from '../ports';
import { LINK_REFUSALS } from './demo-values';
import { liveJobs } from './jobs';
import { balanceOf, writeEntry, writeRecord } from './ledger';
import { findUser, getStore, keyOf, now } from './store';
import { persistent, saveStore } from './persist';
import { shownTo, visibleTemplate, visibleTo } from './visible';

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const LINK_HOSTS = ['tiktok.com', 'instagram.com', 'youtube.com', 'youtu.be'];

/** B6: an own template that could not be prepared gives its credit back, once (`returned`, by the system, into the lots it came from). */
function settleOwnTemplates(): void {
  const store = getStore();
  for (const record of store.ownTemplates) {
    if (record.returnedEntryId) continue;
    if (engine().template(record.templateId)?.preparation !== 'failed') continue;
    const charge = store.ledger.find((entry) => entry.id === record.chargeEntryId);
    record.returnedEntryId = writeEntry(record.userId, 'returned', -(charge?.change ?? -RULES.ownTemplateCredits), charge?.note ?? '', {
      backTo: charge?.lots ?? [],
    }).id;
  }
}

/** Cheap admission only: metadata is nullable until a source has already been analysed. No network or paid analysis. */
function check(source: OwnSource, ownerId: Id): SourceCheck {
  if (source.range && rangeProblem(source.range)) return { ok: false, reason: 'range' };
  if (source.kind === 'link') {
    let host: string;
    try {
      const parsed = new URL(source.url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return { ok: false, reason: 'unsupported-site' };
      host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
    } catch {
      return { ok: false, reason: 'link-not-found' };
    }
    if (!LINK_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))) return { ok: false, reason: 'unsupported-site' };
    const refused = LINK_REFUSALS.find((word) => source.url.includes(word));
    return refused ? { ok: false, reason: refused } : engine().sourceInfo?.(ownerId, source.url, source.range) ?? { ok: true, seconds: null, format: null, shots: null };
  }
  const name = source.name.toLowerCase();
  if (!['video/mp4', 'video/quicktime'].includes(source.type) && !name.endsWith('.mp4') && !name.endsWith('.mov')) return { ok: false, reason: 'type' };
  if (source.bytes > MAX_VIDEO_BYTES) return { ok: false, reason: 'size' };
  if (source.bytes <= 0) return { ok: false, reason: 'unreadable' };
  const registered = videoUploadOf(source.uploadId, ownerId);
  if (!registered) return { ok: false, reason: 'unreadable' };
  const refused = fileLengthProblem(registered.seconds, source.range);
  if (refused) return { ok: false, reason: refused };
  return { ok: true, seconds: registered.seconds, format: null, shots: null, ...(registered.seconds > RULES.ownVideoSecondsMax ? { needsRange: true as const } : {}) };
}

/** The own videos a user started preparing today (UTC), whether or not they could be prepared. */
function allowanceOf(ownerId: Id): { used: number; limit: number; left: number } {
  const today = now().toISOString().slice(0, 10);
  const used = getStore().ownTemplates.filter((record) => record.userId === ownerId && record.at.slice(0, 10) === today).length;
  const limit = getStore().limits.ownVideosPerDay;
  return { used, limit, left: Math.max(0, limit - used) };
}

/** What a customer may see of the templates the engine holds. The engine hands out copies, so a caller cannot change the catalog. A person-swap video is no product template: only the person-swap pages show it (swap.ts). */
export const catalog: TemplateCatalog = {
  /** The search looks at the title, the category and the description, whatever the letter case. Published talking ones only while switched on (K14); a viewer's own private talking template is always listed. */
  async list({ search, category, format, viewerId }) {
    settleOwnTemplates();
    const words = search?.trim().toLowerCase();
    const mentions = (text: string): boolean => !words || text.toLowerCase().includes(words);
    const talking = getStore().limits.showTalkingTemplates;
    return engine().templates()
      .filter((template) => !template.swap && visibleTo(template, viewerId))
      .map((template) => shownTo(template, viewerId))
      .filter((template) => talking || template.format !== 'talking' || template.status === 'private')
      .filter((template) => !category || template.category === category)
      .filter((template) => !format || template.format === format)
      .filter((template) => mentions(template.title) || mentions(template.category) || mentions(template.description));
  },

  async get(id, viewerId) {
    settleOwnTemplates();
    const template = visibleTemplate(id, viewerId);
    return template && !template.swap ? template : null;
  },

  /** Categories of the published templates, in the order they first appear. A template that has no category yet adds none. */
  async categories() {
    const published = engine().templates().filter((template) => template.status === 'published' && template.category !== '' && !template.swap);
    return [...new Set(published.map((template) => template.category))];
  },

  async addFromLink(ownerId, url) {
    if (!findUser(ownerId)) throw new NotFoundError('user');
    return engine().addFromLink(ownerId, url);
  },

  /** The owner removes a private template, an admin any template. A template a job is running on stays. */
  async remove(id, viewerId) {
    const template = engine().template(id);
    const mayRemove = findUser(viewerId)?.role === 'admin' || (template?.status === 'private' && template.ownerId === viewerId);
    if (!template || !mayRemove) throw new NotFoundError('template');
    if (template.preparation === 'preparing') throw new Error('template-in-use');
    if (liveJobs().some((job) => job.templateId === id && (job.status === 'running' || job.status === 'queued' || job.variants.some(variant => variant.status === 'generating')))) throw new Error('template-in-use');
    // Keep failed preparation evidence until its durable charge has been returned exactly once.
    settleOwnTemplates();
    // SQLite deletion and site.json are separate stores: persist the refund before deleting its evidence.
    if (persistent()) saveStore(getStore());
    engine().removeTemplate(id);
  },

  async checkSource(ownerId, source) {
    if (!findUser(ownerId)) throw new NotFoundError('user');
    return check(source, ownerId);
  },

  async sourceParts(templateIds) {
    const parts = new Map<Id, SourceRange | null>();
    for (const id of templateIds) {
      const part = engine().sourcePart?.(id);
      if (part !== undefined) parts.set(id, part);
    }
    return parts;
  },

  async ownVideoAllowance(ownerId) {
    if (!findUser(ownerId)) throw new NotFoundError('user');
    return allowanceOf(ownerId);
  },

  /** One synchronous step: the key, the checks, the engine, the charge. */
  async prepareOwn(ownerId, source, confirmedCredits, idempotencyKey) {
    if (!findUser(ownerId)) throw new NotFoundError('user');
    const store = getStore();
    const key = keyOf('own-template', ownerId, idempotencyKey);
    const known = store.keys.get(key);
    if (known) {
      const template = engine().template(known);
      if (template) return template;
    }
    if (store.limits.generationPaused) throw new GenerationPausedError();
    const checked = check(source, ownerId);
    if (!checked.ok) throw new Error(`source-rejected:${checked.reason}`);
    const allowance = allowanceOf(ownerId);
    if (allowance.left === 0) throw new DailyLimitError(allowance.limit);
    const credits = RULES.ownTemplateCredits;
    if (confirmedCredits !== credits) throw new PriceChangedError(credits);
    const balance = balanceOf(ownerId);
    if (balance < credits) throw new InsufficientCreditsError(credits, balance);
    // First: when the engine refuses, nothing was charged.
    const template: Template = source.kind === 'link' ? engine().addFromLink(ownerId, source.url, source.range) : engine().addFromUpload(ownerId, source.uploadId, source.range);
    const charge = writeRecord(ownerId, 'generation', -credits, template.title);
    store.ownTemplates.push({ templateId: template.id, userId: ownerId, at: now().toISOString(), chargeEntryId: charge.id, returnedEntryId: null });
    store.keys.set(key, template.id);
    return template;
  },
};
