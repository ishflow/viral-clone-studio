// @vitest-environment node
import { inspect } from 'node:util';
import { expect, it, vi } from 'vitest';
import { fetchHttp, HttpError } from './http';
const request={method:'POST' as const,url:'https://test.dodopayments.com/checkouts',headers:{Authorization:'Bearer placeholder-key',Accept:'application/json'},body:'{"a":1}'};
async function failureOf(work:Promise<unknown>):Promise<HttpError>{
  const error=await work.then(()=>null,(e:unknown)=>e);
  if(!(error instanceof HttpError))throw new Error('expected an HttpError');
  return error;
}
it('sends the request as given, uncached and without following redirects, and returns the status with the body',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('{"session_id":"cks_1"}',{status:200}));
  await expect(fetchHttp(fetcher)(request)).resolves.toEqual({status:200,body:'{"session_id":"cks_1"}'});
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url,init]=fetcher.mock.calls[0]!;
  expect(url).toBe('https://test.dodopayments.com/checkouts');
  expect(init).toMatchObject({method:'POST',headers:request.headers,body:'{"a":1}',redirect:'manual',cache:'no-store'});
  expect(init!.signal).toBeInstanceOf(AbortSignal);
});
it('hands an error status back to the caller instead of hiding it',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('{"code":"UNAUTHORIZED"}',{status:401}));
  await expect(fetchHttp(fetcher)(request)).resolves.toEqual({status:401,body:'{"code":"UNAUTHORIZED"}'});
});
it('refuses a redirect, so the Authorization header never travels to another address',async()=>{
  for(const status of [300,301,302,303,304,305,306,307,308,399]){
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status,headers:{location:'https://elsewhere.example/checkouts'}}));
    expect((await failureOf(fetchHttp(fetcher)(request))).kind,String(status)).toBe('redirect');
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it('sends nothing to an address that is not plain https',async()=>{
  const fetcher=vi.fn<typeof fetch>();
  for(const url of ['http://test.dodopayments.com/checkouts','http://127.0.0.1:9999/checkouts','https://user:pass@test.dodopayments.com/checkouts','ftp://test.dodopayments.com/checkouts','//test.dodopayments.com/checkouts','not an address',''])
    expect((await failureOf(fetchHttp(fetcher)({...request,url}))).kind,url).toBe('insecure-url');
  expect(fetcher).not.toHaveBeenCalled();
});
it('gives every request fifteen seconds unless told otherwise',async()=>{
  const limit=vi.spyOn(AbortSignal,'timeout');
  try{
    await fetchHttp(vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{status:200})))(request);
    expect(limit.mock.calls).toEqual([[15000]]);
  }finally{limit.mockRestore();}
});
it('gives up when the time limit passes',async()=>{
  const fetcher=vi.fn<typeof fetch>((_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason))));
  expect((await failureOf(fetchHttp(fetcher,20)(request))).kind).toBe('timeout');
});
it('gives up when the body stops arriving after the headers',async()=>{
  const fetcher=vi.fn<typeof fetch>(async(_url,init)=>new Response(new ReadableStream({start(controller){init!.signal!.addEventListener('abort',()=>controller.error(init!.signal!.reason));}}),{status:200}));
  expect((await failureOf(fetchHttp(fetcher,20)(request))).kind).toBe('timeout');
});
it('reports a failed connection without repeating anything from the request',async()=>{
  const leaky=new TypeError('fetch failed for https://test.dodopayments.com/checkouts with Bearer placeholder-key',{cause:new Error('placeholder-key')});
  const error=await failureOf(fetchHttp(vi.fn<typeof fetch>().mockRejectedValue(leaky))(request));
  expect(error.kind).toBe('network');
  expect(error.cause).toBeUndefined();
  for(const text of [error.message,String(error.stack),inspect(error,{depth:10}),JSON.stringify(error)]){
    expect(text).not.toContain('placeholder-key');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('dodopayments');
  }
});
it('names no address in any failure: not the one refused, not the one that timed out, redirected or sent too much',async()=>{
  const url='https://test.dodopayments.com/payments/pay_PrivateMarker01';
  const failures=[
    fetchHttp(vi.fn<typeof fetch>())({...request,url:url.replace('https','http')}),
    fetchHttp(vi.fn<typeof fetch>().mockRejectedValue(new DOMException(`timeout of ${url}`,'TimeoutError')))({...request,url}),
    fetchHttp(vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:302,headers:{location:url}})))({...request,url}),
    fetchHttp(vi.fn<typeof fetch>().mockResolvedValue(new Response('a'.repeat(1_000_001),{status:200})))({...request,url}),
  ];
  for(const failure of failures){
    const error=await failureOf(failure);
    for(const text of [error.message,String(error.stack),inspect(error,{depth:10}),JSON.stringify(error)])expect(text,error.kind).not.toMatch(/PrivateMarker|dodopayments|https?:/);
    expect(error.cause,error.kind).toBeUndefined();
  }
});
// The provider has no idempotency key: a request that is sent again can open a second session or send a second refund.
it.each<[string,(...args:Parameters<typeof fetch>)=>Promise<Response>]>([
  ['the line is dead',async()=>{throw new TypeError('fetch failed');}],
  ['the time limit passes',(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason)))],
  ['the body stops arriving',async(_url,init)=>new Response(new ReadableStream({start(controller){init!.signal!.addEventListener('abort',()=>controller.error(init!.signal!.reason));}}),{status:200})],
  ['the body breaks off',async()=>new Response(new ReadableStream({start(controller){controller.error(new TypeError('terminated'));}}),{status:200})],
  ['the answer is 500',async()=>new Response('',{status:500})],
  ['the answer is 502',async()=>new Response('<html>Bad Gateway</html>',{status:502})],
  ['the answer is 503',async()=>new Response('',{status:503,headers:{'retry-after':'1'}})],
  ['the answer is 429',async()=>new Response('{"code":"RATE_LIMIT_EXCEEDED"}',{status:429,headers:{'retry-after':'1'}})],
  ['the answer is 408',async()=>new Response('',{status:408})],
  ['the answer is a redirect',async()=>new Response(null,{status:307,headers:{location:'https://test.dodopayments.com/checkouts'}})],
  ['the answer cannot be read as JSON',async()=>new Response('{"session_id":"cks_',{status:200})],
])('sends exactly one request when %s: nothing is tried again',async(_label,reply)=>{
  const fetcher=vi.fn<typeof fetch>(reply);
  await fetchHttp(fetcher,20)(request).catch(()=>null);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('reads a reply of up to a million bytes and stops reading a larger one, however long it goes on',async()=>{
  const whole=vi.fn<typeof fetch>().mockResolvedValue(new Response('a'.repeat(1_000_000),{status:200}));
  expect((await fetchHttp(whole)(request)).body).toHaveLength(1_000_000);
  const over=vi.fn<typeof fetch>().mockResolvedValue(new Response('a'.repeat(1_000_001),{status:200}));
  expect((await failureOf(fetchHttp(over)(request))).kind).toBe('too-large');
  let chunks=0,cancelled=false;
  const endless=new ReadableStream<Uint8Array>({pull(controller){chunks++;controller.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;}});
  expect((await failureOf(fetchHttp(vi.fn<typeof fetch>().mockResolvedValue(new Response(endless,{status:500})))(request))).kind).toBe('too-large');
  expect(chunks).toBeLessThan(40);expect(cancelled).toBe(true);
});
it('reads a reply in several pieces as one text, also when a letter is cut in two',async()=>{
  const bytes=new TextEncoder().encode('{"name":"Zoë €"}');
  const pieces=new ReadableStream<Uint8Array>({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}});
  expect((await fetchHttp(vi.fn<typeof fetch>().mockResolvedValue(new Response(pieces,{status:200})))(request)).body).toBe('{"name":"Zoë €"}');
  expect((await fetchHttp(vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:204})))(request))).toEqual({status:204,body:''});
});
