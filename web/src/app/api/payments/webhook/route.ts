import { paymentWebhook } from '@/data/real/payments/webhook';
import { configuredMailer } from '@/core/payments/resend';
import { drainOutbox } from '@/data/real/payments-outbox';
export const runtime='nodejs';
export async function POST(request:Request){
  const response=await paymentWebhook(request);
  if(response.ok){await drainOutbox(configuredMailer());}
  return response;
}
