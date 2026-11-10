/** "/account?tab=x" from a full or relative request URL. */
export function pathFromRequest(url: string): string {
  const u = new URL(url, 'http://x');
  return u.pathname + u.search;
}
