/** Fail-closed mail configuration. No error contains an environment value. */
const address=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
const domain=/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
export function allowedRecipient(to:string,allow:readonly string[]):boolean {
  if(!address.test(to)||/[\r\n]/.test(to))return false;
  const normalized=to.toLowerCase(), host=normalized.split('@')[1];
  if(allow.length===1&&allow[0]==='*')return true;
  return allow.some(item=>item.includes('@')?normalized===item:host===item);
}
export function mailConfig(env:Record<string,string|undefined>=process.env){
  const mode=env.VC_MAIL??'fake';if(mode!=='fake'&&mode!=='resend')throw Error('invalid-mail-mode');
  if(mode==='fake')return {mode:'fake' as const};
  const key=env.RESEND_API_KEY;if(!key||!key.trim()||/[\s\x00-\x1f\x7f]/.test(key))throw Error('mail-key-required');
  const from=env.MAIL_FROM;if(!from||!address.test(from)||/[\r\n]/.test(from))throw Error('invalid-mail-from');
  const allow=(env.VC_MAIL_ALLOW??'').split(',').map(s=>s.trim().toLowerCase());
  const everyone=allow.length===1&&allow[0]==='*';
  if(!everyone&&(!allow.length||allow.some(s=>!s||s.includes('*')||!(address.test(s)||domain.test(s)))))throw Error('mail-allowlist-required');
  let base:URL,endpoint:URL;
  try{base=new URL(env.PUBLIC_BASE_URL??'http://127.0.0.1:3202');endpoint=new URL(env.RESEND_BASE_URL??'https://api.resend.com');}catch{throw Error('invalid-mail-url');}
  if(!['https:','http:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('invalid-mail-base');
  // A local fake HTTP server is an explicit test-only opt-in, never an arbitrary outbound host.
  const local=env.VC_MAIL_TEST==='1'&&endpoint.protocol==='http:'&&['127.0.0.1','[::1]'].includes(endpoint.hostname);
  if(!(endpoint.origin==='https://api.resend.com'||local)||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw Error('invalid-mail-endpoint');
  return {mode:'resend' as const,key,from,allow,base:base.origin,endpoint: endpoint.origin};
}
export type ResendConfig=Extract<ReturnType<typeof mailConfig>,{mode:'resend'}>;
