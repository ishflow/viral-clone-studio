import { notFound } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { data } from '@/data';
import { GenerationPausedError, RULES, type Estimate, type SwapSlot, type Template } from '@/data/ports';
import { SWAP_QUALITY } from './schema';

/** A person-swap video as a card of the list. `credits`: what the data layer asks for it; null when it gives no price now (generation is paused). `uses`: how many swaps of it were done, all customers together. */
export type SwapCard = { id: string; title: string; image: string; video: string | null; seconds: number; people: number; credits: number | null; uses: number };
/** A person-swap video as its page shows it. `persons`: the number and the place of each person on the picture (percent of it). */
export type SwapVideo = Omit<SwapCard, 'credits' | 'uses'> & { persons: Pick<SwapSlot, 'slot' | 'box'>[] };
/** `estimate`: the price, the balance and the minutes, from the data layer; null while generation is paused (`paused`). `consentVersion`: the text of the three boxes this page shows. `reviewed`: an admin looks at the photographs first (the form says so only then). */
export type SwapVideoLoad = { template: SwapVideo; estimate: Estimate | null; paused: boolean; consentVersion: string; reviewed: boolean };

const asCard = (template: Template) => ({
  id: template.id, title: template.title, image: template.image || template.referenceImage || '', video: template.video, seconds: template.seconds,
  people: template.swap?.people ?? 1,
});

/** The estimate for this user and video; null when the data layer gives none now. The price on every screen is this one: nothing is worked out here. */
async function estimateOf(userId: string, templateId: string): Promise<{ estimate: Estimate | null; paused: boolean }> {
  try {
    return { estimate: await data.swap.estimate(userId, { templateId, quality: SWAP_QUALITY, people: [] }), paused: false };
  } catch (error) {
    return { estimate: null, paused: error instanceof GenerationPausedError };
  }
}

/** What `/swap` shows, the most used video first (videos used the same number of times keep the order of the catalog). Signed out → login and back; while person swap is switched off → 404. Switched on with no video published: no cards. */
export async function loadSwapGallery(): Promise<{ cards: SwapCard[] }> {
  const user = await requireUser('/swap');
  if (!(await data.swap.enabled())) notFound();
  const [templates, uses] = await Promise.all([data.swap.templates(), data.swap.uses()]);
  const cards = await Promise.all(templates.map(async (template) => ({ ...asCard(template), credits: (await estimateOf(user.id, template.id)).estimate?.credits ?? null, uses: uses[template.id] ?? 0 })));
  return { cards: cards.sort((a, b) => b.uses - a.uses) };
}

/** What `/swap/[id]` shows. Signed out → login and back; an unknown video, a product template, or person swap switched off → 404. */
export async function loadSwapVideo(id: string): Promise<SwapVideoLoad> {
  const user = await requireUser(`/swap/${id}`);
  const template = await data.swap.template(id);
  if (!template?.swap) notFound();
  return {
    template: { ...asCard(template), persons: template.swap.persons.map(({ slot, box }) => ({ slot, box })) },
    ...(await estimateOf(user.id, id)),
    consentVersion: RULES.swapConsentVersion,
    reviewed: await data.swap.reviewed(),
  };
}
