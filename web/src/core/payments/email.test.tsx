// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderEmail, stoppedParts } from './email';
import { loadMessages } from '@/core/i18n/messages';
import { createTranslate } from '@/core/i18n/translate';
import type { EmailKind, Locale, SentEmail } from '@/data/ports';
it.each(['verify','reset','ready','stopped','payment'] as EmailKind[])('renders %s in both languages as escaped HTML and plain text without tracking',kind=>{
  for(const locale of ['en','tr'] as Locale[]){
    const rendered=renderEmail({id:'mail',kind,to:'owner@example.com',at:new Date().toISOString(),data:{token:'placeholder',jobId:'job',credits:'10',balance:'10',packName:'<script>unsafe</script>',amount:'$19.00',number:'001',returnTo:'https://attacker.invalid'}},locale,'http://localhost:3201');
    expect(rendered.subject).not.toContain('emails.');expect(rendered.html).toContain(`lang="${locale}"`);
    expect(rendered.html).not.toMatch(/<script|<img|tracking|attacker\.invalid/);expect(rendered.text.length).toBeGreaterThan(50);
    if(kind==='payment')expect(rendered.html).toContain('&lt;script&gt;');
  }
});
it('the footer names ishflow and its address in both languages, in the HTML and the plain text',()=>{
 const mail={id:'mail',kind:'ready' as const,to:'owner@example.com',at:'2026-10-05',data:{jobId:'job'}};
 for(const locale of ['en','tr'] as const){
  const r=renderEmail(mail,locale,'http://localhost:3202');
  for(const part of ['© ishflow','123 Example St, City, Country'])for(const out of [r.html,r.text])expect(out).toContain(part);
  expect(r.html+r.text).not.toMatch(/© Viral Clone|COMPANY NAME|ADDRESS|\{company\}|\{address\}/);
 }
});
it.each(['en','tr'] as const)('renders refund confirmation separately from a credit receipt in %s',locale=>{
 const rendered=renderEmail({id:'refund',kind:'payment',to:'owner@example.com',at:'2026-10-05',data:{refund:'true',packName:'Pack',credits:'10',invoiceId:'invoice'}},locale,'http://localhost:3202');
 expect(rendered.subject).toBe(locale==='en'?'Your refund is complete':'İaden tamamlandı');expect(rendered.html).toContain('/account');expect(rendered.html).not.toContain('/invoices/');
});
it.each([['en','Your refund is on its way',['Pack','$19.00','Oct 5, 2026','10','a few days','come back to your balance']],['tr','İaden yolda',['Pack','$19.00','5 Eki 2026','10','birkaç gün','bakiyene geri döner']]] as const)('a sent refund tells in %s the pack, the amount, the day, the credits taken out, that the money takes a few days and where to ask',(locale,subject,said)=>{
 const rendered=renderEmail({id:'sent',kind:'payment',to:'owner@example.com',at:'2026-10-05T10:00:00.000Z',data:{refund:'sent',purchaseId:'p',packName:'Pack',credits:'10',amount:'$19.00',date:'2026-10-05T10:00:00.000Z'}},locale,'http://localhost:3202');
 expect(rendered.subject).toBe(subject);
 for(const text of [rendered.text,rendered.html])for(const part of said){expect(text).toContain(part);expect(text).not.toContain('emails.');}
 expect(rendered.html).toContain('/account');expect(rendered.html).not.toContain('/invoices/');expect(rendered.text).toContain('http://localhost:3202/contact');
 const unknown=renderEmail({id:'sent',kind:'payment',to:'owner@example.com',at:'2026-10-05',data:{refund:'sent',packName:'Pack',credits:'10',amount:''}},locale,'http://localhost:3202');
 expect(unknown.text).not.toMatch(/: \n/);
});
it.each([['en','You do not need to do anything, and nothing more is charged.','Continuing'],['tr','Bir şey yapmana gerek yok, başka kredi kesilmez.','Devam etmek']] as const)('a stopped email for a request we are checking ourselves says in %s what the job page says, and names no price to continue',(locale,promise,price)=>{
 const stopped=(reason:string,free:string)=>renderEmail({id:'stopped',kind:'stopped',to:'owner@example.com',at:'2026-10-05',data:{jobId:'job',templateTitle:'T',reason,returned:'2',resumeCost:'2',free}},locale,'http://localhost:3202');
 for(const free of ['0','1']){
  expect(stopped('clips-failed',free).text).toContain(price);
  const mail=stopped('submission-unknown',free);
  for(const said of [mail.text,mail.html]){expect(said).toContain(promise);expect(said).not.toContain(price);expect(said).not.toContain('emails.');}
  expect(mail.html).toContain('/jobs/job');
 }
});
it.each([['en','Person swap is switched off right now, so this job cannot be continued. Your 3 credits are back in your balance.','Continuing','kept for 30 days'],['tr','Kişi değiştirme şu an kapalı, bu yüzden bu işe devam edilemez. 3 kredin bakiyene geri döndü.','Devam etmek','30 gün saklanır']] as const)('a stopped email of a person swap stopped while person swap is switched off says so in %s, and offers no continue and no price of one',(locale,said,price,kept)=>{
 const mail=renderEmail({id:'stopped',kind:'stopped',to:'owner@example.com',at:'2026-10-05',data:{jobId:'job',templateTitle:'T',reason:'clips-failed',returned:'3',resumeCost:'0',free:'0',swapClosed:'1'}},locale,'http://localhost:3202');
 for(const text of [mail.text,mail.html]){expect(text).toContain(said);expect(text).not.toContain(price);expect(text).not.toContain(kept);expect(text).not.toContain('emails.');}
 expect(mail.text).not.toMatch(/\b0 (credits|kredi)/);
 expect(mail.html).toContain('/jobs/job');
});
it.each([
 ['en','photo-refused','The photo could not be used for this video, so nothing was made. Your 3 credits are back in your balance.','You cannot continue this job. Start a new one with another photo.','Continuing'],
 ['tr','photo-refused','Fotoğraf bu video için kullanılamadı, bu yüzden hiçbir şey üretilmedi. 3 kredin bakiyene geri döndü.','Bu işe devam edemezsin. Başka bir fotoğrafla yeni bir iş başlat.','Devam etmek'],
 ['en','person-missing','The person to replace could not be found, in the video or in your photo, so nothing was made. Your 3 credits are back in your balance.','You cannot continue this job. Start a new one with another photo, or contact support.','Continuing'],
 ['tr','person-missing','Değiştirilecek kişi videoda ya da fotoğrafında bulunamadı, bu yüzden hiçbir şey üretilmedi. 3 kredin bakiyene geri döndü.','Bu işe devam edemezsin. Başka bir fotoğrafla yeni bir iş başlat ya da destekle iletişime geç.','Devam etmek'],
] as const)('a stopped email of a person swap (%s) that stopped with %s says so, offers no continue and no price of one, and asks for a new job with another photo',(locale,swapStop,said,asked,price)=>{
 const mail=renderEmail({id:'stopped',kind:'stopped',to:'owner@example.com',at:'2026-10-05',data:{jobId:'job',templateTitle:'T',reason:'clips-failed',returned:'3',resumeCost:'0',free:'0',swapStop}},locale,'http://localhost:3202');
 for(const text of [mail.text,mail.html]){expect(text).toContain(said);expect(text).toContain(asked);expect(text).not.toContain(price);expect(text).not.toContain('emails.');}
 expect(mail.text).not.toMatch(/\b0 (credits|kredi)/);
 expect(mail.text).not.toMatch(/kept for 30 days|30 gün saklanır/);
});
it('a stopped email that is both closed and of a refused photo is the closed one',()=>{
 const mail=renderEmail({id:'stopped',kind:'stopped',to:'owner@example.com',at:'2026-10-05',data:{jobId:'job',templateTitle:'T',reason:'clips-failed',returned:'3',resumeCost:'0',free:'0',swapClosed:'1',swapStop:'photo-refused'}},'en','http://localhost:3202');
 expect(mail.text).toContain('Person swap is switched off right now');
 expect(mail.text).not.toContain('another photo');
});
it.each([['en','Confirm your new email','Your old address stays'],['tr','Yeni e-postanı onayla','eski adresin geçerli']] as const)('a verify mail whose purpose is email-change speaks about the new address and never about a free video, in %s',(locale,subject,promise)=>{
 const change=renderEmail({id:'change',kind:'verify',to:'new@example.com',at:'2026-10-05',data:{token:'t',purpose:'email-change'}},locale,'http://localhost:3202');
 expect(change.subject).toBe(subject);
 for(const said of [change.text,change.html]){expect(said).not.toMatch(/free video|ücretsiz video|activate|etkinleştir/i);expect(said).not.toContain('emails.');}
 expect(change.text.toLowerCase()).toContain(promise.toLowerCase());
 expect(change.text).toContain('24');
 const signUp=renderEmail({id:'signup',kind:'verify',to:'new@example.com',at:'2026-10-05',data:{token:'t',purpose:'verify'}},locale,'http://localhost:3202');
 expect(signUp.subject).not.toBe(subject);expect(signUp.text).toMatch(/free video|ücretsiz video/i);
});
it.each([['en','Confirm this address to activate your account.'],['tr','Hesabını etkinleştirmek için bu adresi onayla.']] as const)('free 0 → no free video in the body of the sign-up mail in %s; without the field (an older mail) the text stays as it was',(locale,plain)=>{
 const signUp=(data:Record<string,string>)=>renderEmail({id:'signup',kind:'verify',to:'new@example.com',at:'2026-10-05',data:{token:'t',purpose:'verify',...data}},locale,'http://localhost:3202');
 for(const said of [signUp({free:'0'}).text,signUp({free:'0'}).html]){expect(said).toContain(plain);expect(said).not.toMatch(/free video|ücretsiz video/i);}
 for(const data of [{free:'1'},{}] as Record<string,string>[])expect(signUp(data).text).toMatch(/free video|ücretsiz video/i);
});
it.each([['en','Oct 6, 2026'],['tr','6 Eki 2026']] as const)('the payment mail writes the date as a day, not as an ISO stamp, in %s',(locale,day)=>{
 const receipt=(data:Record<string,string>)=>renderEmail({id:'pay',kind:'payment',to:'owner@example.com',at:'2026-10-06T20:31:52.279Z',data:{packName:'Pack',credits:'10',amount:'$19.00',number:'001',invoiceId:'inv',...data}},locale,'http://localhost:3202');
 for(const mail of [receipt({date:'2026-10-06T20:31:52.279Z'}),receipt({})])for(const said of [mail.text,mail.html]){expect(said).toContain(day);expect(said).not.toMatch(/2026-10-06|T20:31/);}
});
const designCases: [string, Record<string, string>, SentEmail['kind']][] = [
 ['verify',{token:'t',purpose:'verify'},'verify'],['verify of an email change',{token:'t',purpose:'email-change'},'verify'],['reset',{token:'t'},'reset'],
 ['ready',{jobId:'j',templateTitle:'Layering',minutes:'7',seconds:'8',quality:'fast'},'ready'],['ready without a length',{jobId:'j'},'ready'],
 ['stopped',{jobId:'j',templateTitle:'T',reason:'clips-failed',returned:'2',free:'0'},'stopped'],['stopped, free video',{jobId:'j',templateTitle:'T',free:'1'},'stopped'],
 ['stopped by a content rule',{jobId:'j',templateTitle:'T',reason:'content-rule'},'stopped'],['stopped, we are checking',{jobId:'j',templateTitle:'T',reason:'submission-unknown'},'stopped'],
 ['payment',{packName:'Standard',credits:'30',balance:'42',amount:'$19.00',number:'001',invoiceId:'inv',date:'2026-10-06T20:31:52.279Z'},'payment'],
 ['refund',{refund:'true',packName:'Standard',credits:'30'},'payment'],['refund sent',{refund:'sent',packName:'Standard',credits:'30',amount:'$19.00',date:'2026-10-05T10:00:00.000Z'},'payment'],
];
describe.each(designCases)('the sent %s mail carries the canvas design in an email-client-safe form',(_name,data,kind)=>{
 for(const locale of ['en','tr'] as const){
  const html=()=>renderEmail({id:'m',kind,to:'owner@example.com',at:'2026-10-05T10:00:00.000Z',data},locale,'http://localhost:3202').html;
  it(`${locale}: light ground, white card of at most 600 px, the lime button, the display heading, all in inline styles and tables`,()=>{
   const out=html();
   expect(out).toContain('<meta name="color-scheme" content="light"/>');expect(out).toContain('<meta name="supported-color-schemes" content="light"/>');
   expect(out).toContain('bgcolor="#F4F5EE"');expect(out).toContain('bgcolor="#FFFFFF"');expect(out).toContain('max-width:600px');
   expect(out).toMatch(/<td bgcolor="#C8F03C"[^>]*><a href="[^"]+"[^>]*style="[^"]*color:#0B0C0A/);
   expect(out).toMatch(/<h1 style="[^"]*font-size:32px/);expect(out).toMatch(/<h1 style="[^"]*font-weight:800/);
   expect(out).toContain('<table role="presentation"');expect(out).not.toMatch(/<(dl|main|footer|div)[ >]/);
  });
  it(`${locale}: nothing remote and no script: no image, font file, stylesheet link, svg, url() or tracking`,()=>{
   expect(html()).not.toMatch(/<(img|svg|script|link|iframe)|@import|url\(|fonts\.g|<style[^>]*src/i);
  });
  it(`${locale}: the logo is text with the two-box mark, the footer says who sends and where to ask`,()=>{
   const out=html();expect(out).toContain('viral clone');expect(out).toContain('href="http://localhost:3202/"');expect(out).toContain('href="http://localhost:3202/contact"');expect(out).toContain('© ishflow');
  });
 }
});
it('a payment mail lays the pack, credits, amount, date and invoice number out as a table of rows with a line between them, and keeps the invoice as a quiet link',()=>{
 const out=renderEmail({id:'p',kind:'payment',to:'o@e.co',at:'2026-10-06T20:31:52.279Z',data:{packName:'Standard',credits:'30',balance:'42',amount:'$19.00',number:'001',invoiceId:'inv/1',date:'2026-10-06T20:31:52.279Z'}},'en','http://localhost:3202').html;
 for(const [label,value] of [['Pack','Standard'],['Credits','30'],['Paid','$19.00'],['Date','Oct 6, 2026'],['Invoice number','001']] as [string,string][])expect(out).toMatch(new RegExp(`<td [^>]*border-top:1px solid #E0E2D7[^>]*>${label}</td><td [^>]*font-weight:600[^>]*>${value.replace('$','\\$')}</td>`));
 expect(out).toMatch(/<a href="http:\/\/localhost:3202\/invoices\/inv%2F1"[^>]*>Download invoice<\/a>/);
});
it('a stopped mail has the amber status square and the rows of what was stopped; a ready mail has the box with the template and its details',()=>{
 const stopped=renderEmail({id:'s',kind:'stopped',to:'o@e.co',at:'2026-10-05',data:{jobId:'j',templateTitle:'Layering',reason:'clips-failed',returned:'2',free:'0',saved:'5 images',missing:'2 clips'}},'en','http://localhost:3202').html;
 expect(stopped).toContain('color:#A8400F');for(const row of ['Template','Layering','Saved so far','5 images','Missing','2 clips','Credits returned'])expect(stopped).toContain(`>${row}<`);
 const ready=renderEmail({id:'r',kind:'ready',to:'o@e.co',at:'2026-10-05',data:{jobId:'j',templateTitle:'Layering',minutes:'7',seconds:'8',quality:'fast'}},'en','http://localhost:3202').html;
 expect(ready).toMatch(/bgcolor="#F4F5EE"[^>]*>[^]*Layering[^]*8 sec · Fast · mp4/);
});
it('the heading, the body and the button stay readable if a client turns the mail dark: every text colour is set on its own element together with a background of the card',()=>{
 const out=renderEmail({id:'v',kind:'verify',to:'o@e.co',at:'2026-10-05',data:{token:'t'}},'en','http://localhost:3202').html;
 expect(out).toMatch(/<h1 style="[^"]*color:#0B0C0A/);expect(out).toMatch(/<p style="[^"]*color:#3E4236/);expect(out).toMatch(/<p style="[^"]*color:#5A5F50/);
});
it.each([['en','The video stays in My videos for 12 months.'],['tr',"Video 12 ay boyunca Videolarım'da kalır."]] as const)('the ready mail says how long the video is kept, in %s',(locale,kept)=>{
 for(const data of [{jobId:'job',minutes:'7'},{jobId:'job'}] as Record<string,string>[]){
  const rendered=renderEmail({id:'r',kind:'ready',to:'o@e.co',at:'2026-10-05',data},locale,'http://localhost:3202');
  expect(rendered.text).toContain(kept);expect(rendered.html).toContain(kept.replace("'",'&#x27;'));
 }
});
describe('the parts a stopped mail lists',()=>{
 const base={jobId:'j',templateTitle:'Layering',reason:'clips-failed',returned:'2',free:'0'};
 const html=(data:Record<string,string>,locale:'en'|'tr')=>renderEmail({id:'s',kind:'stopped',to:'o@e.co',at:'2026-10-05',data:{...base,...data}},locale,'http://localhost:3202').html;
 const rows=(locale:'en'|'tr')=>locale==='en'?{saved:'Saved so far',missing:'Missing'}:{saved:'Şimdiye kadar kaydedilen',missing:'Eksik'};
 it.each([
  ['en',{images:'5/5',clips:'3/5',music:'1/1'},'5 images, 3 of 5 clips, music','2 clips'],
  ['tr',{images:'5/5',clips:'3/5',music:'1/1'},'5 görsel, 5 klibin 3 tanesi, müzik','2 klip'],
  ['en',{images:'5/5',clips:'3/5',music:'0/1'},'5 images, 3 of 5 clips','2 clips, music'],
  ['tr',{images:'5/5',clips:'3/5',music:'0/1'},'5 görsel, 5 klibin 3 tanesi','2 klip, müzik'],
  ['en',{images:'3/5',clips:'0/5',music:'0/1'},'3 of 5 images','2 images, 5 clips, music'],
 ] as const)('the stopped mail lists what is saved and what is missing from the counts in %s: %j',(locale,counts,saved,missing)=>{
  const out=html(counts,locale);
  expect(out).toContain(`>${rows(locale).saved}<`);expect(out).toContain(`>${saved}<`);
  expect(out).toContain(`>${rows(locale).missing}<`);expect(out).toContain(`>${missing}<`);
  expect(out).not.toContain('emails.');
 });
 it.each(['en','tr'] as const)('with no counts the stopped mail has neither row in %s',locale=>{
  const out=html({},locale);
  expect(out).not.toContain(`>${rows(locale).saved}<`);expect(out).not.toContain(`>${rows(locale).missing}<`);
 });
 it.each(['en','tr'] as const)('a content-rule stop has neither row in %s, even with counts',locale=>{
  const out=html({reason:'content-rule',images:'5/5',clips:'3/5'},locale);
  expect(out).not.toContain(`>${rows(locale).saved}<`);expect(out).not.toContain(`>${rows(locale).missing}<`);
 });
 it('written saved and missing texts (an old queue entry) win over the counts',()=>{
  const out=html({saved:'5 images',missing:'2 clips',clips:'1/9'},'en');
  expect(out).toContain('>5 images<');expect(out).toContain('>2 clips<');expect(out).not.toContain('1 of 9');
 });
 it('stoppedParts counts one image and one clip in the singular, and writes nothing for a step that is complete or has no work',()=>{
  const t=createTranslate('en',loadMessages('en'));
  expect(stoppedParts({images:'1/1',clips:'0/1',music:'0/0'},t)).toEqual({saved:'1 image',missing:'1 clip'});
  expect(stoppedParts({images:'2/2'},t)).toEqual({saved:'2 images',missing:''});
 });
});
it('the Turkish refund mails name the purchase once: a pack called "Standard pack" is not followed by "paketi" or "paketinin"',()=>{
 for(const data of [{refund:'true',packName:'Standard pack',credits:'30',invoiceId:'inv'},{refund:'sent',packName:'Standard pack',credits:'30',amount:'$19.00'}] as Record<string,string>[]){
  const rendered=renderEmail({id:'r',kind:'payment',to:'o@e.co',at:'2026-10-05',data},'tr','http://localhost:3202');
  expect(rendered.text).toMatch(/Standard pack (alımı|alımının)/);expect(rendered.text).not.toMatch(/pack paketi/);
 }
});
it.each([['en',['Pack price: $19.00','Tax: $3.61','Paid: $22.61']],['tr',['Paket bedeli: $19.00','Vergi: $3.61','Ödenen: $22.61']]] as const)('a receipt of a payment the provider added tax to tells in %s the pack price, the tax and the total that was charged; without a tax it tells what it told before',(locale,said)=>{
 const data={purchaseId:'p',invoiceId:'i',packName:'Starter',credits:'10',balance:'10',amount:'$19.00',date:'2026-10-05T10:00:00.000Z',number:'VC-000001',returnTo:'/gallery'};
 const mail=(extra:Record<string,string>)=>renderEmail({id:'mail',kind:'payment',to:'owner@example.com',at:'2026-10-05T10:00:00.000Z',data:{...data,...extra}},locale,'http://localhost:3202');
 const taxed=mail({tax:'$3.61',total:'$22.61'}), plain=mail({});
 for(const line of said)expect(taxed.text).toContain(line);
 for(const part of ['$19.00','$3.61','$22.61'])expect(taxed.html).toContain(part);
 expect(plain.text).toContain(locale==='en'?'Paid: $19.00':'Ödenen: $19.00');
 expect(plain.text+plain.html).not.toMatch(/Tax|Vergi|Pack price|Paket bedeli/);
});
it('the receipt links to the site\'s own invoice page always, and beside it to the provider\'s own invoice where the mail carries its address, in both languages: one is left if the other does not open; an address that is not the provider\'s own is not printed',()=>{
 const data={purchaseId:'p',invoiceId:'i',packName:'Starter',credits:'10',balance:'10',amount:'$19.00',date:'2026-10-05T10:00:00.000Z',number:'VC-000001',returnTo:'/gallery'};
 const html=(invoiceUrl?:string,locale:Locale='en')=>renderEmail({id:'mail',kind:'payment',to:'owner@example.com',at:'2026-10-05T10:00:00.000Z',data:{...data,...(invoiceUrl===undefined?{}:{invoiceUrl})}},locale,'http://localhost:3202').html;
 const dodo='https://test.dodopayments.com/invoices/payments/pay_A';
 expect(html(dodo)).toMatch(/<a href="https:\/\/test\.dodopayments\.com\/invoices\/payments\/pay_A"[^>]*>Invoice \(Dodo\)<\/a>/);expect(html(dodo)).toMatch(/<a href="http:\/\/localhost:3202\/invoices\/i"[^>]*>Download invoice<\/a>/);
 expect(html(dodo,'tr')).toMatch(/<a href="https:\/\/test\.dodopayments\.com\/invoices\/payments\/pay_A"[^>]*>Fatura \(Dodo\)<\/a>/);expect(html(dodo,'tr')).toMatch(/<a href="http:\/\/localhost:3202\/invoices\/i"[^>]*>Faturayı indir<\/a>/);
 for(const other of [undefined,'','http://test.dodopayments.com/invoices/pay_A','https://elsewhere.example/invoice','https://dodopayments.com.elsewhere.example/x','javascript:alert(1)']){
  expect(html(other)).toContain('href="http://localhost:3202/invoices/i"');expect(html(other)).not.toMatch(/elsewhere|javascript|http:\/\/test\.dodo|Dodo/);
 }
});
it('the quiet links under the button of a receipt: with the provider\'s invoice address its link stands on a line of its own above the site\'s invoice link; without it the one link is drawn as it was',()=>{
 const dodo='https://test.dodopayments.com/invoices/payments/pay_A', own=/<a href="http:\/\/localhost:3202\/invoices\/i" class="mail-link" style="display:inline-block;padding-top:8px;[^>]*>Download invoice<\/a>/;
 const html=(extra:Record<string,string>)=>renderEmail({id:'mail',kind:'payment',to:'owner@example.com',at:'2026-10-05T10:00:00.000Z',data:{invoiceId:'i',packName:'Starter',credits:'10',balance:'10',amount:'$19.00',number:'VC-000001',...extra}},'en','http://localhost:3202').html;
 const one=html({}), two=html({invoiceUrl:dodo});
 expect(one.match(/class="mail-link"/g)).toHaveLength(1);expect(one).toMatch(new RegExp(`</table>${own.source}</td>`));expect(one).not.toContain('<p style="margin:0">');
 expect(two.match(/class="mail-link"/g)).toHaveLength(2);expect(two).toMatch(new RegExp(`</table><p style="margin:0"><a href="${dodo}" class="mail-link" [^>]*>Invoice \\(Dodo\\)</a></p>${own.source}</td>`));
 expect(two.match(own)![0]).toBe(one.match(own)![0]);
});
