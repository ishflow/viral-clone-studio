import { assertSiteOwner } from './src/data/real/site-lock';
import { resolve } from 'node:path';
import type { NextConfig } from "next";

/**
 * Sent on every route (review C7c, I3).
 * - `script-src 'self' 'unsafe-inline'`: Next's own bootstrap and the data it hands to the page are inline `<script>` tags; without a per-request
 *   nonce (which would make every page dynamic) they cannot be allowed any other way. No `unsafe-eval` in production; `next dev` needs it for React.
 * - `style-src 'self' 'unsafe-inline'`: the pages use inline `style=` attributes.
 * - `connect-src 'self'`: the site talks only to itself (server actions, the media route); `next dev` adds its websocket.
 * - images, media and fonts: the site itself, `data:` and `blob:` (the product photo preview before upload).
 * `Permissions-Policy` is "empty" in the sense that every feature the site does not use has an empty allow-list.
 */
export function securityHeaders(production: boolean): { key: string; value: string }[] {
  const self = "'self'";
  const policy = [
    `default-src ${self}`,
    `script-src ${self} 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `media-src ${self} data: blob:`,
    `font-src ${self} data: blob:`,
    `connect-src ${self}`,
    `object-src 'none'`,
    `base-uri ${self}`,
    `form-action ${self}`,
    `frame-ancestors 'none'`,
  ].join("; ");
  const features = ["accelerometer", "camera", "display-capture", "geolocation", "gyroscope", "magnetometer", "microphone", "midi", "payment", "usb"];
  return [
    { key: "Content-Security-Policy", value: policy },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: features.map((feature) => `${feature}=()`).join(", ") },
  ];
}

// The business name, address and support email also render in client components: inline them at build time (they are public contact details).
const publicBusiness = Object.fromEntries(
  ['VC_BUSINESS_COMPANY', 'VC_BUSINESS_ADDRESS', 'VC_SUPPORT_EMAIL'].flatMap((name) => (process.env[name] ? [[name, process.env[name] as string]] : [])),
);

const nextConfig: NextConfig = {
  env: publicBusiness,
  turbopack: { root: resolve(__dirname, '..') }, // shared provider policy/budget with the worker
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    authInterrupts: true,
    // A product photo goes to a server action as it is picked (features/generate). The action refuses one over 10 MB with a field
    // error; the body limit sits above that so an 11 MB photo reaches the action instead of failing as a broken request.
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env.NODE_ENV === "production") }];
  },
};

/** Next loads this before listening; instrumentation itself is lazy until the first request. */
export default function configuration(phase: string): NextConfig {
  if (phase === 'phase-production-server' && process.env.VC_ENGINE === 'sqlite') {
    if (!process.env.VC_DATA_DIR) throw new Error('site-not-started: data-dir-required');
    assertSiteOwner(resolve(process.env.VC_DATA_DIR));
  }
  return nextConfig;
}
