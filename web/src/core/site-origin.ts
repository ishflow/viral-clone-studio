import { headers } from "next/headers";

/**
 * The address the share card (`opengraph-image`, the sitemap) is served at must be absolute: it is the host the visitor used, and `https` when the
 * proxy in front says so (as `proxy.ts` reads it). With no host the base is left to Next.
 */
export async function siteOrigin(): Promise<URL | undefined> {
  const list = await headers();
  const host = list.get("host");
  if (!host) return undefined;
  const proto = list.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ? "https" : "http";
  try {
    return new URL(`${proto}://${host}`);
  } catch {
    return undefined;
  }
}
