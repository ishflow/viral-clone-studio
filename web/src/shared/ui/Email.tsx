import type { ReactNode } from 'react';
import { BUSINESS } from '@/core/config';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char]!);

/**
 * An email address Cloudflare's address hiding leaves alone. Behind Cloudflare the address in the HTML is swapped for its own link, which no
 * longer matches what React built (hydration error #418), so the address is printed between `<!--email_off-->` comments, which Cloudflare skips,
 * and React does not compare what `dangerouslySetInnerHTML` prints. As a link the whole anchor goes inside, so its `mailto:` stays as it is too.
 * The address is escaped, so any text is safe here; `className` must be a constant.
 */
export function Email({ address, link = false, className }: { address: string; link?: boolean; className?: string }) {
  const text = escapeHtml(address);
  const inner = link ? `<a href="mailto:${text}"${className ? ` class="${escapeHtml(className)}"` : ''}>${text}</a>` : text;
  return <span dangerouslySetInnerHTML={{ __html: `<!--email_off-->${inner}<!--/email_off-->` }} />;
}

/** A message text with the support address (`{supportEmail}`) turned into `<Email>`; any other text comes back as it is. */
export function withEmail(text: string): ReactNode {
  const parts = text.split(BUSINESS.supportEmail);
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) => (i === 0 ? [part] : [<Email key={i} address={BUSINESS.supportEmail} />, part]));
}
