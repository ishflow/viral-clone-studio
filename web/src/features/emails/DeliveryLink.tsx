'use client';
import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
export function DeliveryLink(){const t=useT();return <Link href="/admin/emails" className="mx-6 inline-block py-3">{t('emails.delivery.title')}</Link>;}
