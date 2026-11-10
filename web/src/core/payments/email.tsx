import type * as ReactDOMServer from 'react-dom/server';
/** Load the Node transport renderer outside Next's react-server export condition. No client hooks are rendered here. */
const renderer = (): typeof ReactDOMServer => process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/package.json`)('react-dom/server');
import type { SentEmail, Locale } from '@/data/ports';
import { loadMessages } from '@/core/i18n/messages';
import { createTranslate } from '@/core/i18n/translate';
import type { Translate } from '@/core/i18n/types';
import { MAIL_GROUND, MailHead, MailView, type MailContent, type MailFact } from './mail-view';
import { dodoAddress } from './dodo-address';
/** "Oct 6, 2026": the UTC day, written as the screens write it, so a purchase has one date in the mail and in the account. */
function mailDate(iso:string,locale:Locale):string{const d=new Date(iso);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(d);}
const PARTS=['images','clips','music'] as const;
/** The counts a stopped mail carries ("3/5" per step) as the two rows of the mail: what is saved and what is missing. A content-rule stop cannot be continued, so it lists neither; written texts (an old queue entry) win over the counts. */
export function stoppedParts(d:Record<string,string>,t:Translate):{saved:string;missing:string}{
  if(d.reason==='content-rule')return {saved:'',missing:''};
  const counts=PARTS.flatMap(key=>{const [done,total]=(d[key]??'').split('/').map(Number);return total&&Number.isInteger(done)&&Number.isInteger(total)?[{key,done:done!,total}]:[];});
  const name=(key:typeof PARTS[number],count:number)=>t(`emails.stopped.part.${key}`,{count});
  const saved=counts.filter(c=>c.done>0).map(c=>c.done===c.total||c.key==='music'?name(c.key,c.done):t(`emails.stopped.part.${c.key}Of`,{done:c.done,total:c.total}));
  const missing=counts.filter(c=>c.done<c.total).map(c=>name(c.key,c.total-c.done));
  return {saved:d.saved||saved.join(', '),missing:d.missing||missing.join(', ')};
}
/** Transport content reuses the five preview dictionaries. No remote fonts, pixels, thumbnails or scripts. */
export function renderEmail(mail:SentEmail,locale:Locale,base:string):{subject:string;html:string;text:string}{
  const origin=new URL(base);if(!['https:','http:'].includes(origin.protocol)||origin.username||origin.password)throw new Error('invalid-mail-base');
  const t=createTranslate(locale,loadMessages(locale)), d=mail.data;
  const link=(path:string)=>new URL(/^\/(?!\/)/.test(path)&&!/[\\\r\n]/.test(path)?path:'/gallery',origin.origin).href;
  const validity=t('emails.validity.hours',{count:mail.kind==='verify'?24:1});
  const contentKind=mail.kind==='payment'&&d.refund==='true'?'refund':mail.kind==='payment'&&d.refund==='sent'?'refundSent':mail.kind;
  const values={pack:d.packName??'',credits:d.credits??'',balance:d.balance??'',email:mail.to,validity,minutes:d.minutes??''};
  const emailChange=mail.kind==='verify'&&d.purpose==='email-change';
  const part=(name:string)=>emailChange?`emails.verify.change${name[0]!.toUpperCase()}${name.slice(1)}`:`emails.${contentKind}.${name}`;
  const subject=t(part('subject'),values), title=t(part('title'),values);
  const swapOff=mail.kind==='stopped'&&d.swapClosed==='1';
  const swapNew=mail.kind==='stopped'&&!swapOff?d.swapStop==='photo-refused'?'swapPhotoRefused':d.swapStop==='person-missing'?'swapPersonMissing':null:null;   // a person swap that is not continued: a new job with another photo
  const body=t(mail.kind==='ready'&&!d.minutes?'emails.ready.bodyUnknown':swapOff?'emails.stopped.swapOffBody':swapNew?`emails.stopped.${swapNew}Body`:mail.kind==='stopped'&&d.reason==='content-rule'?'emails.stopped.contentBody':mail.kind==='stopped'&&d.reason==='submission-unknown'?'emails.stopped.checkingBody':mail.kind==='stopped'&&d.free==='1'?'emails.stopped.freeBody':mail.kind==='verify'&&!emailChange&&d.free==='0'?'emails.verify.bodyPlain':part('body'),{...values,credits:d.returned??d.credits??''});
  let path:string;
  switch(mail.kind){
    case 'verify':if(!d.token)throw new Error('mail-token-required');path=`/verify-email/confirm?token=${encodeURIComponent(d.token)}`;break;
    case 'reset':if(!d.token)throw new Error('mail-token-required');path=`/reset-password?token=${encodeURIComponent(d.token)}`;break;
    case 'ready':case 'stopped':path=`/jobs/${encodeURIComponent(d.jobId??'')}`;break;
    default:path=contentKind==='refund'||contentKind==='refundSent'?'/account':d.returnTo??'/gallery';
  }
  const factLabel=(k:string)=>t(`emails.${contentKind==='refundSent'?'refundSent':'payment'}.${k}`);
  const facts: [string,string][] = contentKind==='refundSent'?[['pack',d.packName??''],['credits',d.credits??''],['amount',d.amount??''],['date',mailDate(d.date??mail.at,locale)]].filter((fact):fact is [string,string]=>fact[1]!=='')
    :mail.kind==='payment'&&contentKind!=='refund'?[['pack',d.packName??''],['credits',d.credits??''],
      // Tax the provider added on top of the pack price: the receipt tells the price, the tax and the total that was charged.
      ...(d.tax&&d.total?[['price',d.amount??''],['tax',d.tax],['paid',d.total]] satisfies [string,string][]:[['paid',d.amount??'']] satisfies [string,string][]),
      ['date',mailDate(d.date??mail.at,locale)],['invoiceNumber',d.number??'']]:[];
  const url=link(path),action=t(`emails.${contentKind}.action`);
  // The provider is the seller, and its invoice is on its own site: the site's own invoice page is linked beside it, so one is left if the other does not open.
  const invoice=dodoAddress(d.invoiceUrl);
  const note=t(swapOff?'emails.stopped.swapOffNote':swapNew?`emails.stopped.${swapNew}Note`:mail.kind==='stopped'&&d.reason==='content-rule'?'emails.stopped.contentNote':mail.kind==='stopped'&&d.reason==='submission-unknown'?'emails.stopped.checkingNote':mail.kind==='stopped'&&d.free==='1'?'emails.stopped.freeNote':part('note'),{...values,credits:d.resumeCost??d.returned??''});
  const text=[title,body,...facts.map(([k,v])=>`${factLabel(k)}: ${v}`),`${action}: ${url}`,note,...(contentKind==='refundSent'?[`${t('emails.footer.contact')}: ${link('/contact')}`]:[]),t('emails.footer.company')].join('\n\n');
  const home=link('/'),contact=link('/contact');
  const factRows=facts.map(([k,v])=>[factLabel(k),v] as MailFact);
  const parts=mail.kind==='stopped'?stoppedParts(d,t):{saved:'',missing:''};
  const stoppedRows:MailFact[]=mail.kind==='stopped'?[[t('emails.stopped.template'),d.templateTitle??''],[t('emails.stopped.saved'),parts.saved],[t('emails.stopped.missing'),parts.missing],[t(d.free==='1'?'emails.stopped.freeReturned':'emails.stopped.returned'),d.free==='1'?t('emails.stopped.freeVideo'):d.returned??'']].filter((row):row is MailFact=>row[1]!==''):[];
  const readyDetails=d.details??(d.seconds&&(d.quality==='fast'||d.quality==='best')?t('emails.ready.details',{seconds:Math.round(Number(d.seconds)),quality:t(`common.quality.${d.quality}`)}):'');
  const status=mail.kind==='ready'?{label:t('emails.ready.status'),tone:'done' as const}:mail.kind==='stopped'?{label:t('emails.stopped.status'),tone:'warn' as const}:contentKind==='payment'||contentKind==='refundSent'?{label:t(`emails.${contentKind}.status`),tone:'done' as const}:undefined;
  const content:MailContent={status,title,body:contentKind==='payment'?`${body} ${t('emails.payment.saved')}`:body,
    ...(mail.kind==='ready'&&d.templateTitle&&readyDetails?{summary:{title:d.templateTitle,details:readyDetails}}:{}),
    facts:[...factRows,...stoppedRows],action:{label:action,href:url},
    ...(mail.kind==='payment'&&contentKind==='payment'&&(invoice||d.invoiceId)?{secondary:[...(invoice?[{label:t('emails.payment.invoiceDodo'),href:invoice}]:[]),...(d.invoiceId?[{label:t('emails.payment.invoice'),href:link(`/invoices/${encodeURIComponent(d.invoiceId)}`)}]:[])]}:{}),
    note:mail.kind==='stopped'&&!swapOff&&!swapNew?`${note} ${t('emails.stopped.retention')}`:note,home,footer:{intro:t('emails.footer.intro'),contact:{label:t('emails.footer.contact'),href:contact},company:t('emails.footer.company')}};
  const html='<!doctype html>'+renderer().renderToStaticMarkup(<html lang={locale}><MailHead title={subject}/><body style={{margin:0,padding:0,background:MAIL_GROUND}}><MailView mail={content}/></body></html>);
  return {subject,html,text};
}
