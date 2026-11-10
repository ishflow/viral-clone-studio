import enAccount from '@/messages/en/account.json';
import trAccount from '@/messages/tr/account.json';
import enAdminActions from '@/messages/en/adminActions.json';
import trAdminActions from '@/messages/tr/adminActions.json';
import enAdminJobs from '@/messages/en/adminJobs.json';
import trAdminJobs from '@/messages/tr/adminJobs.json';
import enAdminOverview from '@/messages/en/adminOverview.json';
import trAdminOverview from '@/messages/tr/adminOverview.json';
import enAdminRevenue from '@/messages/en/adminRevenue.json';
import trAdminRevenue from '@/messages/tr/adminRevenue.json';
import enAdminSettings from '@/messages/en/adminSettings.json';
import trAdminSettings from '@/messages/tr/adminSettings.json';
import enAdminTemplates from '@/messages/en/adminTemplates.json';
import trAdminTemplates from '@/messages/tr/adminTemplates.json';
import enAdminUsers from '@/messages/en/adminUsers.json';
import trAdminUsers from '@/messages/tr/adminUsers.json';
import enAuth from '@/messages/en/auth.json';
import trAuth from '@/messages/tr/auth.json';
import enCheckout from '@/messages/en/checkout.json';
import trCheckout from '@/messages/tr/checkout.json';
import enCommon from '@/messages/en/common.json';
import trCommon from '@/messages/tr/common.json';
import enEmails from '@/messages/en/emails.json';
import trEmails from '@/messages/tr/emails.json';
import enGallery from '@/messages/en/gallery.json';
import trGallery from '@/messages/tr/gallery.json';
import enGenerate from '@/messages/en/generate.json';
import trGenerate from '@/messages/tr/generate.json';
import enJobs from '@/messages/en/jobs.json';
import trJobs from '@/messages/tr/jobs.json';
import enMarketing from '@/messages/en/marketing.json';
import trMarketing from '@/messages/tr/marketing.json';
import enSwap from '@/messages/en/swap.json';
import trSwap from '@/messages/tr/swap.json';
import enTitles from '@/messages/en/titles.json';
import trTitles from '@/messages/tr/titles.json';
import enVideos from '@/messages/en/videos.json';
import trVideos from '@/messages/tr/videos.json';
import { flatten } from './translate';
import type { Locale, Messages } from './types';

type Tree = Parameters<typeof flatten>[0];

/** Add each new namespace file here (and in both languages). */
const NAMESPACES: Record<Locale, Record<string, Tree>> = {
  en: {
    account: enAccount,
    adminActions: enAdminActions,
    adminJobs: enAdminJobs,
    adminOverview: enAdminOverview,
    adminRevenue: enAdminRevenue,
    adminSettings: enAdminSettings,
    adminTemplates: enAdminTemplates,
    adminUsers: enAdminUsers,
    auth: enAuth,
    checkout: enCheckout,
    common: enCommon,
    emails: enEmails,
    gallery: enGallery,
    generate: enGenerate,
    jobs: enJobs,
    marketing: enMarketing,
    swap: enSwap,
    titles: enTitles,
    videos: enVideos,
  },
  tr: {
    account: trAccount,
    adminActions: trAdminActions,
    adminJobs: trAdminJobs,
    adminOverview: trAdminOverview,
    adminRevenue: trAdminRevenue,
    adminSettings: trAdminSettings,
    adminTemplates: trAdminTemplates,
    adminUsers: trAdminUsers,
    auth: trAuth,
    checkout: trCheckout,
    common: trCommon,
    emails: trEmails,
    gallery: trGallery,
    generate: trGenerate,
    jobs: trJobs,
    marketing: trMarketing,
    swap: trSwap,
    titles: trTitles,
    videos: trVideos,
  },
};

/** Registered namespace names per locale (the test compares them with the files on disk). */
export const REGISTERED_NAMESPACES = (locale: Locale): string[] => Object.keys(NAMESPACES[locale]).sort();

function load(locale: Locale): Messages {
  const out: Messages = {};
  for (const [ns, tree] of Object.entries(NAMESPACES[locale])) flatten({ [ns]: tree }, '', out);
  return out;
}

/** English is merged under the chosen locale, so a missing Turkish key falls back to English. */
export function loadMessages(locale: Locale): Messages {
  return locale === 'en' ? load('en') : { ...load('en'), ...load(locale) };
}

/**
 * The namespaces the public pages use: everything under `(site)`, the root error, forbidden and not-found pages, and the header, footer and
 * cookie notice they carry. The root layout sends only these to the browser; `(app)`, `(auth)`, `admin` and `dev` add the rest
 * (`FullMessages`). `public-namespaces.test.ts` fails when code reachable from a public page asks for any other namespace.
 */
export const PUBLIC_NAMESPACES: readonly string[] = ['common', 'gallery', 'marketing', 'titles'];

const isPublic = (key: string) => PUBLIC_NAMESPACES.includes(key.slice(0, key.indexOf('.')));

function pick(messages: Messages, wanted: boolean): Messages {
  return Object.fromEntries(Object.entries(messages).filter(([key]) => isPublic(key) === wanted));
}

/** The part of the messages the public pages need. */
export const publicMessages = (messages: Messages): Messages => pick(messages, true);

/** The rest: what a page behind a sign-in (or the admin and dev pages) needs on top of `publicMessages`. */
export const otherMessages = (messages: Messages): Messages => pick(messages, false);
