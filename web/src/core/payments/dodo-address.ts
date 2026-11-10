/** The longest address that is kept. */
const MAX_ADDRESS=2000;
/** An address the buyer's browser is given: Dodo's own https host, no credentials, in the form a browser reads it, of a length worth keeping. Null for anything else, text or not. */
export function dodoAddress(value:unknown):string|null {
  try{
    const url=new URL(typeof value==='string'?value:'');
    return url.protocol==='https:'&&!url.username&&!url.password&&(url.hostname==='dodopayments.com'||url.hostname.endsWith('.dodopayments.com'))&&url.href.length<=MAX_ADDRESS?url.href:null;
  }catch{return null;}
}
