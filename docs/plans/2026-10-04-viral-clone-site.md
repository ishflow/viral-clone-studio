# Viral Clone Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Viral Clone website (every screen on the design canvas: customer, account, checkout, emails, admin) as a running Next.js app in `web/`, in dark + light and desktop + phone, with all account, payment, email and generation behavior served by fake implementations behind typed interfaces.

**Architecture:** One Next.js App Router app. `core/` (tokens, i18n, session) knows nothing; `shared/ui` holds the components that mirror the canvas parts (`docs/design/uretec/parts.py`, `panel.py`); each `features/<name>` owns its pages' logic and never imports another feature; `data/` defines ports (interfaces) and one in-memory fake per port, selected in `data/index.ts`. Pages in `app/` are thin shells that call a feature.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), React 19, TypeScript strict, Tailwind CSS v4 (theme limited to the brand tokens), Zod, Vitest + Testing Library, Playwright (system Chrome), pnpm.

**Spec:** `docs/specs/2026-10-03-galeri-sitesi-design.md` (§2, §3, §8, §13–§16). Design source of truth: `docs/design/tuval/project/*.dc.html` (one file per screen; inline styles are the exact values) and `docs/design/uretec/KURALLAR.md` (product facts, vocabulary, brand measures).

## Global Constraints

- **No `git commit`, no push, no deploy.** At the end of each task run `git add -A web docs` and paste `git diff --cached --stat` in the report. The owner has not asked for commits.
- **No paid or external calls.** No request to Magnific, Claude API, a payment provider, an email service. Fonts via `next/font/google` are the only network use.
- **No secrets** in any file. No `.env` values written.
- **New dependencies:** only the ones listed in Task 1. Anything else: do not add; report the need.
- **Copy:** every user-visible string comes from `web/src/messages/<locale>/<namespace>.json`. English is the source; Turkish must exist for every key. No hard-coded UI text in components (test in Task 15 enforces key parity).
- **No invented facts:** prices and legal text stay placeholders exactly as on the canvas (`[PRICE]`, `[LEGAL TEXT]`, `[REFUND POLICY]`, `[CREDIT VALIDITY PERIOD]`, `[COMPANY NAME]`, `[ADDRESS]`, `[TAX ID]`, `[RESPONSE TIME]`…). Credit counts in the fake data are demo values from `data/mock/demo-values.ts` only.
- **No in-site ads, promos or "upgrade" cards.**
- **Brand measures (spec §14):** colors only through tokens; type sizes 13 / 15 / 17 / 20 / 24 / 32 + the fluid headings; spacing 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72 / 112; radius 8 / 12 / 16 / 24 / full; control heights 44 / 52 / 60 / 72; touch targets ≥ 44 px; icon stroke 2. Lime rule: one lime panel or one lime primary button in view (header "Get started" does not count). Lime as text only via `--accent-text`.
- **Layering:** `features/X` must not import `features/Y`. `shared` must not import `features`. `core` imports nothing from the app. `app/` pages contain no business logic.
- **Accessibility:** real `button` / `a` / `label` / `table`; every flow works by keyboard; visible focus ring; dialogs trap focus and close on Escape; `prefers-reduced-motion` respected.
- **Fidelity:** each page must match its board at 1440 px and 390 px, dark and light. Compare your Playwright screenshot with the board PNG (`docs/design/tuval/pv-ref/…`, produced by `preview_dc.py`) by eye before reporting.
- **Parallel work:** several tasks run at the same time in the same folder. Touch only the files your task lists. Run the dev server with your own port and build dir: `NEXT_DIST_DIR=.next-<task> pnpm dev -p <port>`.

## Review Focus

1. **Session missing or expired on a signed-in page** → redirect to `/login?next=<path>`, never a crash or an empty shell. (Task 4 test.)
2. **Not enough credits at the moment of confirm** (balance changed between estimate and confirm) → no job is created, ledger untouched, the "not enough credits" dialog shows. (Task 3 test + Task 10.)
3. **Double submit** of confirm / pay / add-credits → exactly one job, one purchase, one ledger entry. (Task 3 tests.)
4. **Unknown id in the URL** (`/templates/x`, `/jobs/x`, `/invoices/x`, `/admin/users/x`) or another user's job / invoice / private template → the 404 page. (Task 3 + page tests.)
5. **Non-admin opens `/admin/*`** → 404, and no admin data in the response. (Task 4 test.)
6. **Long or empty text**: 60-character product name, empty search result, Turkish strings 30 % longer → layout wraps, nothing overflows at 390 px. (Task 16 screenshots.)

---

## File Structure

```
web/
  package.json  next.config.ts  tsconfig.json  postcss.config.mjs  eslint.config.mjs
  vitest.config.ts  vitest.setup.ts  playwright.config.ts
  public/samples/            sample media for the fake catalog (6 template images, 2 mp4)
  e2e/                       Playwright specs + shots.ts (screenshots of every route)
  src/
    app/                     routes only (spec §3)
      layout.tsx  globals.css  not-found.tsx
      (site)/…               visitor pages: /, /pricing, /legal/[doc], /contact
      (auth)/…               /login, /signup, /verify-email, /welcome, /forgot-password, /forgot-password/sent, /reset-password
      (app)/…                signed-in: /gallery, /templates/…, /jobs/…, /videos, /account, /checkout/…, /invoices/[id]
      admin/…                /admin/**
      dev/emails/[name]/     email previews
    core/
      tokens.css             CSS variables (dark + light) — the only place hex values live
      i18n/                  messages loader, t(), plural, locale cookie, I18nProvider
      session/               cookie session, requireUser, requireAdmin
      theme/                 theme cookie + <html data-theme>
      config.ts              site constants (name, domain, support placeholders)
    shared/
      ui/                    Icon, Logo, Button, Field, Card, Tag, StatusLine, Segmented, Dialog, Skeleton, EmptyState,
                             HeaderVisitor, HeaderCustomer, HeaderPanel, MobileMenu, Footer, CookieNotice, LanguageMenu,
                             VideoCard, Tile, DataTable, Pager, SubNav, PageHead, ChartSlot
      lib/                   format.ts (credits, dates, duration), cx.ts
    data/
      ports.ts               types + interfaces
      index.ts               the one place that picks implementations
      mock/                  store.ts, demo-values.ts, fixtures/*.ts, auth.ts, catalog.ts, jobs.ts, ledger.ts, payments.ts,
                             invoices.ts, mailer.ts, admin.ts
    features/
      marketing/ auth/ gallery/ generate/ jobs/ videos/ account/ checkout/ emails/
      admin-overview/ admin-users/ admin-revenue/ admin-jobs/ admin-templates/ admin-settings/
    messages/
      en/<namespace>.json    tr/<namespace>.json     (namespace = feature name, plus `common`)
```

Board → component map for `shared/ui` (read the board / part to get exact styles):

| Component | Source |
|---|---|
| `Icon` | `parts.py` `ICON` dict (24 grid, stroke 2; `play` is filled) |
| `Logo` | logo `<a>` in `A-Hesap.dc.html` header |
| `Button` (`primary`/`secondary`/`quiet`/`warn`, size `m`/`l`) | `parts.py` `PRIMARY`, `PRIMARY_L`, `SECONDARY`, `SECONDARY_L`, `QUIET`; warn = `border: 1px solid var(--warn-edge); color: var(--warn)` |
| `Field` (`Input`, `Select`, `Textarea`, label, error) | `parts.py` `INPUT`, `LABEL`; error line in `A-Form-Hata.dc.html` |
| `Card`, `Tag`, `StatusLine` | `parts.py` `CARD`, `TAG`, `status()` |
| `HeaderCustomer` / `HeaderVisitor` / `HeaderPanel` | `parts.header_in`, `parts.header_out`, `panel.header_panel`; phone form `parts.header_m` |
| `MobileMenu` | `A-Menu-M`, `A-Menu-Ziyaretci-M`, `A-Menu-Admin-M` boards |
| `Footer` | `<footer>` in `A-Fiyatlar.dc.html` |
| `CookieNotice`, `LanguageMenu` | `A-Cerez.dc.html`, `A-Dil-Menusu.dc.html` |
| `VideoCard` | `parts.video_card` |
| `Tile`, `DataTable`, `Pager`, `SubNav`, `PageHead`, `Segmented`, `ChartSlot` | `panel.py` |
| `Skeleton`, `EmptyState` | `A-Galeri-Yukleniyor.dc.html`, `A-Uretimlerim-Bos.dc.html` |
| `Dialog` | `A-Onay.dc.html`, `A-Hesap-Sil.dc.html` (desktop: centered card; phone: full-width sheet from the bottom) |

---

### Task 1: Scaffold, tokens, theme

**Files:**
- Create: `web/` via create-next-app; `web/src/core/tokens.css`, `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/src/core/theme/theme.ts`, `web/src/core/theme/theme.test.ts`, `web/src/core/config.ts`, `web/vitest.config.ts`, `web/vitest.setup.ts`, `web/playwright.config.ts`, `web/src/shared/lib/cx.ts`
- Modify: `web/next.config.ts`, `web/package.json`

**Interfaces:**
- Produces: Tailwind utilities for the brand tokens (below); `readTheme(cookieValue: string | undefined): 'system' | 'dark' | 'light'`; `THEME_COOKIE = 'vc_theme'`; `cx(...parts: (string | false | null | undefined)[]): string`; scripts `pnpm dev`, `pnpm test`, `pnpm e2e`, `pnpm lint`, `pnpm typecheck`.

- [ ] **Step 1: Scaffold.** From `/path/to/viral-clone`: `pnpm create next-app@latest web --ts --app --src-dir --tailwind --eslint --import-alias "@/*" --use-pnpm --no-turbopack --yes` (if a flag is rejected, run `pnpm create next-app@latest --help` and use the current equivalent; do not guess). Then in `web/`: `pnpm add zod` and `pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test`. Delete the starter page content and starter SVGs in `public/`.
- [ ] **Step 2: Config.** `next.config.ts`: `const nextConfig = { distDir: process.env.NEXT_DIST_DIR ?? '.next' }`. `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`. `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"e2e": "playwright test"`, `"typecheck": "tsc --noEmit"`. `vitest.config.ts`: react plugin, `environment: 'jsdom'`, `setupFiles: ['./vitest.setup.ts']`, alias `@` → `./src`, `include: ['src/**/*.test.{ts,tsx}']`. `vitest.setup.ts`: `import '@testing-library/jest-dom/vitest'`. `playwright.config.ts`: `testDir: './e2e'`, `use: { channel: 'chrome', baseURL: 'http://localhost:3100' }`, `webServer: { command: 'NEXT_DIST_DIR=.next-e2e pnpm dev -p 3100', url: 'http://localhost:3100', reuseExistingServer: true }`. Add `.next-*` and `e2e/__shots__` to `web/.gitignore`.
- [ ] **Step 3: Failing test** `src/core/theme/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readTheme } from './theme';

describe('readTheme', () => {
  it('returns the stored choice', () => {
    expect(readTheme('dark')).toBe('dark');
    expect(readTheme('light')).toBe('light');
  });
  it('falls back to system for a missing or unknown value', () => {
    expect(readTheme(undefined)).toBe('system');
    expect(readTheme('purple')).toBe('system');
  });
});
```

Run `pnpm test` → FAIL (module not found).
- [ ] **Step 4: Implement** `src/core/theme/theme.ts`:

```ts
export const THEME_COOKIE = 'vc_theme';
export type ThemeChoice = 'system' | 'dark' | 'light';

export function readTheme(value: string | undefined): ThemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system';
}
```

Run `pnpm test` → PASS.
- [ ] **Step 5: Tokens.** `src/core/tokens.css` (values are spec §14; this is the only file with hex):

```css
:root, [data-theme="dark"] {
  --bg:#0B0C0A; --surface:#151712; --raised:#1C1F17; --line:#23261E; --edge:#33372B; --edge-strong:#676B5D;
  --text:#F2F3EC; --text-2:#C9CCBF; --text-3:#A9AC9F;
  --accent:#C8F03C; --accent-hover:#E0FF7A; --accent-text:#C8F03C; --on-accent:#0B0C0A;
  --warn:#FF9A6B; --warn-edge:#5A3A2A; --mark-edge:#C8F03C;
  --scrim:rgba(11,12,10,0.76); --on-scrim:#F2F3EC; --media-edge:transparent;
}
[data-theme="light"] {
  --bg:#F4F5EE; --surface:#FFFFFF; --raised:#E8EADF; --line:#E0E2D7; --edge:#CBCEBF; --edge-strong:#80856F;
  --text:#0B0C0A; --text-2:#3E4236; --text-3:#5A5F50;
  --accent-hover:#B6E01F; --accent-text:#456300;
  --warn:#A8400F; --warn-edge:#E3B7A2; --mark-edge:#0B0C0A; --media-edge:rgba(11,12,10,0.12);
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    --bg:#F4F5EE; --surface:#FFFFFF; --raised:#E8EADF; --line:#E0E2D7; --edge:#CBCEBF; --edge-strong:#80856F;
    --text:#0B0C0A; --text-2:#3E4236; --text-3:#5A5F50;
    --accent-hover:#B6E01F; --accent-text:#456300;
    --warn:#A8400F; --warn-edge:#E3B7A2; --mark-edge:#0B0C0A; --media-edge:rgba(11,12,10,0.12);
  }
}
```

`src/app/globals.css`: `@import "tailwindcss"; @import "../core/tokens.css";` then a Tailwind v4 `@theme inline` block that **replaces** the default palette, radii and font sizes with the brand ones (verify the exact v4 syntax in the Tailwind docs, do not write it from memory): colors `bg surface raised line edge edge-strong text text-2 text-3 accent accent-hover accent-text on-accent warn warn-edge scrim on-scrim media-edge` each mapped to its `var(--…)`; font sizes `13 15 17 20 24 32` (utilities `text-13` … `text-32`); radii `8 12 16 24 full`; fonts `display`, `body`; one custom breakpoint `nav: 56.25rem` (900 px: below it the phone header is used). Spacing stays Tailwind's 4 px base; use only steps 1, 2, 3, 4, 6, 8, 12, 18, 28. Add the fluid heading classes as plain CSS in `@layer components`: `.h-display-2 { font: 800 clamp(36px, 4.6vw, 64px)/0.98 var(--font-display); letter-spacing: -0.03em }`, `.h-display-3 { font: 800 clamp(32px, 4vw, 52px)/1 var(--font-display); letter-spacing: -0.03em }`, `.h-4 { font: 800 32px/1.1 var(--font-display); letter-spacing: -0.02em }`, `.h-5 { font: 700 24px/1.2 var(--font-display); letter-spacing: -0.01em }`, `.h-6 { font: 700 20px/1.25 var(--font-display); letter-spacing: -0.01em }`. Base: `body { background: var(--bg); color: var(--text); font-family: var(--font-body) }`, `a { color: var(--accent-text) }`, `:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px }`, and `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important } }`.
- [ ] **Step 6: Root layout.** `src/app/layout.tsx`: load `Bricolage_Grotesque` (weights 500, 700, 800) and `Onest` (400, 500, 600) with `next/font/google` as CSS variables `--font-display`, `--font-body`; read the `vc_theme` cookie with `readTheme`; render `<html lang={locale} data-theme={choice === 'system' ? undefined : choice}>` (locale comes in Task 2; use `'en'` for now). Temporary home page: an `<h1 className="h-display-2">Same video. <span className="text-accent-text">Your product.</span></h1>` and one lime button, to see tokens work.
- [ ] **Step 7: Verify.** `pnpm lint && pnpm typecheck && pnpm test` clean. `NEXT_DIST_DIR=.next-t1 pnpm dev -p 3101`, open `/` with Playwright (`channel: 'chrome'`) at 1440 and 390, once per `colorScheme: 'dark' | 'light'`; screenshots show dark and light grounds with the right fonts. Stage: `git add -A web`.

### Task 2: i18n core

**Files:**
- Create: `web/src/core/i18n/{types.ts,messages.ts,translate.ts,translate.test.ts,locale.ts,server.ts,I18nProvider.tsx}`, `web/src/messages/en/common.json`, `web/src/messages/tr/common.json`
- Modify: `web/src/app/layout.tsx`

**Interfaces:**
- Produces:

```ts
export type Locale = 'en' | 'tr';
export const LOCALES: readonly Locale[];            // ['en', 'tr']
export const LOCALE_COOKIE = 'vc_locale';
export type Messages = Record<string, string>;      // flat: "gallery.title" → "Pick a viral video."
export type Translate = (key: string, params?: Record<string, string | number>) => string;
export function createTranslate(locale: Locale, messages: Messages): Translate;
export async function getI18n(): Promise<{ locale: Locale; t: Translate; messages: Messages }>;   // server: reads the cookie
export function useT(): Translate;                  // client: from <I18nProvider>
```

- Message files: `messages/<locale>/<namespace>.json`, nested JSON; the loader flattens to `namespace.path.to.key`. Params: `{name}`. Plurals: a key whose value is an object with `one` / `other` (and any other `Intl.PluralRules` category) is chosen by `params.count`.
- A missing key returns the key itself and, outside production, logs once.

- [ ] **Step 1: Failing tests** `translate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTranslate, flatten } from './translate';

const messages = flatten({ common: { hello: 'Hello {name}', products: { one: '{count} product', other: '{count} products' } } });

describe('createTranslate', () => {
  const t = createTranslate('en', messages);
  it('fills params', () => expect(t('common.hello', { name: 'Ada' })).toBe('Hello Ada'));
  it('picks the plural form by count', () => {
    expect(t('common.products', { count: 1 })).toBe('1 product');
    expect(t('common.products', { count: 4 })).toBe('4 products');
  });
  it('returns the key when it is missing', () => expect(t('common.nope')).toBe('common.nope'));
  it('leaves an unknown param visible', () => expect(t('common.hello')).toBe('Hello {name}'));
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** `flatten` (nested object → flat map; plural objects become keys `a.b#one`, `a.b#other`), `createTranslate` (looks up `key`, else `key#<Intl.PluralRules(locale).select(count)>`, else `key#other`, else returns key; replaces `{param}`), `messages.ts` (`loadMessages(locale)`: static imports of every `messages/<locale>/*.json` through an explicit map, merged and flattened; English is merged under the chosen locale so a missing Turkish key falls back to English), `locale.ts` (`readLocale(cookieValue): Locale`, default `'en'`), `server.ts` (`getI18n()` using `cookies()`), `I18nProvider.tsx` (`'use client'`, context with `messages` + `locale`, `useT()`).
- [ ] **Step 4:** Run → PASS. **Step 5:** `common.json` (en + tr) with the shared copy: nav (`Gallery`, `My videos`, `Pricing`, `Account`, `How it works`, `Log in`, `Get started`, `Log out`), admin nav (`Overview`, `Users`, `Revenue`, `Jobs`, `Templates`, `Settings`, `View site`, `Admin`), `Open menu`, `Close menu`, language names, `credits` plural, footer links, cookie notice texts (from `A-Cerez.dc.html`), status words (`Done`, `Running`, `Stopped`, `Waiting`, `Generating`, `Ready`), format and quality names, `Previous`, `Next`, `Showing`. Turkish terms: use the pairs in `docs/design/en-donusum/screens.txt` where a pair exists.
- [ ] **Step 6:** Wire `layout.tsx`: `const { locale, messages } = await getI18n()`, `<html lang={locale}>`, wrap children in `<I18nProvider locale={locale} messages={messages}>`. `pnpm lint && pnpm typecheck && pnpm test` clean. Stage.

### Task 3: Data ports and fake implementations

**Files:**
- Create: `web/src/data/ports.ts`, `web/src/data/index.ts`, `web/src/data/mock/{store.ts,demo-values.ts,auth.ts,catalog.ts,ledger.ts,jobs.ts,payments.ts,invoices.ts,mailer.ts,admin.ts}`, `web/src/data/mock/fixtures/{templates.ts,users.ts,history.ts}`, tests next to each (`*.test.ts`), `web/public/samples/*`

**Interfaces:**
- Produces `web/src/data/ports.ts` exactly:

```ts
export type Id = string;
export type Locale = 'en' | 'tr';
export type Role = 'customer' | 'admin';
export type Format = 'no-talking' | 'talking';
export type Quality = 'fast' | 'best';
export type JobStatus = 'running' | 'done' | 'stopped';
export type StepKey = 'adaptation' | 'images' | 'clips' | 'music' | 'edit' | 'render';
export type StepStatus = 'waiting' | 'running' | 'done' | 'stopped';
export type LedgerType = 'purchase' | 'generation' | 'free-video' | 'admin' | 'refund';
export type PurchaseStatus = 'paid' | 'not-completed' | 'refunded';
export type TemplateStatus = 'published' | 'waiting' | 'hidden' | 'private';
export type ScanSource = 'topads' | 'shorts';
export type Period = 'today' | '7d' | '30d' | 'all';
export type EmailKind = 'verify' | 'reset' | 'ready' | 'stopped' | 'payment';

export interface User { id: Id; email: string; name: string; role: Role; emailVerified: boolean; blocked: boolean;
  freeVideoAvailable: boolean; locale: Locale; joinedAt: string; lastActiveAt: string }
export interface Shot { n: number; from: number; to: number; action: string; text: string; product: number | null }
export interface Template { id: Id; title: string; category: string; format: Format; seconds: number; referenceViews: string;
  image: string; video: string | null; products: number; shots: Shot[]; status: TemplateStatus; ownerId: Id | null;
  timesGenerated: number; editedAt: string; source: ScanSource | 'link' }
export interface ProductInput { name: string; description: string; images: string[] }
export interface GenerateInput { templateId: Id; products: ProductInput[]; quality: Quality; variants: 1 | 2 | 3; language: string }
export interface Estimate { images: number; clips: number; clipSeconds: number; musicTracks: number; minutes: number;
  credits: number; coveredByFreeVideo: boolean; balance: number; enough: boolean }
export interface JobStep { key: StepKey; status: StepStatus; done: number; total: number }
export interface JobVariant { id: Id; image: string; video: string | null }
export interface Job { id: Id; userId: Id; templateId: Id; templateTitle: string; input: GenerateInput; credits: number;
  status: JobStatus; steps: JobStep[]; stoppedReason: string | null; startedAt: string; finishedAt: string | null; variants: JobVariant[] }
export interface LedgerEntry { id: Id; userId: Id; at: string; type: LedgerType; change: number; note: string; balanceAfter: number }
export interface CreditPack { id: Id; name: string; credits: number; price: string | null }   // price null → UI shows [PRICE]
export interface Purchase { id: Id; userId: Id; packId: Id; packName: string; credits: number; amount: string | null;
  at: string; status: PurchaseStatus; invoiceId: Id | null }
export interface Invoice { id: Id; number: string; userId: Id; purchaseId: Id; date: string; packName: string; credits: number }
export interface Scan { id: Id; startedAt: string; source: ScanSource; checked: number; aboveThreshold: number; prepared: number;
  status: 'done' | 'running' | 'stopped'; reason: string | null }
export interface Candidate { id: Id; title: string; source: ScanSource; views: string; seconds: number; score: number; image: string; foundAt: string }
export interface SentEmail { id: Id; kind: EmailKind; to: string; at: string; data: Record<string, string> }

export class InsufficientCreditsError extends Error { constructor(public needed: number, public balance: number) { super('insufficient-credits'); } }
export class NotFoundError extends Error { constructor(what: string) { super(`not-found:${what}`); } }

export interface AuthService {
  signUp(email: string, password: string): Promise<User>;              // creates an unverified user, sends 'verify'
  logIn(email: string, password: string): Promise<User | null>;        // fake: any password; null when blocked or unknown
  verifyEmail(userId: Id): Promise<User>;                              // sets emailVerified + freeVideoAvailable
  requestPasswordReset(email: string): Promise<void>;                  // sends 'reset'; silent for unknown email
  resetPassword(email: string, password: string): Promise<void>;
  getUser(id: Id): Promise<User | null>;
  updateProfile(id: Id, patch: Partial<Pick<User, 'name' | 'email' | 'locale'>>): Promise<User>;
  deleteAccount(id: Id): Promise<void>;
}
export interface TemplateCatalog {
  list(query: { search?: string; category?: string; format?: Format; viewerId?: Id }): Promise<Template[]>;   // published + viewer's private
  get(id: Id, viewerId?: Id): Promise<Template | null>;                // null for another user's private template
  categories(): Promise<string[]>;
  addFromLink(ownerId: Id, url: string): Promise<Template>;            // private template, status 'private'
}
export interface CreditLedger {
  balance(userId: Id): Promise<number>;
  entries(userId: Id): Promise<LedgerEntry[]>;                         // newest first
}
export interface JobRunner {
  estimate(userId: Id, input: GenerateInput): Promise<Estimate>;
  start(userId: Id, input: GenerateInput, idempotencyKey: string): Promise<Job>;   // throws InsufficientCreditsError; same key → same job
  get(id: Id, viewerId: Id): Promise<Job | null>;                      // progress is computed from elapsed time on every call
  listFor(userId: Id): Promise<Job[]>;
  resume(id: Id, viewerId: Id): Promise<Job>;                          // stopped → running; charges only the missing part
}
export interface PaymentGateway {
  packs(): Promise<CreditPack[]>;
  startCheckout(userId: Id, packId: Id, returnTo: string): Promise<{ checkoutId: Id; url: string }>;
  complete(checkoutId: Id, outcome: 'paid' | 'declined'): Promise<Purchase>;   // idempotent per checkoutId; 'paid' adds credits + invoice + 'payment' email
  purchasesFor(userId: Id): Promise<Purchase[]>;
}
export interface InvoiceStore { listFor(userId: Id): Promise<Invoice[]>; get(id: Id, viewerId: Id): Promise<Invoice | null> }
export interface Mailer { send(kind: EmailKind, to: string, data: Record<string, string>): Promise<void>; outbox(): Promise<SentEmail[]> }

export interface OverviewNumbers { users: number; newSignUps: number; verified: number; payingUsers: number; revenue: string | null;
  creditsSold: number; creditsSpent: number; freeVideosUsed: number; generationCost: string | null; margin: string | null;
  stoppedJobs: number; paymentsNotCompleted: number; templatesWaiting: number }
export interface AdminUserRow { user: User; balance: number; paidTotal: string | null; creditsSpent: number; videos: number }
export interface AdminUserDetail extends AdminUserRow { creditsBought: number; purchases: Purchase[]; jobs: Job[]; ledger: LedgerEntry[] }
export interface SpendingRow { label: string; jobs: number; credits: number; cost: string | null }
export interface AdminSettings { scanTimes: string[]; threshold: number; dailyCandidates: number; dailyTemplates: number; providerAccount: string }
export interface AdminQueries {
  overview(period: Period): Promise<OverviewNumbers>;
  users(query: { search?: string; filter?: 'all' | 'paying' | 'free-only' | 'not-verified' | 'blocked' }): Promise<AdminUserRow[]>;
  user(id: Id): Promise<AdminUserDetail | null>;
  addCredits(adminId: Id, userId: Id, credits: number, reason: string, idempotencyKey: string): Promise<LedgerEntry>;
  setBlocked(userId: Id, blocked: boolean): Promise<User>;
  purchases(period: Period): Promise<Purchase[]>;
  packSales(period: Period): Promise<{ pack: CreditPack; sold: number; revenue: string | null }[]>;
  refund(purchaseId: Id): Promise<Purchase>;
  ledger(query: { type?: LedgerType; period: Period }): Promise<LedgerEntry[]>;
  spending(period: Period): Promise<{ byQuality: SpendingRow[]; byFormat: SpendingRow[] }>;
  jobs(query: { status?: JobStatus; search?: string }): Promise<Job[]>;
  retryJob(id: Id): Promise<Job>;
  refundJob(id: Id): Promise<LedgerEntry>;
  templates(query: { status?: TemplateStatus; search?: string }): Promise<Template[]>;
  template(id: Id): Promise<Template | null>;
  updateTemplate(id: Id, patch: Partial<Pick<Template, 'title' | 'category' | 'products' | 'status' | 'shots'>>): Promise<Template>;
  candidates(): Promise<Candidate[]>;
  scans(): Promise<Scan[]>;
  settings(): Promise<AdminSettings>;
  saveSettings(patch: Partial<AdminSettings>): Promise<AdminSettings>;
}
```

- Produces `web/src/data/index.ts`: `export const data: { auth: AuthService; catalog: TemplateCatalog; ledger: CreditLedger; jobs: JobRunner; payments: PaymentGateway; invoices: InvoiceStore; mailer: Mailer; admin: AdminQueries }` (all fakes). Money values are `null` everywhere in the fakes (prices are not decided): the UI shows the placeholder.
- `demo-values.ts` (header comment: "DEMO VALUES so the flows run. Not product decisions."): packs Starter 10 / Standard 30 / Studio 100 credits; job cost in credits: no-talking fast 2, no-talking best 5, talking fast 6, talking best 12, × variants; step durations for the fake job in seconds: adaptation 4, images 8, clips 14, music 4, edit 4, render 6 (so a job finishes in 40 s; `VC_FAKE_SPEED` env multiplies speed).
- Fixtures: the 6 templates from `docs/design/uretec/parts.py` `TEMPLATES` (titles, categories, formats, lengths, views verbatim), images copied from `docs/design/tuval/<id>.jpg` to `web/public/samples/<id>.jpg`; videos: copy `productions/layering-01/drafts/final-v6.mp4` → `public/samples/layering.mp4` (template "Fragrance layering recipe") and `productions/lashly-01/drafts/final-v2.mp4` → `public/samples/lashly.mp4` (template `"I tried it for 4 weeks" presenter story`); other templates `video: null`. Shot lists: 5 shots each, times dividing `seconds` evenly, neutral action text (copy the ones on `A-Detay.dc.html` for the fragrance template). Users: `demo@viralclone.app` (customer, verified, balance 12 via one Standard purchase and some generations), `new@viralclone.app` (verified, free video available, no purchases), `admin@viralclone.app` (admin), plus 4 more customers covering: paying, free-only, not verified, blocked. History: purchases (paid, not completed, refunded), jobs (done, running, stopped with reason "Two clips could not be generated"), ledger entries of every type, 3 scans, 5 candidates. One template id (`tpl-stop`: "Dupe comparison") always stops at the clips step in the fake runner, to show the stopped state.
- `store.ts`: one module-level object holding all arrays, created from fixtures on first use and kept on `globalThis` so Next dev reloads do not reset it; `resetStore()` for tests.

- [ ] **Step 1: Failing tests** (one file per fake). Minimum cases, each a separate `it`:
  - `ledger.test.ts`: balance equals the sum of changes; entries are newest first; `balanceAfter` of the newest entry equals `balance()`.
  - `jobs.test.ts`: `estimate` returns `credits = cost × variants` and `enough: false` when balance is lower; `coveredByFreeVideo` is true only for a verified user with `freeVideoAvailable`, format no-talking, quality fast, 1 variant, and then `credits` is 0; `start` writes one negative `generation` ledger entry and returns a running job; `start` with the same `idempotencyKey` twice returns the same job and writes one entry; `start` with a low balance throws `InsufficientCreditsError` and writes nothing; with `vi.useFakeTimers()` a job is `done` after 40 s with all steps done and `variants.length === input.variants`; a job on `tpl-stop` is `stopped` at step `clips` with a reason; `resume` charges only the missing part and the job then finishes; `get` with another user's id returns `null`.
  - `payments.test.ts`: `complete(id, 'paid')` adds the pack's credits, creates one invoice and one `payment` email; calling it twice changes nothing more; `'declined'` creates a `not-completed` purchase and no credits.
  - `auth.test.ts`: `signUp` creates an unverified user without a free video and sends `verify`; `verifyEmail` turns on `emailVerified` and `freeVideoAvailable`; `logIn` returns `null` for a blocked user; `requestPasswordReset` for an unknown email sends nothing and does not throw; `deleteAccount` removes the user, their jobs and private templates.
  - `catalog.test.ts`: `list` without viewer returns only published; with `viewerId` also that viewer's private templates; `search` matches title and category case-insensitively; `get` of another user's private template is `null`.
  - `admin.test.ts`: `addCredits` writes an `admin` ledger entry with the reason and raises the balance; same `idempotencyKey` twice → one entry; `addCredits` with 0, a negative number or an empty reason throws; `setBlocked` makes `logIn` return `null`; `overview('all').users` equals the number of users; `users({ filter: 'blocked' })` returns only blocked; `refund` marks the purchase refunded and writes a negative `refund` entry.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** the fakes over `store.ts`. Job progress is a pure function `progress(job, now): JobStep[]` in `jobs.ts` (elapsed seconds → step states), exported for tests. Ids: `crypto.randomUUID()`. Dates: ISO strings.
- [ ] **Step 4:** Run → PASS; `pnpm typecheck` clean. Stage.

### Task 4: Session and route guards

**Files:**
- Create: `web/src/core/session/{session.ts,session.test.ts,guards.ts,guards.test.ts}`

**Interfaces:**
- Consumes: `data.auth.getUser`.
- Produces:

```ts
export const SESSION_COOKIE = 'vc_session';                       // value: user id (fake session; httpOnly, sameSite lax)
export async function getSessionUser(): Promise<User | null>;     // null when no cookie, unknown id or blocked user
export async function startSession(userId: Id): Promise<void>;
export async function endSession(): Promise<void>;
export async function requireUser(nextPath: string): Promise<User>;   // redirects to /login?next=<encoded path> when signed out
export async function requireAdmin(): Promise<User>;                  // calls notFound() unless role === 'admin'
export function safeNext(next: string | undefined): string;           // only same-site paths starting with one "/"; else "/gallery"
```

- [ ] **Step 1: Failing tests:** `safeNext('/jobs/1')` → `/jobs/1`; `safeNext('//evil.com')`, `safeNext('https://evil.com')`, `safeNext(undefined)` → `/gallery`; with `next/headers` and `next/navigation` mocked: `requireUser('/videos')` without a cookie calls `redirect('/login?next=%2Fvideos')`; `requireAdmin()` for a customer calls `notFound()`; `getSessionUser()` returns `null` for a blocked user.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS. Stage.

### Task 5: UI kit — primitives

**Files:**
- Create: `web/src/shared/ui/{Icon.tsx,icons.ts,Logo.tsx,Button.tsx,Field.tsx,Card.tsx,Tag.tsx,StatusLine.tsx,Segmented.tsx,Dialog.tsx,Skeleton.tsx,EmptyState.tsx,index.ts}` + `*.test.tsx`, `web/src/shared/lib/format.ts` + test, `web/src/app/dev/ui/page.tsx` (a page that shows every primitive in every state, for eye checks)

**Interfaces:**
- Produces (props are exact; all accept `className`):

```ts
<Icon name={IconName} size={20} />                                  // IconName = keyof typeof ICONS; aria-hidden
<Logo href="/" />
<Button variant="primary" | "secondary" | "quiet" | "warn" size="m" | "l" type="button" | "submit" disabled? pending? fullWidth?>…</Button>
<LinkButton href variant size fullWidth?>…</LinkButton>             // same look, renders next/link <a>
<Field label="…" error?="…" hint?="…">{input}</Field>               // wires id / htmlFor / aria-describedby / aria-invalid
<Input />, <Select />, <Textarea />                                 // styled native controls (min-height 52)
<Card as?="section" | "div">…</Card>
<Tag>No talking</Tag>                                               // scrim tag for use over media
<StatusLine kind="done" | "running" | "stopped" | "waiting">Done</StatusLine>
<Segmented label="Period" options={[{ value, label }]} value onChange? />   // or `hrefFor(value)` → links (server-friendly)
<Dialog open onClose title="…" >…</Dialog>                          // native <dialog>, focus trap, Escape, phone: bottom sheet
<Skeleton className="…" />                                          // aria-hidden block
<EmptyState title="…" text="…" action?={node} />                    // dashed panel
formatCredits(n: number, t: Translate): string; formatDate(iso: string, locale: Locale): string; formatDuration(seconds: number): string
```

- [ ] **Step 1: Failing tests** (Testing Library): `Button` renders a `<button type="button">` by default and is disabled + `aria-busy` when `pending`; `LinkButton` renders a link with the href; `Field` connects label and input, shows the error with `aria-invalid="true"` and `aria-describedby`; `Dialog` renders a `dialog` with an accessible name, calls `onClose` on Escape, and returns focus to the opener; `StatusLine` always shows text next to the mark; `Segmented` marks the current option with `aria-pressed="true"` (buttons) or `aria-current="page"` (links); `formatDuration(13)` → `13 sec`, `formatDuration(75)` → `1 min 15 sec`.
- [ ] **Step 2:** FAIL → **Step 3:** implement with Tailwind utilities, reading exact paddings / radii / heights from `parts.py` (mapping table above). `icons.ts` holds the `ICON` path dict copied from `parts.py` plus `menu`. → **Step 4:** PASS.
- [ ] **Step 5:** `/dev/ui` page lists every primitive (all variants, sizes, states). Screenshot it at 1440 dark + light and compare with `docs/design/tuval/project/Marka-Bilesen-1.dc.html` rendered by `preview_dc.py`. Fix differences. Stage.

### Task 6: UI kit — headers, menus, tables, shells

**Files:**
- Create: `web/src/shared/ui/{HeaderVisitor.tsx,HeaderCustomer.tsx,HeaderPanel.tsx,MobileMenu.tsx,Footer.tsx,CookieNotice.tsx,LanguageMenu.tsx,VideoCard.tsx,Tile.tsx,DataTable.tsx,Pager.tsx,SubNav.tsx,PageHead.tsx,ChartSlot.tsx}` + tests; `web/src/app/(site)/layout.tsx`, `web/src/app/(auth)/layout.tsx`, `web/src/app/(app)/layout.tsx`, `web/src/app/admin/layout.tsx`, `web/src/app/not-found.tsx`, `web/src/core/i18n/actions.ts` (`setLocale`), `web/src/core/theme/actions.ts` (`setTheme`)
- Modify: `web/src/shared/ui/index.ts`, `web/src/app/dev/ui/page.tsx`

**Interfaces:**
- Consumes: Task 2 (`getI18n`, `useT`), Task 4 (`getSessionUser`, `requireUser`, `requireAdmin`), Task 5 primitives, `data.ledger.balance`.
- Produces:

```ts
<HeaderVisitor current?="gallery" | "how" | "pricing" />
<HeaderCustomer current?="gallery" | "videos" | "pricing" | "account" balanceLabel="12 credits" />
<HeaderPanel current="overview" | "users" | "revenue" | "jobs" | "templates" | "settings" />
<MobileMenu kind="visitor" | "customer" | "admin" current? balanceLabel? />     // full-screen overlay, opened by the header's menu button
<Footer />, <CookieNotice />, <LanguageMenu />
<VideoCard href title meta image video? formatLabel durationLabel />           // plays `video` on hover / focus when present
<Tile label value sub? />                                                      // value: string (already formatted or a placeholder)
<DataTable caption columns={[{ key, header, numeric? }]} rows={[{ id, cells: Record<key, ReactNode> }]} minWidth?={960} />
<Pager shown total prevHref? nextHref? />, <SubNav label items={[{ href, label }]} currentHref />, <PageHead title lead? actions? />, <ChartSlot label />
setLocale(locale: Locale): Promise<void>; setTheme(choice: ThemeChoice): Promise<void>      // server actions: set cookie + revalidate
```

- Layouts: `(site)` = `HeaderVisitor` (or `HeaderCustomer` when signed in) + children + `Footer` + `CookieNotice`; `(auth)` = the two-column auth frame of `A-Giris.dc.html` (`parts.auth_page`); `(app)` = `requireUser` + `HeaderCustomer` with the live balance; `admin` = `requireAdmin` + `HeaderPanel`. Below the `nav` breakpoint (900 px) every header shows the phone form (`parts.header_m`) and the menu button opens `MobileMenu`.
- `not-found.tsx` = `A-404.dc.html`.

- [ ] **Step 1: Failing tests:** `HeaderCustomer` marks `current` with `aria-current="page"` and shows the balance label; `MobileMenu` is a dialog that closes on Escape and on link click; `DataTable` renders `<caption>`, `<th scope="col">`, right-aligns numeric columns; `VideoCard` has one link with the title as its accessible name; `Pager` disables "Previous" without `prevHref`.
- [ ] **Step 2:** FAIL → **Step 3:** implement (exact styles: `parts.header_in`, `parts.header_out`, `parts.header_m`, `panel.py`, the menu boards) → **Step 4:** PASS.
- [ ] **Step 5:** Extend `/dev/ui` with these components; screenshot 1440 + 390, dark + light; compare with `A-Hesap`, `A-Fiyatlar`, `A-Admin-Genel`, `A-Menu-M`, `A-Menu-Ziyaretci-M`, `A-Menu-Admin-M`. Stage.

---

## Feature tasks (7–14): common recipe

Each feature task ports a group of boards to pages. For every board in the task:

- [ ] **Read the board file** `docs/design/tuval/project/<Board>.dc.html` (markup + inline styles = exact layout, sizes, copy) and its phone variant `<Board>-M.dc.html` (what changes at 390 px). Render the references once: `cd docs/design && DC_BLOBS=tuval python3 preview_dc.py tuval/pv-ref tuval/project/<Board>.dc.html tuval/project/<Board>-L.dc.html tuval/project/<Board>-M.dc.html tuval/project/<Board>-ML.dc.html`.
- [ ] **Write the feature's tests first** (Vitest + Testing Library for components with logic; server action tests with the fakes): the cases listed in the task. Run → FAIL.
- [ ] **Implement**: `features/<name>/` components + server actions (validate input with Zod on the server; return typed field errors), `app/…/page.tsx` shells, `messages/en/<name>.json` + `messages/tr/<name>.json` (same keys). Use `shared/ui` components; do not edit `shared/` or `core/` (if something is missing, build it inside the feature and report it). Run tests → PASS.
- [ ] **Compare**: `NEXT_DIST_DIR=.next-<task> pnpm dev -p <port>`; take Playwright screenshots (`channel: 'chrome'`) of each route at 1440×900 and 390×844, `colorScheme` dark and light, full page; open them next to the board PNGs; fix every visible difference (spacing, sizes, wrapping, colors). Sign in for protected pages by setting the `vc_session` cookie to a fixture user id.
- [ ] **Finish**: `pnpm lint && pnpm typecheck && pnpm test` clean; `git add -A web`; report: routes done, tests added, screenshots path, anything missing in `shared`, deviations from the board and why.

### Task 7: Marketing pages (port 3107)
Boards → routes: `A-Ana-Sayfa` → `/` · `A-Fiyatlar` → `/pricing` · `A-Yasal` → `/legal/[doc]` (`terms`, `privacy`, `refunds`, `content`; unknown → 404) · `A-Iletisim` → `/contact` · `A-Cerez`, `A-Dil-Menusu` are already in the layout (check them here).
Feature: `features/marketing`. Data: `data.payments.packs()` (pack names + credits; price `null` → `[PRICE]`), `data.catalog.list({})` for the home strip.
Tests: pricing shows one card per pack and `[PRICE]` when price is null; "Buy" for a visitor links to `/signup`, for a signed-in user posts to the checkout action (`/checkout/start?pack=<id>` link is enough here: Task 11 owns the action); contact form: empty message or invalid email → field errors, valid → success state and no network call; legal page shows `[LEGAL TEXT]` blocks and marks the current doc in the side list.

### Task 8: Auth (port 3108)
Boards → routes: `A-Giris` → `/login` and `/signup` (two tabs of one screen) · `A-Eposta-Dogrula` → `/verify-email` · `A-Karsilama` → `/welcome` · `A-Sifre-Unuttum` → `/forgot-password` · `A-Sifre-Gonderildi` → `/forgot-password/sent` · `A-Sifre-Yeni` → `/reset-password`.
Feature: `features/auth`. Actions: `signUp` (→ `/verify-email`), `logIn` (→ `safeNext(next)`), `logOut`, `confirmEmail` (the fake "I opened the link" button on `/verify-email` → `/welcome`), `requestReset` (→ `/forgot-password/sent`, same response for unknown email), `resetPassword` (→ `/login`). "Continue with Google" signs in the demo user (fake).
Tests: invalid email / short password (`[MIN LENGTH]` rule: use 8 in code, show the placeholder text from the board) → field errors, no session; `logIn` for a blocked user → form error, no session; `logIn` with `next=//evil.com` redirects to `/gallery`; `signUp` then `confirmEmail` → user verified, free video available, lands on `/welcome`; signed-in user opening `/login` is redirected to `/gallery`.

### Task 9: Gallery and templates (port 3109)
Boards → routes: `Main`, `A-Galeri-Yukleniyor`, `A-Galeri-Sonuc-Yok` → `/gallery` (+ `loading.tsx`, empty result) · `A-Detay`, `A-Detay-Ozel` → `/templates/[id]` · `A-Video-Ekle` → `/templates/new`.
Feature: `features/gallery`. Search + filters live in the URL (`?q=&category=&format=`), server-rendered. Gallery is public (visitor header when signed out); `/templates/new` requires a user.
Tests: filters build the right query string and mark the current one; no results → the dashed panel with the query quoted, "Clear search" link, and "Other templates" below; a private template shows the "Only you" tag and is 404 for anyone else; add-video: invalid URL → field error, valid TikTok / YouTube URL → new private template appears under "Your templates" as preparing.

### Task 10: Generate and jobs (port 3110)
Boards → routes: `A-Form`, `A-Form-Hata` → `/templates/[id]/generate` · `A-Onay`, `A-Onay-Yetersiz` → confirm dialog on that page · `A-Is-Takibi`, `A-Is-Durdu`, `A-Sonuc`, `A-Sonuc-Varyant` → `/jobs/[id]` (one route, view chosen by job status and variant count; while running, refresh every 2 s) · `A-Karsilastir` → `/jobs/[id]/compare` · `A-Oynatici` → player dialog.
Feature: `features/generate` (form, estimate, confirm) and `features/jobs` (progress, stopped, result, compare, player). They do not import each other: the form action redirects to `/jobs/[id]`.
Tests: form requires a name and at least one image for each of the template's products (errors exactly as on `A-Form-Hata`, plus the summary alert); "Generate" opens the confirm dialog with the estimate and spends nothing; confirm creates one job and one ledger entry and redirects; double confirm (same idempotency key) → one job; balance too low → the not-enough dialog with the missing amount and a link to `/pricing`; free-video case shows "Your first video is free" and 0 credits; running job page shows each step's status text; stopped job shows the reason and "Continue" calls `resume`; result with 1 variant vs 3 variants; another user's job → 404.

### Task 11: My videos, account, checkout, invoice (port 3111)
Boards → routes: `A-Uretimlerim`, `A-Uretimlerim-Bos` → `/videos` · `A-Hesap`, `A-Hesap-Sil` → `/account` · `A-Odeme-Basarili` → `/checkout/success` · `A-Odeme-Basarisiz` → `/checkout/failed` · `A-Fatura` → `/invoices/[id]` (A4 print page: `@page { size: A4; margin: 0 }`, always light) · fake provider page `/checkout/mock/[checkoutId]` (plain page titled "Payment provider (demo)" with "Pay" and "Decline"; not on the canvas).
Features: `features/videos`, `features/account`, `features/checkout`. `/checkout/start?pack=<id>&returnTo=<path>` starts a checkout and redirects to the mock page. Account profile gets one control that is not on the board: "Appearance" select (System / Dark / Light) under "Interface language", calling `setTheme`.
Tests: videos list filters (All / Running / Ready / Stopped) and the empty state; ledger rows show sign and type; saving the profile with an invalid email → field error; changing language switches the cookie; delete account requires typing `DELETE`, then the session ends and `/` opens; pay → success page shows the pack, the credits and the new balance, invoice link works; decline → failed page, balance unchanged, "Try again" starts a new checkout; paying twice with the same checkout id adds credits once; another user's invoice → 404.

### Task 12: Emails (port 3112)
Boards → `/dev/emails/[name]` (`verify`, `reset`, `ready`, `stopped`, `payment`) and `/dev/emails` (the fake outbox list). Feature: `features/emails`: one component per email (`E-Dogrulama`, `E-Sifre`, `E-Hazir`, `E-Durdu`, `E-Odeme`), light ground, max width 600.
Tests: each email renders its primary action as a link with the right target; the outbox lists what `data.mailer.outbox()` returns, newest first; unknown name → 404.

### Task 13: Admin — overview, users, revenue (port 3113)
Boards → routes: `A-Admin-Genel` → `/admin` · `A-Kullanicilar` → `/admin/users` · `A-Kullanici-Detay` → `/admin/users/[id]` · `A-Gelir` → `/admin/revenue` · `A-Krediler` → `/admin/revenue/credits`.
Features: `features/admin-overview`, `features/admin-users`, `features/admin-revenue`. Period and filters in the URL. Money values that are `null` render the board's placeholder (`[AMOUNT]`).
Tests: overview tiles show numbers from `data.admin.overview`; "Needs attention" rows link to the right pages; users filter + search; add credits: 0 / negative / empty reason → field errors and nothing written; valid → ledger entry with the reason, balance tile updated; double submit → one entry; block → status "Blocked" and the user cannot log in; refund → purchase "Refunded"; a customer session gets 404 on every route.

### Task 14: Admin — jobs, templates, settings (port 3114)
Boards → routes: `A-Isler` → `/admin/jobs` · `A-Sablonlar` → `/admin/templates` · `A-Gelen`, `A-Gelen-Bos` → `/admin/templates/inbox` · `A-Sablon-Duzenle` → `/admin/templates/[id]` · `A-Tarama` → `/admin/templates/scans` · `A-Ayarlar` → `/admin/settings`.
Features: `features/admin-jobs`, `features/admin-templates`, `features/admin-settings`.
Tests: jobs filter; stopped job shows reason, "Retry" calls `retryJob`, "Refund credits" writes a refund entry once; template edit: empty title → error; shot times must stay inside the template length and in order → error otherwise; save persists and shows on the list; hide → status "Hidden" and gone from the public gallery; inbox empty state when there are no candidates; settings: invalid time or threshold outside 0–100 → field errors.

---

### Task 15: Translation completeness

**Files:** Create `web/src/messages/messages.test.ts`; modify `web/src/messages/tr/*.json` as needed.

- [ ] **Step 1: Failing test:** for every namespace file in `messages/en`, the same file exists in `messages/tr` with exactly the same flattened key set (plural categories included) and no empty value; no value in `tr` is identical to `en` unless the key is in an allow-list (brand name, placeholders in `[BRACKETS]`, `EN` / `TR`, product terms kept in English: "Fast", "Best").
- [ ] **Step 2:** Run → fix the Turkish files until PASS. Turkish wording: `docs/design/en-donusum/*.txt` pairs first; otherwise short, plain, sentence case; "Clone it" → "Klonla"; credit → "kredi"; template → "şablon".
- [ ] **Step 3:** Grep for hard-coded copy: `grep -rnE ">[A-Za-z][^<{]{2,}<" web/src --include=*.tsx | grep -v test` must return only non-copy matches (list any real hit and move it to messages). Stage.

### Task 16: End-to-end flows and screenshot sweep

**Files:** Create `web/e2e/{journey.spec.ts,credits.spec.ts,admin.spec.ts,settings.spec.ts,shots.ts,routes.ts}`.

- [ ] **Step 1: Specs** (each must pass against the fakes with `VC_FAKE_SPEED=20`):
  - `journey`: sign up → verify → welcome → gallery → open a template → fill the form → confirm (free video) → progress → result → the video is in My videos.
  - `credits`: demo user, 3 variants best → not enough credits → pricing → pay on the mock provider → success → back to confirm → job starts; balance and ledger are right; decline path shows the failed page.
  - `admin`: customer gets 404 on `/admin`; admin adds credits to a user with a reason → visible in that user's credit history; blocks a user → that user cannot log in.
  - `settings`: switch language to Türkçe → nav shows Turkish; switch Appearance to Light → `html[data-theme="light"]`; reload keeps both.
- [ ] **Step 2: `shots.ts`**: for every route in `routes.ts` (all of spec §3, each with the fixture session it needs) × widths 1440 and 390 × dark and light → `e2e/__shots__/<route>-<w>-<theme>.png`, and fail on any horizontal overflow (`document.documentElement.scrollWidth > innerWidth`) or console error.
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` all green. Build contact sheets of the shots (`python3 docs/design/uretec/sheet.py …`) for the owner. Stage and report.
