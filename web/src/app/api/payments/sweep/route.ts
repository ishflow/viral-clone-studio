import { data } from '@/data';
import { liveJobs } from '@/data/mock/jobs';
import { paymentPipelineEnabled } from '@/core/payments/config';
import { configuredMailer } from '@/core/payments/resend';
import { secretEqual } from '@/data/real/payments/signature';
import { sweepPayments } from '@/data/real/payments-gateway';
import { drainOutbox } from '@/data/real/payments-outbox';
export const runtime='nodejs';
export async function POST(request:Request){
  if(!secretEqual(request.headers.get('authorization')?.replace(/^Bearer /,'')??null,process.env.INTERNAL_CRON_SECRET))return Response.json({error:'unauthorized'},{status:401});
  try{const transport=configuredMailer();if(process.env.VC_MAIL==='resend'){await data.mailer.outbox();liveJobs();}if(paymentPipelineEnabled())await sweepPayments(transport);else await drainOutbox(transport);return Response.json({ok:true});}catch{return Response.json({error:'payment-sweep-failed'},{status:500});}
}
