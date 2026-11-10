import { readFileSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createMagnific } from '../viraleditor/src/adapters/magnific.ts';
import { ownerTestConfig } from '../viraleditor/src/robust/provider-policy.ts';
import { consumeProvider } from '../viraleditor/src/robust/provider-budget.ts';
// Balance endpoint and provider tariff are absent from verified local adapter/docs; never invent a URL or price.
console.log('Single supported Nano Banana Pro image, num_images=1; expected provider cost: unverified. Reservation: 1 unit. Balance before/after: unverified (no documented endpoint).');
if (process.argv[2] !== '--yes') { console.log('DRY-RUN: no env/key read and no network request. Operator must pass --yes.'); process.exit(0); }
try {
 const file = process.env.VC_ENV_FILE ?? join(homedir(), '.config/viralclone/env');
 const st = statSync(file);
 if ((st.mode & 0o777) !== 0o600 || st.uid !== process.getuid()) throw Error('unsafe-env-file');
 const env = {};
 for (const line of readFileSync(file, 'utf8').split('\n')) {
   if (!line.trim() || line.trimStart().startsWith('#')) continue;
   const m = /^([A-Z][A-Z0-9_]*)='([^'\r\n]*)'$/.exec(line);
   if (!m) throw Error('invalid-env-file');
   env[m[1]] = m[2];
 }
 const caps = ownerTestConfig(env);
 if (!caps || !env.MAGNIFIC_API_KEY || !env.VC_DATA_DIR) throw Error('owner-test-config-required');
 mkdirSync(env.VC_DATA_DIR, { recursive: true, mode: 0o700 });
 const db = new DatabaseSync(join(env.VC_DATA_DIR, 'db.sqlite')); db.exec('PRAGMA busy_timeout = 5000');
 try {
   const client = createMagnific({ apiKey: env.MAGNIFIC_API_KEY, spendDir: env.VC_DATA_DIR,
     beforePaid: (runId, units) => consumeProvider(db, caps, runId, units, new Date()) });
   await client.image({ prompt: 'A plain blue circle on a white background', references: [], aspect: '1:1' },
     join(env.VC_DATA_DIR, `owner-smoke-${Date.now()}.png`), () => console.log('One request accepted; ticket recorded in provider-spend.jsonl.'));
   console.log('OK image saved; balance after: unverified; append-only log recorded.');
 } finally { db.close(); }
} catch { console.error('FAIL smoke did not complete. Inspect local provider-spend.jsonl for accepted/unknown submission; do not resend unknown requests. No secret or upstream error is printed.'); process.exitCode = 1; }
