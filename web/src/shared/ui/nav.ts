export type VisitorKey = 'gallery' | 'how' | 'pricing';
export type CustomerKey = 'gallery' | 'swap' | 'videos' | 'pricing' | 'account';
export type PanelKey = 'overview' | 'users' | 'revenue' | 'jobs' | 'review' | 'templates' | 'settings';
export type MenuKind = 'visitor' | 'customer' | 'admin';

export type NavItem<K extends string = string> = { key: K; href: string; label: string };

/** `label` is a message key in `common`. */
export const VISITOR_NAV: NavItem<VisitorKey>[] = [
  { key: 'gallery', href: '/gallery', label: 'common.nav.gallery' },
  { key: 'how', href: '/#how', label: 'common.nav.howItWorks' },
  { key: 'pricing', href: '/pricing', label: 'common.nav.pricing' },
];

export const CUSTOMER_NAV: NavItem<CustomerKey>[] = [
  { key: 'gallery', href: '/gallery', label: 'common.nav.gallery' },
  { key: 'videos', href: '/videos', label: 'common.nav.myVideos' },
  { key: 'pricing', href: '/pricing', label: 'common.nav.pricing' },
  { key: 'account', href: '/account', label: 'common.nav.account' },
];

/** The customer menu. `swap`: person swap is open (`core/person-swap`), so its link follows the gallery; closed, no menu names it. */
export function customerNav(swap: boolean): NavItem<CustomerKey>[] {
  if (!swap) return CUSTOMER_NAV;
  const [gallery, ...rest] = CUSTOMER_NAV;
  return [gallery!, { key: 'swap', href: '/swap', label: 'common.nav.swap' }, ...rest];
}

export const PANEL_NAV: NavItem<PanelKey>[] = [
  { key: 'overview', href: '/admin', label: 'common.admin.overview' },
  { key: 'users', href: '/admin/users', label: 'common.admin.users' },
  { key: 'revenue', href: '/admin/revenue', label: 'common.admin.revenue' },
  { key: 'jobs', href: '/admin/jobs', label: 'common.admin.jobs' },
  { key: 'review', href: '/admin/jobs/review', label: 'common.admin.photoReview' },
  { key: 'templates', href: '/admin/templates', label: 'common.admin.templates' },
  { key: 'settings', href: '/admin/settings', label: 'common.admin.settings' },
];

export const NAV_BY_KIND = { visitor: VISITOR_NAV, customer: CUSTOMER_NAV, admin: PANEL_NAV } as const;

export const HOME_BY_KIND: Record<MenuKind, string> = { visitor: '/', customer: '/gallery', admin: '/admin' };

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** Which menu item a path belongs to (the boards mark none on the home page, checkout, invoices and the welcome page). */
export function currentFromPath(kind: MenuKind, pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  if (kind === 'visitor') {
    if (under(pathname, '/gallery')) return 'gallery';
    if (under(pathname, '/pricing')) return 'pricing';
    return undefined;
  }
  if (kind === 'customer') {
    if (under(pathname, '/gallery') || under(pathname, '/templates')) return 'gallery';
    if (under(pathname, '/swap')) return 'swap';
    if (under(pathname, '/videos') || under(pathname, '/jobs')) return 'videos';
    if (under(pathname, '/pricing')) return 'pricing';
    if (under(pathname, '/account')) return 'account';
    return undefined;
  }
  if (!under(pathname, '/admin')) return undefined;
  if (pathname === '/admin') return 'overview';
  // The longest address that holds the path: the photo review is under Jobs' address and is not Jobs.
  return PANEL_NAV.filter((i) => i.key !== 'overview' && under(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.key;
}
