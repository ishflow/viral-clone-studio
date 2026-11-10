import { data } from '@/data';
import { GalleryLoading } from '@/features/gallery';

export default async function Loading() {
  return <GalleryLoading categories={await data.catalog.categories()} />;
}
