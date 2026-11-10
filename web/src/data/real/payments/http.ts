/** The payment provider's only door to the network: https only, no redirects, no cache, a time limit, a size limit, and errors that repeat nothing from the request or the reply. */
export interface HttpRequest { method:'GET'|'POST'; url:string; headers:Record<string,string>; body?:string }
export interface HttpResponse { status:number; body:string }
export type Http=(request:HttpRequest)=>Promise<HttpResponse>;
export type HttpFailure='insecure-url'|'timeout'|'redirect'|'network'|'too-large';
export class HttpError extends Error {
  constructor(readonly kind:HttpFailure){super(`http-${kind}`);this.name='HttpError';}
}
function plainHttps(address:string):boolean {
  try{const url=new URL(address);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}
// A reply of the provider is a few thousand bytes. One that goes on and on is not read to its end.
const MAX_REPLY_BYTES=1_000_000;
async function textOf(response:Response):Promise<string> {
  if(!response.body)return '';
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let text='',size=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done)return text+decoder.decode();
    size+=value.byteLength;
    if(size>MAX_REPLY_BYTES){await reader.cancel();throw new HttpError('too-large');}
    text+=decoder.decode(value,{stream:true});
  }
}
export function fetchHttp(fetcher:typeof fetch=fetch,timeoutMs=15000):Http {
  return async({method,url,headers,body})=>{
    if(!plainHttps(url))throw new HttpError('insecure-url');
    try{
      // One signal covers the headers and the body: a reply that stalls halfway still ends.
      const response=await fetcher(url,{method,headers,body,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
      if(response.status>=300&&response.status<400){await response.body?.cancel();throw new HttpError('redirect');}
      return {status:response.status,body:await textOf(response)};
    }catch(error){
      if(error instanceof HttpError)throw error;
      // The cause is dropped on purpose: a runtime error may quote the address or a header.
      throw new HttpError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');
    }
  };
}
