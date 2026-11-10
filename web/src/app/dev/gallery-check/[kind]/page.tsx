import { notFound } from 'next/navigation';
import { data } from '@/data';
import { GalleryLoading, TemplateDetail } from '@/features/gallery';
import { PageFrame } from '@/shared/ui';
import { SessionHeader } from '@/shared/ui/SessionHeader';

/** Dev only: renders the gallery loading skeleton and a template with a very long title, for the screenshot checks of Task 9. */
export default async function GalleryCheck({ params }: { params: Promise<{ kind: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { kind } = await params;
  if (kind === 'loading') {
    return (
      <PageFrame header={<SessionHeader />}>
        <GalleryLoading categories={await data.catalog.categories()} />
      </PageFrame>
    );
  }
  if (kind === 'long-title') {
    const template = await data.catalog.get('tpl-layering');
    if (!template) notFound();
    return (
      <PageFrame header={<SessionHeader />}>
        <TemplateDetail template={{ ...template, title: 'Superlongtemplatetitlewithoutanybreaksatallinsideitsixtychars' }} />
      </PageFrame>
    );
  }
  notFound();
}
