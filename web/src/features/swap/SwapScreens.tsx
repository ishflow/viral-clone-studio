import { loadSwapGallery, loadSwapVideo } from './load';
import { SwapForm } from './SwapForm';
import { SwapGallery } from './SwapGallery';

/** `/swap`: the videos a person can be swapped into; 404 while person swap is switched off. */
export async function SwapGalleryScreen() {
  const { cards } = await loadSwapGallery();
  return <SwapGallery cards={cards} />;
}

/** `/swap/[id]`: the video and the form that starts a person swap from it; 404 for anything that is not an offered person-swap video. */
export async function SwapVideoScreen({ id }: { id: string }) {
  const loaded = await loadSwapVideo(id);
  return <SwapForm template={loaded.template} estimate={loaded.estimate} paused={loaded.paused} consentVersion={loaded.consentVersion} reviewed={loaded.reviewed} />;
}
