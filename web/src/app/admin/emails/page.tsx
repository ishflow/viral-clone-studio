import { requireAdmin } from '@/core/session/guards';
import { DeliveryStatus } from '@/features/emails/DeliveryStatus';
import { pageTitle } from '@/core/i18n/page-title';
export const dynamic='force-dynamic';
export const generateMetadata = () => pageTitle('adminEmails');

export default async function EmailsPage(){await requireAdmin();return <DeliveryStatus />;}
