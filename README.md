# Viral Clone

A studio that analyses a short viral video, turns its structure into a reusable template, and makes a new video with the same structure from your own product photos and text.

> **Status:** personal project. Active development has stopped; the code is published as it was. No support, no roadmap, no screenshots.

## What is in the repository

| Folder | What it is |
|---|---|
| `web/` | The site: a Next.js (App Router) + React app. Gallery of templates, video generation flow, accounts, credits and checkout, admin screens, e-mails, i18n (en, tr). Runs on a built-in demo engine by default, or on a SQLite engine (`VC_ENGINE=sqlite`) with a real worker. |
| `viraleditor/` | The video engine and worker: HyperFrames + ffmpeg based. Prepares a template from a reference video (transcript, shots, score), fills it with the customer's material, renders the video, quality-checks it. Also a CLI (`viraleditor`). MIT licensed. |
| `packages/provider-magnific/` | Hypit provider for the Magnific API (image / video generation). |
| `ops/` | Local run scripts: launchd install kit (web, worker, daily backup, payment sweep), health check, backup, rollback, smoke tests. macOS oriented. |
| `docs/` | Specs, plans, research notes, the runbook (`docs/runbook.md`) and design files. Mostly Turkish and English notes written while building. |

## Requirements

- Node.js 24+ and pnpm
- `ffmpeg`, `sqlite3`, `openssl`
- Chrome / Chromium (HyperFrames renders through it)
- Optional, for the paid / real paths only: a Magnific API key, the `claude` CLI (`claude setup-token`) for the language-model steps, a Resend key for e-mail, Dodo Payments keys for checkout

## Quick start (demo mode, nothing paid)

```bash
pnpm --dir web install
pnpm --dir viraleditor install
pnpm --dir web dev            # http://localhost:3000, demo engine and demo data
```

Tests and type checks:

```bash
pnpm --dir viraleditor typecheck && pnpm --dir viraleditor test
pnpm --dir web typecheck && pnpm --dir web test
```

For a real local installation (SQLite data directory, worker, launchd services) follow `ops/README.md` and `docs/runbook.md`. Copy `.env.example` to your own env file and fill in the values; never commit it.

## Environment variables

Names only. Set them in the process environment or in the env file that `ops/install.sh` creates (`~/.config/viralclone/env`, mode 0600). `.env.example` lists the same names with empty values.

| Name | Used for |
|---|---|
| `VC_ENGINE` | `sqlite` for the real data engine; unset for the demo engine |
| `VC_DATA_DIR` | Data directory (database, uploads, `site.json`) |
| `VC_BACKUP_DIR` | Backup directory |
| `VC_ENV_FILE` | Path of the env file the ops scripts read |
| `VC_PROVIDER` | `fake` or `magnific` (paid generation) |
| `VC_SWAP_PROVIDER` | Provider for the person-swap flow |
| `VC_PROVIDER_JOB_CAP`, `VC_PROVIDER_DAILY_CAP` | Spending caps per job and per day |
| `MAGNIFIC_API_KEY` | Magnific API key (only with `VC_PROVIDER=magnific`) |
| `CLAUDE_CODE_OAUTH_TOKEN` | Login of the `claude` CLI used for the language-model steps |
| `VC_SESSION_SECRET` | Signs session cookies (32+ characters) |
| `VC_ADMIN_PASSWORD` | First admin password, read when `site.json` is first written |
| `VC_BIND_HOST`, `VC_PORT` | Where the site listens |
| `VC_TRUST_PROXY` | Set when a reverse proxy in front overwrites `x-forwarded-*` |
| `VC_DEMO_LINKS` | Show demo verification links (local use only) |
| `VC_MAIL` | `resend` to send real e-mail |
| `RESEND_API_KEY`, `MAIL_FROM` | Resend key and sender address |
| `VC_MAIL_ALLOW` | Allow-list of recipient addresses while testing |
| `VC_SUPPORT_EMAIL`, `VC_BUSINESS_COMPANY`, `VC_BUSINESS_ADDRESS` | Contact details shown on the site, invoices and legal pages (defaults are placeholders) |
| `VC_PAYMENTS` | `fake`, `test` or `live` payment mode |
| `VC_PAYMENTS_ENV_FILE`, `VC_PAYMENTS_WEBHOOK_SECRET`, `VC_PAYMENTS_LIVE_CONFIRM` | Payment pipeline settings |
| `DODO_API_KEY_TEST`, `DODO_WEBHOOK_SECRET_TEST`, `DODO_API_KEY_LIVE`, `DODO_WEBHOOK_SECRET_LIVE` | Dodo Payments keys |
| `DODO_PRODUCT_PACK_STARTER`, `DODO_PRODUCT_PACK_STANDARD`, `DODO_PRODUCT_PACK_STUDIO` | Dodo product ids of the credit packs |
| `INTERNAL_CRON_SECRET` | Shared secret for the payment sweep endpoint |
| `VC_WORKER_PRODUCE`, `VC_WORKER_PREPARE` | How many produce / prepare runs the worker does at once |
| `VC_OWNER_TEST` | Owner test mode (real provider, hard caps, loopback only) |
| `NEXT_DIST_DIR` | Alternative Next.js build directory |

## Notes

- The project name inside some packages is `viral-klon` (its original name).
- `web/public/samples/` holds neutral placeholder images and clips, not real content.
- Generated videos, uploads and the database live in `VC_DATA_DIR`, outside the repository.

## License

MIT, see `LICENSE`.
