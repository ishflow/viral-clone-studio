import { paymentConfig } from '@/core/payments/config';
import { receiveDodoNotice, receivePayment, eventSchema } from '../payments-gateway';
import { verify } from './signature';
/** Signature verification precedes JSON parsing and every write. Raw bytes are never reserialized. */
export async function paymentWebhook(request:Request):Promise<Response>{
  try {
    const config=paymentConfig();
    if(Number(request.headers.get('content-length')??0)>65536)return Response.json({error:'body-too-large'},{status:413});
    const reader=request.body?.getReader();let raw='';let bytes=0;
    // The signature is over the bytes received: a byte order mark stays in the text, so a body signed without it does not match.
    const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    // Bytes that are not UTF-8 come from a sender nobody has proved yet: that is a bad request, not a failure of ours.
    try{
      if(reader){for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536){await reader.cancel();return Response.json({error:'body-too-large'},{status:413});}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}
    }catch(error){if(!(error instanceof TypeError))throw error;return Response.json({error:'invalid-body'},{status:400});}
    if(config.mode==='test'){
      // Dodo's own scheme and events. The answer never says why a notice had no effect.
      const outcome=receiveDodoNotice(raw,request.headers);
      if(outcome==='unverified')return Response.json({error:'bad-signature'},{status:400});
      // It names a payment that is not stored yet: any answer but 2xx makes Dodo deliver it again later.
      return outcome==='retry'?Response.json({error:'not-ready'},{status:503}):Response.json({ok:true});
    }
    if(!verify(raw,request.headers,config.secret()))return Response.json({error:'bad-signature'},{status:400});
    let event;
    try{event=eventSchema.parse(JSON.parse(raw));}catch{return Response.json({error:'invalid-event'},{status:400});}
    if(event.eventId!==request.headers.get('webhook-id'))return Response.json({error:'event-id-mismatch'},{status:400});
    receivePayment(event,raw);return Response.json({ok:true});
  }catch{return Response.json({error:'payment-processing-failed'},{status:500});}
}
