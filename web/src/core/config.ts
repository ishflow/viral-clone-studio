export const SITE = { name: 'Viral Clone', domain: 'viralclone.app' } as const;
export const PASSWORD_MIN_LENGTH = 8;
/** Who runs the service: the one place for the name, address and support email shown (read from `VC_BUSINESS_COMPANY`, `VC_BUSINESS_ADDRESS`, `VC_SUPPORT_EMAIL`; `next.config.ts` inlines them into the browser bundle at build time) on the site, the invoice and the legal pages (messages reach them as `{company}`, `{address}`, `{supportEmail}`). */
export const BUSINESS = {
  company: process.env.VC_BUSINESS_COMPANY || 'ishflow',
  address: process.env.VC_BUSINESS_ADDRESS || '123 Example St, City, Country',
  supportEmail: process.env.VC_SUPPORT_EMAIL || 'owner@example.com',
} as const;
