import type {
  Actor, AdminSettings, Candidate, Id, Invoice, JobStep, LedgerEntry, LedgerType, ProductInput, PurchaseStatus, Quality, Scan, Template,
} from '../../ports';
import { JOB_MINUTES, PACKS, STEP_KEYS, STOP_CLIPS, STOP_REASON, jobCost, money } from '../demo-values';
import { allocateLots } from '../lots';
import type { Ago, JobRecord, PurchaseRecord } from '../store';

type JobState = 'done' | 'stopped' | 'running';
interface JobSeed { id: Id; userId: Id; templateId: Id; quality: Quality; variants: 1 | 2 | 3; startedAt: string; state: JobState; free?: boolean }
interface LedgerRow { userId: Id; at: string; type: LedgerType; change: number; note: string; by?: Actor; reason?: string;
  jobId?: Id; purchaseId?: Id }
const ADMIN: Actor = { kind: 'admin', id: 'usr-admin', name: 'Admin' };
/** Minutes after its start that the stopped job of the fixtures stopped. */
const STOPPED_AFTER_MINUTES = 3;

const sample = (hash: string): string => `/samples/${hash}.jpg`;
const product = (name: string, description: string, hash: string): ProductInput => ({ name, description, images: [sample(hash)] });

// Product names and photos as on the boards `A-Form` and `A-Uretimlerim`.
const oil = product('Aurora Body Oil', 'body oil', '619ee0e5a13e318118b291c1451be9b8');
const mist = product('Aurora Body Mist', 'body mist', '29d17f8e71e518c213e1c982faf29cea');
const hairMist = product('Aurora Hair Mist', 'hair mist', 'de5244c861eb9107996b5404d64ca159');
const perfume = product('Solace Perfume', 'perfume', '586c7628c6d07d797378740fedc4c97f');
const serum = product('Lashly Eyelash Serum', 'eyelash serum', '1377349dbc87784232ac59cf9cf04986');
const PRODUCTS: Record<Id, ProductInput[]> = {
  'tpl-layering': [oil, mist, hairMist, perfume], 'tpl-eye': [serum], 'tpl-story': [serum],
  'tpl-stop': [perfume, mist], 'tpl-shower': [hairMist], 'tpl-refused': [hairMist],
};

/** Seconds of progress the running job of the fixtures is frozen at: clips 3 of 5, as on the board `A-Is-Takibi`. */
const PINNED_SECONDS = 25;

/** The steps of a job in a given state. A running job gets its live steps from the runner on every read. */
function steps(shots: number, state: JobState): JobStep[] {
  return STEP_KEYS.map((key): JobStep => {
    const total = key === 'images' || key === 'clips' ? shots : 1;
    const waiting = state === 'running' || (state === 'stopped' && (key === 'edit' || key === 'render'));
    if (waiting) return { key, status: 'waiting', done: 0, total };
    if (state === 'stopped' && key === 'clips') return { key, status: 'stopped', done: Math.floor((total * STOP_CLIPS.done) / STOP_CLIPS.of), total };
    return { key, status: 'done', done: total, total };
  });
}

function job(template: Template, seed: JobSeed): JobRecord {
  const { id, userId, templateId, quality, variants, startedAt, state } = seed;
  const done = state === 'done';
  const minutes = JOB_MINUTES[template.format] * variants;
  return {
    id, userId, templateId, templateTitle: template.title,
    input: { templateId, products: PRODUCTS[templateId] ?? [], quality, variants, language: 'en' },
    credits: seed.free ? 0 : jobCost(template.format, quality, variants),
    status: state,
    steps: steps(template.shots.length * variants, state),
    stoppedReason: state === 'stopped' ? STOP_REASON : null,
    startedAt,
    finishedAt: done ? new Date(Date.parse(startedAt) + minutes * 60_000).toISOString() : null,
    variants: done
      ? Array.from({ length: variants }, (_, index) => ({ id: `${id}-v${index + 1}`, image: template.image, video: template.video, status: 'done' as const, reason: null }))
      : [],
    resumedAt: null, pinnedElapsed: state === 'running' ? PINNED_SECONDS : null, refundEntryId: null,
    clockFrom: null, variantRuns: {}, approved: null, chargeEntryId: null, sample: false, freeVideo: seed.free ?? false,
    returnedCredits: 0, stoppedAt: state === 'stopped' ? new Date(Date.parse(startedAt) + STOPPED_AFTER_MINUTES * 60_000).toISOString() : null,
    closedAt: null, closedReason: null, deletedAt: null,
  };
}

/** Purchases, jobs and the credit ledger that follows from them, plus scans, candidates and settings. */
export function historyFixtures(ago: Ago, templates: Template[]) {
  const jobs: JobRecord[] = [];
  const purchases: PurchaseRecord[] = [];
  const invoices: Invoice[] = [];
  const rows: LedgerRow[] = [];

  const generate = (seed: JobSeed): void => {
    const template = templates.find((item) => item.id === seed.templateId);
    if (!template) throw new Error(`fixture template missing: ${seed.templateId}`);
    const record = job(template, seed);
    jobs.push(record);
    rows.push({ userId: seed.userId, at: seed.startedAt, type: seed.free ? 'free-video' : 'generation', change: 0 - record.credits, note: template.title, jobId: record.id });
    // B1: a stopped job's credits came back the moment it stopped.
    if (record.stoppedAt && record.credits > 0) {
      record.returnedCredits = record.credits;
      rows.push({ userId: seed.userId, at: record.stoppedAt, type: 'returned', change: record.credits, note: template.title, by: { kind: 'system' }, jobId: record.id });
    }
  };
  // `invoice` is the invoice number of a purchase that was paid; null for a checkout that was not completed.
  const buy = (id: Id, userId: Id, packId: Id, at: string, status: PurchaseStatus, invoice: string | null, refundedAt?: string): void => {
    const pack = PACKS.find((item) => item.id === packId);
    if (!pack) throw new Error(`fixture pack missing: ${packId}`);
    const invoiceId = invoice ? id.replace('pur-', 'inv-') : null;
    const amount = pack.priceCents === null ? null : money(pack.priceCents);
    const refund = refundedAt ? { requestedAt: at, sentAt: refundedAt, settledAt: refundedAt, by: ADMIN } : null;
    purchases.push({ id, userId, packId, packName: pack.name, credits: pack.credits, amount, amountCents: pack.priceCents, at, status, invoiceId, refund });
    if (invoice && invoiceId) {
      invoices.push({ id: invoiceId, number: invoice, userId, purchaseId: id, date: at, packName: pack.name, credits: pack.credits, amount });
      rows.push({ userId, at, type: 'purchase', change: pack.credits, note: pack.name, purchaseId: id });
    }
    if (refundedAt) rows.push({ userId, at: refundedAt, type: 'refund', change: 0 - pack.credits, note: pack.name, by: ADMIN, reason: 'Refund requested within 14 days', purchaseId: id });
  };

  // demo@viralclone.app: one Standard pack and some generations → balance 12.
  generate({ id: 'job-demo-free', userId: 'usr-demo', templateId: 'tpl-eye', quality: 'fast', variants: 1, startedAt: ago(20), state: 'done', free: true });
  buy('pur-demo-standard', 'usr-demo', 'pack-standard', ago(14), 'paid', 'VC-000004');
  generate({ id: 'job-demo-shower', userId: 'usr-demo', templateId: 'tpl-shower', quality: 'best', variants: 1, startedAt: ago(13), state: 'done' });
  generate({ id: 'job-demo-story', userId: 'usr-demo', templateId: 'tpl-story', quality: 'fast', variants: 1, startedAt: ago(6), state: 'done' });
  generate({ id: 'job-demo-stopped', userId: 'usr-demo', templateId: 'tpl-stop', quality: 'best', variants: 1, startedAt: ago(2), state: 'stopped' });
  generate({ id: 'job-demo-running', userId: 'usr-demo', templateId: 'tpl-layering', quality: 'fast', variants: 1, startedAt: ago(0, 3), state: 'running' });

  // paying@example.com: a refunded pack, a paid pack, credits added by the admin, a checkout that was not completed.
  generate({ id: 'job-paying-free', userId: 'usr-paying', templateId: 'tpl-eye', quality: 'fast', variants: 1, startedAt: ago(39), state: 'done', free: true });
  buy('pur-paying-starter', 'usr-paying', 'pack-starter', ago(38), 'refunded', 'VC-000001', ago(36));
  buy('pur-paying-studio', 'usr-paying', 'pack-studio', ago(32), 'paid', 'VC-000002');
  generate({ id: 'job-paying-story', userId: 'usr-paying', templateId: 'tpl-story', quality: 'best', variants: 1, startedAt: ago(31), state: 'done' });
  rows.push({
    userId: 'usr-paying', at: ago(10), type: 'admin', change: jobCost('no-talking', 'best', 1), note: 'Credits back for a video that came out wrong',
    by: ADMIN, reason: 'Credits back for a video that came out wrong',
  });
  generate({ id: 'job-paying-shower', userId: 'usr-paying', templateId: 'tpl-shower', quality: 'best', variants: 3, startedAt: ago(4), state: 'done' });
  buy('pur-paying-standard', 'usr-paying', 'pack-standard', ago(1), 'not-completed', null);

  // free-only@example.com: the free video and nothing else.
  generate({ id: 'job-free-free', userId: 'usr-free', templateId: 'tpl-refused', quality: 'fast', variants: 1, startedAt: ago(5), state: 'done', free: true });

  // blocked@example.com: one pack and one job with 2 variants (not covered by the free video).
  buy('pur-blocked-starter', 'usr-blocked', 'pack-starter', ago(28), 'paid', 'VC-000003');
  generate({ id: 'job-blocked-layering', userId: 'usr-blocked', templateId: 'tpl-layering', quality: 'fast', variants: 2, startedAt: ago(27), state: 'done' });

  // The ledger: every row in time order, with the running balance of its user, and the lots each one drew from or filled.
  const balances = new Map<Id, number>();
  const customer = (type: LedgerType): Actor => (type === 'returned' ? { kind: 'system' } : { kind: 'customer' });
  const ledger = allocateLots(rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(({ by, reason, jobId, purchaseId, ...row }, index): LedgerEntry => {
    const balanceAfter = (balances.get(row.userId) ?? 0) + row.change;
    balances.set(row.userId, balanceAfter);
    return {
      id: `led-${index + 1}`, ...row, balanceAfter, by: by ?? customer(row.type), reason: reason ?? null,
      relatedJobId: jobId ?? null, relatedPurchaseId: purchaseId ?? null,
    };
  }));
  // Each job knows the entry of its charge and the one that gave it back.
  for (const record of jobs) {
    record.chargeEntryId = ledger.find((entry) => entry.relatedJobId === record.id && entry.change <= 0)?.id ?? null;
    record.refundEntryId = ledger.find((entry) => entry.relatedJobId === record.id && entry.type === 'returned')?.id ?? null;
  }

  const scans: Scan[] = [
    { id: 'scan-3', startedAt: ago(0, 120), source: 'topads', checked: 6, queued: 6, aboveThreshold: 1, prepared: 0, status: 'running', reason: null },
    { id: 'scan-2', startedAt: ago(0, 125), source: 'shorts', checked: 0, queued: 0, aboveThreshold: 0, prepared: 0, status: 'stopped', reason: 'source-unavailable' },
    { id: 'scan-1', startedAt: ago(0, 900), source: 'topads', checked: 15, queued: 15, aboveThreshold: 4, prepared: 3, status: 'done', reason: null },
  ];

  // Titles, views, lengths and scores as on the board `A-Gelen`.
  const candidates: Candidate[] = [
    { id: 'cand-1', title: 'Story told in on-screen text', source: 'topads', views: '27.2M', seconds: 16, score: 86, scoreNotes: ['The story is told entirely in on-screen text, which the template can reuse.', 'One product is shown from the first second.'], image: sample('46a25bbd04d2da54503c58bfbd05efee'), foundAt: ago(0, 900) },
    { id: 'cand-2', title: 'Phone screen recording: product page and reviews', source: 'shorts', views: '15.2M', seconds: 25, score: 58, scoreNotes: ['The product page is a screen recording: no person, no product in hand.', 'The reviews are real and cannot be reproduced.', 'Too slow in the first five seconds.'], image: sample('29d17f8e71e518c213e1c982faf29cea'), foundAt: ago(0, 900) },
    { id: 'cand-3', title: 'Mascara routine and fast photo montage', source: 'topads', views: '5.0M', seconds: 16, score: 49, scoreNotes: ['Fast photo montage needs more photos than a customer uploads.'], image: sample('a90d6e55d4ab895c96ff1e0caeddb61f'), foundAt: ago(1, 180) },
    { id: 'cand-4', title: 'Month-by-month growth diary', source: 'shorts', views: '3.1M', seconds: 15, score: 41, scoreNotes: ['The growth diary needs footage over several months.', 'No product is named.'], image: sample('46a25bbd04d2da54503c58bfbd05efee'), foundAt: ago(1, 180) },
    { id: 'cand-5', title: 'ASMR drink prep', source: 'topads', views: '3.0M', seconds: 22, score: 63, scoreNotes: ['Drink prep: the product is a drink, not a beauty product.'], image: sample('29d17f8e71e518c213e1c982faf29cea'), foundAt: ago(2, 60) },
  ];

  // Defaults of the spec (§7): three scans a day, threshold 70, daily caps 45 and 10.
  const settings: AdminSettings = {
    scanTimes: ['09:00', '15:00', '21:00'], threshold: 70, dailyCandidates: 45, dailyTemplates: 10, providerAccount: 'default',
    topAdsIndustry: 'beauty-personal-care', topAdsCountry: 'US', topAdsPeriod: 7,
    sources: { topads: true, shorts: true }, searches: [], secondsMin: 6, secondsMax: 35, shortsMinViews: 500_000, topAdsCards: 30, perScan: 15,
  };

  return { jobs, purchases, invoices, ledger, scans, candidates, settings };
}
