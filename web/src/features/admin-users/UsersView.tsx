'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { formatDate } from '@/shared/lib/format';
import { buttonClass, DataTable, Icon, LinkButton, PageHead, Pager, Segmented, StatusLine } from '@/shared/ui';
import { USER_FILTERS, usersHref, type UserFilter } from './query';

export type UserListRow = {
  id: string; email: string; name: string; joinedAt: string; lastActiveAt: string; verified: boolean; blocked: boolean;
  balance: number; paidTotal: string | null; creditsSpent: number; videos: number;
};

/** "Verified" is a quiet check; "Not verified" is the open ring (as on the board). */
function VerifiedMark({ verified, label }: { verified: boolean; label: string }) {
  return verified ? (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <Icon name="done" size={18} strokeWidth={2.6} className="text-text-3" />
      {label}
    </span>
  ) : (
    <StatusLine kind="waiting" className="whitespace-nowrap">{label}</StatusLine>
  );
}

/** `/admin/users`. Search and filter are plain links and a GET form, so the URL says what is shown. */
export function UsersView({ rows, filter, q, total }: { rows: UserListRow[]; filter: UserFilter; q: string; total: number }) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  return (
    <div className="flex flex-col gap-8">
      <PageHead
        title={t('adminUsers.title')}
        lead={t('adminUsers.lead')}
        actions={
          <div className="flex w-full flex-col items-stretch nav:w-auto">
          <a href={usersHref('/admin/users/export', { filter, q })} download className={buttonClass('secondary', 'm', false, 'gap-2 max-nav:w-full')}>
            <Icon name="download" size={20} />
            {t('adminUsers.export')}
          </a>
          </div>
        }
      />
      <section aria-label={t('adminUsers.list.label')} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <form method="get" action="/admin/users" role="search" className="relative flex max-w-105 min-w-0 flex-[1_1_320px] items-center">
            {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
            <label htmlFor="user-search" className="sr-only">{t('adminUsers.search.label')}</label>
            <span aria-hidden="true" className="pointer-events-none absolute left-4 flex text-text-3"><Icon name="search" size={20} /></span>
            <input
              id="user-search"
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t('adminUsers.search.placeholder')}
              className="box-border min-h-13 w-full rounded-12 border border-edge-strong bg-bg py-0 pr-4 pl-12 text-15 text-text"
            />
          </form>
          <Segmented
            label={t('adminUsers.filter.label')}
            value={filter}
            options={USER_FILTERS.map((value) => ({ value, label: t(`adminUsers.filter.${value}`) }))}
            hrefFor={(value) => usersHref('/admin/users', { filter: value as UserFilter, q })}
          />
        </div>
        <DataTable
          caption={t('adminUsers.table.caption')}
          minWidth={1120}
          columns={[
            { key: 'user', header: t('adminUsers.table.user') },
            { key: 'joined', header: t('adminUsers.table.joined') },
            { key: 'email', header: t('adminUsers.table.email') },
            { key: 'balance', header: t('adminUsers.table.balance'), numeric: true },
            { key: 'paid', header: t('adminUsers.table.paid'), numeric: true },
            { key: 'spent', header: t('adminUsers.table.spent'), numeric: true },
            { key: 'videos', header: t('adminUsers.table.videos'), numeric: true },
            { key: 'last', header: t('adminUsers.table.lastActive') },
            { key: 'status', header: t('adminUsers.table.status') },
            { key: 'actions', header: t('adminUsers.table.actions'), numeric: true, srOnlyHeader: true },
          ]}
          rows={rows.map((row) => ({
            id: row.id,
            cells: {
              user: (
                <span className="flex flex-col gap-1">
                  <span title={row.email} className="block truncate max-nav:max-w-48">{row.email}</span>
                  <span className="block text-13 leading-snug font-normal whitespace-nowrap text-text-3">{row.name}</span>
                </span>
              ),
              joined: <span className="whitespace-nowrap">{formatDate(row.joinedAt, locale)}</span>,
              email: <VerifiedMark verified={row.verified} label={t(row.verified ? 'adminUsers.verified' : 'adminUsers.notVerified')} />,
              balance: number.format(row.balance),
              paid: row.paidTotal ?? t('adminUsers.placeholder.amount'),
              spent: number.format(row.creditsSpent),
              videos: number.format(row.videos),
              last: <span className="whitespace-nowrap">{formatDate(row.lastActiveAt, locale)}</span>,
              status: <StatusLine kind={row.blocked ? 'stopped' : 'running'} className="whitespace-nowrap">{t(row.blocked ? 'adminUsers.status.blocked' : 'adminUsers.status.active')}</StatusLine>,
              actions: (
                <Link href={`/admin/users/${row.id}`} className="-m-3 inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-15 font-medium text-accent-text no-underline hover:text-text">
                  {t('adminUsers.open')}
                </Link>
              ),
            },
          }))}
          empty={{
            text: t('adminUsers.empty.text'),
            action: <LinkButton href="/admin/users" variant="secondary">{t('adminUsers.empty.clear')}</LinkButton>,
          }}
        />
        <Pager shown={rows.length} total={total} />
      </section>
    </div>
  );
}
