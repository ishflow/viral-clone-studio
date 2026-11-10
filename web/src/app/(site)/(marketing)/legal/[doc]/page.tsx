import { notFound } from 'next/navigation';
import { getI18n } from '@/core/i18n/server';
import { LegalView } from '@/features/marketing/LegalView';
import { isLegalDoc, LEGAL_DOCS } from '@/features/marketing/legal';

export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_DOCS.map((doc) => ({ doc }));
}

/** The tab says which document is open (an unknown one gets the 404 page and its own title). */
export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const { t } = await getI18n();
  return { title: isLegalDoc(doc) ? t(`marketing.legal.doc.${doc}`) : t('titles.notFound') };
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  return <LegalView doc={doc} />;
}
