#!/bin/bash
# One owner-operated test email. No live request unless VC_LIVE_MAIL=1 was explicitly supplied by the caller.
set -eu
. "$(dirname "$0")/lib.sh"
live=${VC_LIVE_MAIL:-0}
to=''
while [ $# -gt 0 ]; do
  case "$1" in --to) to=${2:?}; shift ;; *) die 'usage: mail-smoke.sh --to ADDRESS' ;; esac
  shift
done
[ -n "$to" ] || die 'usage: mail-smoke.sh --to ADDRESS'
env_file=$(default_env_file)
if [ "$live" != 1 ]; then
  say 'DRY-RUN: no email sent. To send one allowlisted test email, explicitly run VC_LIVE_MAIL=1 ops/mail-smoke.sh --to ADDRESS.'
  exit 0
fi
check_env_file "$env_file"
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
# The caller opt-in cannot come from the sourced env file; the endpoint is pinned to the real provider.
node --input-type=module - "$REPO" "$to" <<'JS'
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const repo=process.argv[2],to=process.argv[3];
try {
  const {mailConfig,allowedRecipient}=await import(pathToFileURL(`${repo}/web/src/core/payments/mail-config.ts`).href);
  const config=mailConfig({...process.env,VC_MAIL:'resend',RESEND_BASE_URL:undefined,VC_MAIL_TEST:undefined});
  if(!allowedRecipient(to,config.allow))throw Error('blocked-by-allowlist');
  const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json','Idempotency-Key':`smoke:${randomUUID()}`},body:JSON.stringify({from:config.from,to,subject:'Viral Clone email test',html:'<p>Viral Clone test email. / Viral Clone test e-postası.</p>',text:'Viral Clone test email. / Viral Clone test e-postası.'})});
  if(!response.ok){await response.body?.cancel();console.error(`mail-smoke: HTTP ${response.status}`);process.exitCode=1;}
  else {const data=await response.json();if(typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(data.id))throw Error('invalid-response');console.log(`mail-smoke: accepted ${data.id}`);}
} catch { console.error('mail-smoke: not sent or acceptance unconfirmed; check configuration/allowlist. No automatic retry.');process.exitCode=1; }
JS
