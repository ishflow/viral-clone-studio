export const CONSENT_COOKIE = 'vc_cookies';
export type ConsentChoice = 'all' | 'necessary';

export function readConsent(value: string | undefined): ConsentChoice | null {
  return value === 'all' || value === 'necessary' ? value : null;
}
