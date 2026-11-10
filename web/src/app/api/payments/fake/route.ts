import { getSessionState } from '@/core/session/session';
import { fakeNotice } from '@/data/real/payments/fake-notice';
import { z } from 'zod';
export const runtime='nodejs';
const body=z.object({checkoutId:z.string().uuid(),kind:z.enum(['pending','paid','declined','cancelled','expired','refunded','refund-failed'])}).strict();
export async function POST(request:Request){
  const session=await getSessionState();
  if(session.kind!=='active'||!session.user.emailVerified)return Response.json({error:'unauthorized'},{status:401});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'bad-origin'},{status:403});
  if(Number(request.headers.get('content-length')??0)>2048)return Response.json({error:'invalid-input'},{status:400});
  let input;try{const raw=await request.text();if(raw.length>2048)throw new Error();input=body.parse(JSON.parse(raw));}catch{return Response.json({error:'invalid-input'},{status:400});}
  try{await fakeNotice(session.user.id,input.checkoutId,input.kind);return Response.json({ok:true});}catch{return Response.json({error:'fake-payment-refused'},{status:400});}
}
