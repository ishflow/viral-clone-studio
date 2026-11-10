import { data } from '@/data';
import type { Id } from '@/data/ports';
import { isGenerateForm, type Draft } from './draft-view';

export { DEFAULT_RETURN, isGenerateForm, type Draft } from './draft-view';

/** The video waiting behind `returnTo`, when `returnTo` is a generate form of a template the user can see. */
export async function loadDraft(userId: Id, returnTo: string): Promise<Draft | null> {
  const id = isGenerateForm(returnTo);
  if (!id) return null;
  const template = await data.catalog.get(id, userId);
  return template ? { title: template.title, image: template.image, products: template.products } : null;
}
