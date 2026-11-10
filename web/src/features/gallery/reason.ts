const KNOWN = ['split-screen', 'bad-range', 'too-long', 'source-unavailable'];

/** Message key for a preparation-note code, with a generic fallback for a code this site does not know. */
export function reasonKey(code: string | null): string {
  return code && KNOWN.includes(code) ? `gallery.reason.${code}` : 'gallery.reason.unknown';
}
