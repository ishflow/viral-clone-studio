// @vitest-environment node
import { inspect } from 'node:util';
import { expect, it } from 'vitest';
import { paymentConfig, redact } from './config';
it('fake pipeline requires a strong signing secret; live and test fail closed without adapters', () => {
  expect(()=>paymentConfig({VC_PAYMENTS:'fake'})).toThrow('webhook-secret-required');
  expect(()=>paymentConfig({VC_PAYMENTS:'live'})).toThrow();
  expect(()=>paymentConfig({VC_PAYMENTS:'test',DODO_API_KEY_LIVE:'placeholder'})).toThrow('mixed-payment-keys');
  expect(()=>paymentConfig({VC_PROVIDER:'magnific',VC_PAYMENTS:'fake'})).toThrow('fake-payments-in-paid-mode');
  expect(redact('value=placeholder',{RESEND_API_KEY:'placeholder'})).toBe('value=[redacted]');
});
it('tracked files contain no environment files or key material', async()=>{
 const {execFileSync}=await import('node:child_process');
 const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0');
 expect(files.filter(file=>/(^|\/)\.env($|\.)|\.env$|\.(pem|key|p12|pfx)$/.test(file))).toEqual([]);
});
const dodoSecret='whsec_'+Buffer.alloc(32,7).toString('base64');
const testEnv={VC_PAYMENTS:'test',DODO_API_KEY_TEST:'made-up-dodo-test-key',DODO_WEBHOOK_SECRET_TEST:dodoSecret,
  DODO_PRODUCT_PACK_STARTER:'pdt_madeupstarter',DODO_PRODUCT_PACK_STANDARD:'pdt_madeupstandard',DODO_PRODUCT_PACK_STUDIO:'pdt_madeupstudio'};
it('test mode starts only with the key, the webhook secret and a product for each of the three packs',()=>{
  const config=paymentConfig(testEnv);
  expect(config.mode).toBe('test');
  expect(config.secret()).toBe(dodoSecret);
  expect(config.mode==='test'&&[...config.dodo.products.keys()]).toEqual(['pack-starter','pack-standard','pack-studio']);
});
it.each([
  ['DODO_API_KEY_TEST','dodo-key-required'],['DODO_WEBHOOK_SECRET_TEST','dodo-webhook-secret-required'],
  ['DODO_PRODUCT_PACK_STARTER','dodo-product-required:DODO_PRODUCT_PACK_STARTER'],['DODO_PRODUCT_PACK_STANDARD','dodo-product-required:DODO_PRODUCT_PACK_STANDARD'],
  ['DODO_PRODUCT_PACK_STUDIO','dodo-product-required:DODO_PRODUCT_PACK_STUDIO'],
])('test mode without %s does not start',(name,reason)=>{
  for(const value of [undefined,''])expect(()=>paymentConfig({...testEnv,[name]:value})).toThrow(new Error(reason));
});
it.each(['whsec_short','not base64 at all !!','whsec_'+Buffer.alloc(23,7).toString('base64')])('test mode refuses the malformed webhook secret %#, and the refusal does not repeat it',secret=>{
  let message='';
  try{paymentConfig({...testEnv,DODO_WEBHOOK_SECRET_TEST:secret});}catch(error){message=(error as Error).message;}
  expect(message).toBe('dodo-webhook-secret-required');
});
it('live stays refused with every setting present, and test payments cannot pay for real generation',()=>{
  const live={VC_PAYMENTS:'live',VC_PAYMENTS_LIVE_CONFIRM:'yes',DODO_API_KEY_LIVE:'made-up-live-key',DODO_WEBHOOK_SECRET_LIVE:dodoSecret,
    DODO_PRODUCT_PACK_STARTER:'pdt_madeupstarter',DODO_PRODUCT_PACK_STANDARD:'pdt_madeupstandard',DODO_PRODUCT_PACK_STUDIO:'pdt_madeupstudio'};
  expect(()=>paymentConfig(live)).toThrow(new Error('payment-adapter-unavailable'));
  expect(()=>paymentConfig({...live,VC_PAYMENTS_LIVE_CONFIRM:undefined})).toThrow(new Error('live-confirm-required'));
  expect(()=>paymentConfig({...testEnv,VC_PROVIDER:'magnific'})).toThrow(new Error('test-payments-in-paid-mode'));
});
it('fake mode needs none of the Dodo settings and is not changed by them',()=>{
  const fake={VC_PAYMENTS:'fake',VC_PAYMENTS_WEBHOOK_SECRET:'a-payments-webhook-secret-of-32-chars-or-more',PUBLIC_BASE_URL:'http://127.0.0.1:3201',INTERNAL_CRON_SECRET:'cron'};
  const expected={mode:'fake',secret:fake.VC_PAYMENTS_WEBHOOK_SECRET,base:'http://127.0.0.1:3201',cronSecret:'cron'};
  const read=(env:Record<string,string>)=>{const config=paymentConfig(env);return {...config,secret:config.secret(),cronSecret:config.cronSecret()};};
  expect(read(fake)).toEqual(expected);
  expect(read({...fake,DODO_API_KEY_TEST:'made-up-dodo-test-key',DODO_WEBHOOK_SECRET_TEST:dodoSecret})).toEqual(expected);
});
it.each([['fake',{VC_PAYMENTS:'fake',VC_PAYMENTS_WEBHOOK_SECRET:'a-payments-webhook-secret-of-32-chars-or-more'}],['test',testEnv]])
('the settings of %s mode show neither the webhook secret nor the sweep secret when they are printed, logged or written as JSON',(_mode,env)=>{
  const cron='a-made-up-sweep-secret-0123456789', config=paymentConfig({...env,INTERNAL_CRON_SECRET:cron}), webhook=config.secret();
  expect(config.cronSecret()).toBe(cron);
  for(const text of [inspect(config,{depth:10,showHidden:true,getters:true}),JSON.stringify(config),String(config),String(config.secret),String(config.cronSecret),`${Object.values(config)}`,inspect({payments:config},{depth:10})])
    for(const value of [webhook,webhook.replace('whsec_',''),cron])expect(text).not.toContain(value);
});
it.each(['','FAKE','Test','production','fake ','test,live','0'])('the mode name %j is no mode: nothing is guessed from it',mode=>{
  expect(()=>paymentConfig({...testEnv,VC_PAYMENTS:mode,VC_PAYMENTS_WEBHOOK_SECRET:'a-payments-webhook-secret-of-32-chars-or-more'})).toThrow(new Error('invalid-payment-mode'));
});
