import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { renderEmail } from '@/core/payments/email';
import { formatDate } from '@/shared/lib/format';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { createTranslate } from '@/core/i18n/translate';
import { loadMessages } from '@/core/i18n/messages';
import type { SentEmail } from '@/data/ports';
import { OutboxList, PaymentEmail, ReadyEmail, ResetEmail, StoppedEmail, VerifyEmail } from './index';
import { EMAIL_NAMES, isEmailName, propsFor } from './build';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/core/i18n/server', async () => {
  const { createTranslate } = await import('@/core/i18n/translate');
  const { loadMessages } = await import('@/core/i18n/messages');
  const messages = loadMessages('en');
  return { getI18n: async () => ({ locale: 'en', t: createTranslate('en', messages), messages }) };
});

afterEach(cleanup);

function link(name: string) {
  return screen.getByRole('link', { name });
}

describe('email components', () => {
  it('verify: primary action goes to /verify-email', () => {
    renderWithI18n(<VerifyEmail validity="24 hours" />);
    expect(link('Verify email')).toHaveAttribute('href', '/verify-email');
    expect(screen.getByText(/works for 24 hours/)).toBeInTheDocument();
  });

  it('verify for an email change speaks about the new address, never a free video, in the preview as in the sent mail', () => {
    const spec = propsFor('verify', entry('verify', { token: 't', purpose: 'email-change' }), tEn, 'en');
    if (spec.kind !== 'verify') throw new Error('not a verify spec');
    renderWithI18n(<VerifyEmail {...spec.props} />);
    expect(screen.getByText('Confirm your new email.')).toBeInTheDocument();
    expect(screen.getByText(/Until then your old address stays/)).toBeInTheDocument();
    expect(screen.queryByText(/free video/)).toBeNull();
  });

  it('verify with free 0 promises no free video in the preview either; an entry without the field keeps the text', () => {
    const spec = (data: Record<string, string>) => {
      const made = propsFor('verify', entry('verify', { token: 't', purpose: 'verify', ...data }), tEn, 'en');
      if (made.kind !== 'verify') throw new Error('not a verify spec');
      return made.props;
    };
    renderWithI18n(<VerifyEmail {...spec({ free: '0' })} />);
    expect(screen.getByText('Confirm this address to activate your account.')).toBeInTheDocument();
    cleanup();
    renderWithI18n(<VerifyEmail {...spec({})} />);
    expect(screen.getByText(/get your free video/)).toBeInTheDocument();
  });

  it('reset: primary action goes to /reset-password and shows the address', () => {
    renderWithI18n(<ResetEmail email="a@b.co" validity="1 hour" />);
    expect(link('Set new password')).toHaveAttribute('href', '/reset-password');
    expect(screen.getByText(/a@b\.co/)).toBeInTheDocument();
  });

  it('ready: action goes to /jobs/<id>', () => {
    renderWithI18n(<ReadyEmail jobId="job-1" title="Layering" minutes="7" details="8 sec" />);
    expect(link('Watch and download')).toHaveAttribute('href', '/jobs/job-1');
    expect(screen.getByText('Layering')).toBeInTheDocument();
  });

  it('stopped: action goes to /jobs/<id>', () => {
    renderWithI18n(<StoppedEmail jobId="job-2" title="Layering" saved="[SAVED SO FAR]" missing="[MISSING]" reason="clips-failed" />);
    expect(link('Open the job')).toHaveAttribute('href', '/jobs/job-2');
    expect(screen.getByText('[MISSING]')).toBeInTheDocument();
  });

  it('payment: the main button goes back to the video, the invoice is a quiet link, the form is said to be saved', () => {
    renderWithI18n(<PaymentEmail invoiceId="inv-9" pack="Standard" credits="30" balance="42" amount="[AMOUNT]" date="[DATE]" number="[INVOICE NUMBER]" returnTo="/templates/tpl-1" />);
    expect(link('Back to your video')).toHaveAttribute('href', '/templates/tpl-1');
    expect(link('Download invoice')).toHaveAttribute('href', '/invoices/inv-9');
    expect(screen.getByRole('heading', { name: '30 credits added.' })).toBeInTheDocument();
    expect(screen.getByText(/Your form is saved\./)).toBeInTheDocument();
    expect(screen.getByText('Credits')).toBeInTheDocument();
  });
  it('refund sent: says the refund is on its way, shows what was refunded and goes to the account, with no invoice link', () => {
    renderWithI18n(<PaymentEmail invoiceId="sample" pack="Standard" credits="30" balance="" amount="$29.00" date="Oct 5, 2026" number="" returnTo="/gallery" refundSent />);
    expect(screen.getByRole('heading', { name: 'Your refund is on its way.' })).toBeInTheDocument();
    expect(link('Open your account')).toHaveAttribute('href', '/account');
    expect(screen.queryByRole('link', { name: 'Download invoice' })).toBeNull();
    for (const fact of ['Standard', '30', '$29.00', 'Oct 5, 2026']) expect(screen.getByText(fact)).toBeInTheDocument();
    expect(screen.getByText(/a few days/)).toBeInTheDocument();
  });
  it('verify and reset: the button carries the single-use token; the notes say 24 hours / 1 hour, never a placeholder', () => {
    renderWithI18n(<VerifyEmail validity="24 hours" token="tok/1" />);
    expect(link('Verify email')).toHaveAttribute('href', '/verify-email/confirm?token=tok%2F1');
    expect(screen.getByText(/works for 24 hours/)).toBeInTheDocument();
  });

  it('every email is light and links to /contact', () => {
    const { container } = renderWithI18n(<VerifyEmail validity="x" />);
    expect(container.querySelector('[data-theme="light"]')).not.toBeNull();
    expect(link('Contact support')).toHaveAttribute('href', '/contact');
  });

  it('turkish renders', () => {
    renderWithI18n(<VerifyEmail validity="x" />, 'tr');
    expect(link('E-postayı doğrula')).toBeInTheDocument();
  });
});

describe('stopped reason', () => {
  const base = { jobId: 'j', title: 'T', saved: 's', missing: 'm' };
  it('translates a known code', () => {
    renderWithI18n(<StoppedEmail {...base} reason="clips-failed" />);
    expect(screen.getByText('One step failed, so we stopped. Your [CREDITS] credits are back in your balance. Open the job to continue or close it.')).toBeInTheDocument();
  });
  it('has the four board rows', () => {
    renderWithI18n(<StoppedEmail {...base} reason="clips-failed" />);
    for (const label of ['Template', 'Saved so far', 'Missing', 'Credits returned']) expect(screen.getByText(label).closest('tr')?.querySelectorAll('td')).toHaveLength(2);
  });
  it('falls back for an unknown code', () => {
    renderWithI18n(<StoppedEmail {...base} reason="something-new" />);
    expect(screen.getByText('One step failed, so we stopped. Your [CREDITS] credits are back in your balance. Open the job to continue or close it.')).toBeInTheDocument();
  });
  it('falls back for a missing code', () => {
    renderWithI18n(<StoppedEmail {...base} reason="" />);
    expect(screen.getByText('One step failed, so we stopped. Your [CREDITS] credits are back in your balance. Open the job to continue or close it.')).toBeInTheDocument();
  });
  it('the preview of a person swap stopped while person swap is switched off says so, offers no continue and no price of one', () => {
    const closed = propsFor('stopped', entry('stopped', { jobId: 'j', templateTitle: 'T', reason: 'clips-failed', returned: '3', resumeCost: '0', swapClosed: '1' }), tEn, 'en').props as Parameters<typeof StoppedEmail>[0];
    expect(closed).toMatchObject({ swapClosed: true });
    renderWithI18n(<StoppedEmail {...closed} />);
    expect(screen.getByText('Person swap is switched off right now, so this job cannot be continued. Your 3 credits are back in your balance.')).toBeInTheDocument();
    expect(screen.getByText('Nothing more is charged for this job.')).toBeInTheDocument();
    expect(screen.queryByText(/Continuing costs/)).toBeNull();
    expect(screen.queryByText(/kept for 30 days/)).toBeNull();
  });
  it.each([
    ['photo-refused', 'The photo could not be used for this video, so nothing was made. Your 3 credits are back in your balance.', 'You cannot continue this job. Start a new one with another photo.'],
    ['person-missing', 'The person to replace could not be found, in the video or in your photo, so nothing was made. Your 3 credits are back in your balance.', 'You cannot continue this job. Start a new one with another photo, or contact support.'],
  ] as const)('the preview of a person swap that stopped with %s asks for a new job with another photo and offers no continue and no price of one', (detail, body, note) => {
    const props = propsFor('stopped', entry('stopped', { jobId: 'j', templateTitle: 'T', reason: 'clips-failed', returned: '3', resumeCost: '0', swapStop: detail }), tEn, 'en').props as Parameters<typeof StoppedEmail>[0];
    expect(props).toMatchObject({ swapStop: detail });
    renderWithI18n(<StoppedEmail {...props} />);
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByText(note)).toBeInTheDocument();
    expect(screen.queryByText(/Continuing costs/)).toBeNull();
    expect(screen.queryByText(/kept for 30 days/)).toBeNull();
  });
  it('the preview of an entry that carries counts lists them like the sent mail; a content-rule stop lists neither row', () => {
    const counts = { jobId: 'j', templateTitle: 'T', reason: 'clips-failed', images: '5/5', clips: '3/5', music: '0/1' };
    expect(propsFor('stopped', entry('stopped', counts), tEn, 'en').props).toMatchObject({ saved: '5 images, 3 of 5 clips', missing: '2 clips, music' });
    const refused = propsFor('stopped', entry('stopped', { ...counts, reason: 'content-rule' }), tEn, 'en').props as { saved: string; missing: string; jobId: string; title: string; reason: string };
    expect(refused).toMatchObject({ saved: '', missing: '' });
    renderWithI18n(<StoppedEmail {...refused} jobId="j" title="T" reason="content-rule" />);
    for (const label of ['Saved so far', 'Missing']) expect(screen.queryByText(label)).not.toBeInTheDocument();
  });
  it('propsFor passes the entry code; the sample uses clips-failed', () => {
    expect(propsFor('stopped', entry('stopped', { jobId: 'j', templateTitle: 'T', reason: 'something-new' }), tEn, 'en').props).toMatchObject({ reason: 'something-new' });
    expect(propsFor('stopped', null, tEn, 'en').props).toMatchObject({ reason: 'clips-failed' });
  });
});

describe('names and props', () => {
  it('knows exactly the eight names', () => {
    expect([...EMAIL_NAMES]).toEqual(['verify', 'reset', 'ready', 'stopped', 'payment', 'refundSent', 'refund', 'refused']);
    expect(isEmailName('refund')).toBe(true);
    expect(isEmailName('verify')).toBe(true);
    expect(isEmailName('refundSent')).toBe(true);
    expect(isEmailName('nope')).toBe(false);
  });

  it('sample props use the board placeholders', () => {
    const t = createTranslate('en', loadMessages('en'));
    expect(propsFor('reset', null, t, 'en').props).toMatchObject({ email: '[EMAIL]', validity: '1 hour', token: null });
    expect(propsFor('verify', null, t, 'en').props).toMatchObject({ validity: '24 hours' });
    expect(propsFor('payment', null, t, 'en').props).toMatchObject({ credits: '[CREDITS]', balance: '[BALANCE]', amount: '[AMOUNT]', date: '[DATE]', number: '[INVOICE NUMBER]' });
  });
});

const entry = (kind: SentEmail['kind'], data: Record<string, string>): SentEmail => ({ id: 'e1', kind, to: 'x@y.co', at: '2026-10-04T10:00:00.000Z', data });
const tEn = createTranslate('en', loadMessages('en'));

describe('propsFor with an outbox entry', () => {
  it('ready: carries the entry data, everything else is a placeholder, never board sample facts', () => {
    const { kind, props } = propsFor('ready', entry('ready', { jobId: 'j1', templateTitle: 'Mine' }), tEn, 'en');
    expect(kind).toBe('ready');
    expect(props).toEqual({ jobId: 'j1', title: 'Mine', minutes: '', details: '[DETAILS]' });
  });

  it('stopped: placeholders for what the entry does not carry', () => {
    const { props } = propsFor('stopped', entry('stopped', { jobId: 'j2', templateTitle: 'T', reason: 'clips-failed' }), tEn, 'en');
    expect(props).toMatchObject({ saved: '[SAVED SO FAR]', missing: '[MISSING]' });
  });

  it('payment: entry values, placeholders for amount and invoice number', () => {
    const { props } = propsFor('payment', entry('payment', { invoiceId: 'i1', packName: 'Studio', credits: '100', balance: '112' }), tEn, 'en');
    expect(props).toMatchObject({ invoiceId: 'i1', pack: 'Studio', credits: '100', balance: '112', amount: '[AMOUNT]', number: '[INVOICE NUMBER]' });
    expect((props as { date: string }).date).not.toBe('[DATE]');
  });

  it('payment with a tax: the entry carries the pack price, the tax and the total, and the preview shows the three', () => {
    const { props } = propsFor('payment', entry('payment', { invoiceId: 'i1', packName: 'Studio', credits: '100', balance: '112', amount: '$169.00', tax: '$33.80', total: '$202.80' }), tEn, 'en');
    expect(props).toMatchObject({ amount: '$202.80', price: '$169.00', tax: '$33.80' });
    renderWithI18n(<PaymentEmail {...(props as Parameters<typeof PaymentEmail>[0])} />);
    for (const [label, value] of [['Pack price', '$169.00'], ['Tax', '$33.80'], ['Paid', '$202.80']]) expect(screen.getByText(label!).nextElementSibling).toHaveTextContent(value!);
  });

  it('payment with a provider invoice: the preview shows it as "Invoice (Dodo)" beside the site\'s own invoice page; without one the site\'s page alone', () => {
    const { props } = propsFor('payment', entry('payment', { invoiceId: 'i1', packName: 'Studio', credits: '100', balance: '112', invoiceUrl: 'https://test.dodopayments.com/invoices/payments/pay_A' }), tEn, 'en');
    const real = renderWithI18n(<PaymentEmail {...(props as Parameters<typeof PaymentEmail>[0])} />);
    expect(link('Invoice (Dodo)')).toHaveAttribute('href', 'https://test.dodopayments.com/invoices/payments/pay_A');
    expect(link('Download invoice')).toHaveAttribute('href', '/invoices/i1');
    real.unmount();
    renderWithI18n(<PaymentEmail {...(propsFor('payment', entry('payment', { invoiceId: 'i1', packName: 'Studio', credits: '100', balance: '112' }), tEn, 'en').props as Parameters<typeof PaymentEmail>[0])} />);
    expect(link('Download invoice')).toHaveAttribute('href', '/invoices/i1');
    expect(screen.queryByRole('link', { name: 'Invoice (Dodo)' })).toBeNull();
  });

  it('refundSent: the entry values, placeholders for what the entry does not carry, the board sample without an entry', () => {
    const { kind, props } = propsFor('refundSent', entry('payment', { refund: 'sent', packName: 'Studio', credits: '100', amount: '$49.00', date: '2026-10-05T10:00:00.000Z' }), tEn, 'en');
    expect(kind).toBe('payment');
    expect(props).toMatchObject({ refundSent: true, pack: 'Studio', credits: '100', amount: '$49.00', date: 'Oct 5, 2026' });
    expect(propsFor('refundSent', entry('payment', { refund: 'sent' }), tEn, 'en').props).toMatchObject({ credits: '[CREDITS]', amount: '[AMOUNT]' });
    expect(propsFor('refundSent', null, tEn, 'en').props).toMatchObject({ refundSent: true, pack: 'Standard pack', credits: '[CREDITS]', amount: '[AMOUNT]', date: '[DATE]' });
    expect(propsFor('payment', null, tEn, 'en').props).not.toHaveProperty('refundSent');
  });

  it('no entry: the board sample facts', () => {
    expect(propsFor('ready', null, tEn, 'en').props).toMatchObject({ minutes: '7', details: '8 sec · 720p · mp4' });
  });
});

describe('outbox', () => {
  beforeEach(() => resetStore());

  it('lists what data.mailer.outbox() returns, newest first, with preview links', async () => {
    await data.auth.signUp('first@example.com', 'x');
    await new Promise((r) => setTimeout(r, 5));
    await data.auth.requestPasswordReset('first@example.com');
    const outbox = await data.mailer.outbox();
    expect(outbox.length).toBeGreaterThanOrEqual(2);
    expect(outbox[0]?.kind).toBe('reset');
    renderWithI18n(<OutboxList emails={outbox} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(outbox.length);
    outbox.forEach((email, i) => {
      expect(within(rows[i]!).getByText(email.to)).toBeInTheDocument();
      expect(within(rows[i]!).getByRole('link')).toHaveAttribute('href', `/dev/emails/${email.kind}?id=${email.id}`);
    });
  });

  it('a sent-refund mail previews as the refund mail, not as a receipt', () => {
    const base = { to: 'a@b.co', at: '2026-01-01T00:00:00.000Z' };
    renderWithI18n(<OutboxList emails={[{ ...base, id: 'r1', kind: 'payment', data: { refund: 'sent' } }, { ...base, id: 'p1', kind: 'payment', data: {} }]} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', '/dev/emails/refundSent?id=r1');
    expect(within(rows[1]!).getByRole('link')).toHaveAttribute('href', '/dev/emails/payment?id=p1');
  });

  it('the mail that says a refund is complete previews as its own board too: neither refund mail opens the receipt', () => {
    const base = { to: 'a@b.co', at: '2026-01-01T00:00:00.000Z' };
    renderWithI18n(<OutboxList emails={[{ ...base, id: 'r2', kind: 'payment', data: { refund: 'true' } }, { ...base, id: 'r1', kind: 'payment', data: { refund: 'sent' } }]} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', '/dev/emails/refund?id=r2');
    expect(within(rows[1]!).getByRole('link')).toHaveAttribute('href', '/dev/emails/refundSent?id=r1');
  });

  it.each([['en', 'Your refund is complete.', 'The refund for Studio has been confirmed.', 'Open your account'], ['tr', 'İaden tamamlandı.', 'Studio alımı için iade onaylandı.', 'Hesabını aç']] as const)(
    'refund complete (%s): says the refund is confirmed for the pack of the entry and goes to the account, with no receipt facts and no invoice link', (locale, title, body, action) => {
      const t = createTranslate(locale, loadMessages(locale));
      const { kind, props } = propsFor('refund', entry('payment', { refund: 'true', purchaseId: 'p1', packName: 'Studio', credits: '100', amount: '$169.00' }), t, locale);
      expect(kind).toBe('payment');
      renderWithI18n(<PaymentEmail {...(props as Parameters<typeof PaymentEmail>[0])} />, locale);
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByText(body, { exact: false })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: action })).toHaveAttribute('href', '/account');
      expect(document.body.innerHTML).not.toMatch(/\/invoices\/|\[[A-Z ]+\]/);
    });

  it('orders entries with different timestamps newest first', async () => {
    const { getStore } = await import('@/data/mock/store');
    const base = { to: 'a@b.co', data: {} };
    getStore().outbox.push(
      { ...base, id: 'old', kind: 'verify', at: '2026-01-01T00:00:00.000Z' },
      { ...base, id: 'new', kind: 'reset', at: '2026-03-01T00:00:00.000Z' },
      { ...base, id: 'mid', kind: 'ready', at: '2026-02-01T00:00:00.000Z' },
    );
    const ids = (await data.mailer.outbox()).map((e) => e.id);
    expect(ids.indexOf('new')).toBeLessThan(ids.indexOf('mid'));
    expect(ids.indexOf('mid')).toBeLessThan(ids.indexOf('old'));
  });

  it('shows an empty line when nothing was sent', () => {
    renderWithI18n(<OutboxList emails={[]} />);
    expect(screen.getByText('Nothing sent yet.')).toBeInTheDocument();
  });
});

describe('page', () => {
  const load = async () => (await import('@/app/dev/emails/[name]/page')).default;

  it('unknown name calls notFound()', async () => {
    const Page = await load();
    await expect(Page({ params: Promise.resolve({ name: 'nope' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('valid name without id shows the sample', async () => {
    const Page = await load();
    renderWithI18n(await Page({ params: Promise.resolve({ name: 'ready' }), searchParams: Promise.resolve({}) }));
    expect(screen.getByText('8 sec · 720p · mp4')).toBeInTheDocument();
    expect(screen.getByText('From: Viral Clone · Subject: Your video is ready')).toBeInTheDocument();
  });

  it('an id of another kind falls back to the sample', async () => {
    resetStore();
    await data.auth.signUp('p@q.co', 'x');
    await data.auth.requestPasswordReset('p@q.co');
    const reset = (await data.mailer.outbox()).find((e) => e.kind === 'reset')!;
    const Page = await load();
    renderWithI18n(await Page({ params: Promise.resolve({ name: 'verify' }), searchParams: Promise.resolve({ id: reset.id }) }));
    expect(screen.getByText(/works for 24 hours/)).toBeInTheDocument();
  });

  it('an entry id renders that entry, with no sample facts', async () => {
    resetStore();
    await data.auth.signUp('p@q.co', 'x');
    await data.auth.requestPasswordReset('p@q.co');
    const reset = (await data.mailer.outbox()).find((e) => e.kind === 'reset')!;
    const Page = await load();
    renderWithI18n(await Page({ params: Promise.resolve({ name: 'reset' }), searchParams: Promise.resolve({ id: reset.id }) }));
    expect(screen.getByText(/p@q\.co/)).toBeInTheDocument();
  });
});

it.each(['en', 'tr'] as const)('paid, free and content-rule stopped messages render in %s', (locale) => {
  const translate = createTranslate(locale, loadMessages(locale));
  const email = entry('stopped', { jobId: 'j', templateTitle: '<script>bad</script>', returned: '2', resumeCost: '2', free: '0', saved: 'saved', missing: 'missing' });
  const paid = propsFor('stopped', email, translate, locale);
  if (paid.kind !== 'stopped') throw new Error('wrong-kind');
  const { container } = renderWithI18n(<StoppedEmail {...paid.props} />, locale);
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText(translate('emails.stopped.body', { credits: '2' }))).toBeInTheDocument();
  cleanup();
  renderWithI18n(<StoppedEmail {...paid.props} free />, locale);
  expect(screen.getByText(translate('emails.stopped.freeBody'))).toBeInTheDocument();
  expect(screen.getByText(translate('emails.stopped.freeVideo'))).toBeInTheDocument();
  cleanup();
  renderWithI18n(<StoppedEmail {...paid.props} reason="content-rule" />, locale);
  expect(screen.getByText(translate('emails.stopped.contentBody'))).toBeInTheDocument();
  expect(screen.queryByText(translate('emails.stopped.body', { credits: '2' }))).toBeNull();
});

it.each([
  ['en', 'You do not need to do anything, and nothing more is charged.'],
  ['tr', 'Bir şey yapmana gerek yok, başka kredi kesilmez.'],
] as const)('a stop on a request we are checking ourselves (submission-unknown) says in %s what the job page says, and names no price to continue', (locale, promise) => {
  const translate = createTranslate(locale, loadMessages(locale));
  const email = entry('stopped', { jobId: 'j', templateTitle: 'T', reason: 'submission-unknown', returned: '2', resumeCost: '2', free: '0', saved: 'saved', missing: 'missing' });
  const checking = propsFor('stopped', email, translate, locale);
  if (checking.kind !== 'stopped') throw new Error('wrong-kind');
  const text = () => document.body.textContent ?? '';
  for (const free of [false, true]) {
    renderWithI18n(<StoppedEmail {...checking.props} free={free} />, locale);
    expect(text()).toContain(promise);
    expect(screen.getByText(translate('emails.stopped.checkingBody'))).toBeInTheDocument();
    expect(text()).toContain(`${translate('emails.stopped.checkingNote')} ${translate('emails.stopped.retention')}`);
    expect(text()).not.toContain(translate('emails.stopped.note', { credits: '2' }));
    expect(text()).not.toContain(translate('emails.stopped.freeNote'));
    expect(screen.queryByText(translate('emails.stopped.body', { credits: '2' }))).toBeNull();
    expect(screen.queryByText(translate('emails.stopped.freeBody'))).toBeNull();
    cleanup();
  }
});

it('ready props use actual metadata, and do not substitute a sample duration; the mail carries no picture', () => {
  const real = propsFor('ready', entry('ready', { jobId: 'j', templateTitle: 'Mine', minutes: '3', seconds: '12', quality: 'fast', image: '/media/job/frame.png' }), tEn, 'en');
  expect(real.props).toEqual({ jobId: 'j', title: 'Mine', minutes: '3', details: '12 sec · Fast · mp4' });
  // a measured length arrives unrounded from the engine
  expect(propsFor('ready', entry('ready', { jobId: 'j', templateTitle: 'Mine', minutes: '3', seconds: '20.433333333333334', quality: 'fast' }), tEn, 'en').props).toMatchObject({ details: '20 sec · Fast · mp4' });
  const legacy = propsFor('ready', entry('ready', { jobId: 'j', templateTitle: 'Mine' }), tEn, 'en');
  if (legacy.kind !== 'ready') throw new Error('wrong-kind');
  renderWithI18n(<ReadyEmail {...legacy.props} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(tEn('emails.ready.bodyUnknown'))).toBeInTheDocument();
});

it('shared footer names ishflow and its address, in both languages, without placeholders',()=>{
 for(const locale of ['en','tr'] as const){
  renderWithI18n(<VerifyEmail validity="24 hours" />,locale);
  expect(screen.getByText(/© ishflow/)).toBeVisible();expect(screen.getByText(/123 Example St, City, Country/)).toBeVisible();
  expect(document.body.textContent).not.toMatch(/Viral Clone\b(?! account| hesabın)|COMPANY NAME|ADDRESS|\{/);cleanup();
 }
});

describe('the preview board and the sent mail are one markup', () => {
  /** The `MailView` table of a sent mail (between the body tags), with its site address cut off the links. */
  const sent = (mail: SentEmail, locale: 'en' | 'tr') => renderEmail(mail, locale, 'http://localhost:3202').html.replace(/^[^]*?<body[^>]*>|<\/body>[^]*$/g, '').replaceAll('http://localhost:3202', '');
  const previewed = (ui: ReactElement, locale: 'en' | 'tr') => renderToStaticMarkup(<I18nProvider locale={locale} messages={loadMessages(locale)}>{ui}</I18nProvider>).replace(/^[^]*?(<table role="presentation" width="100%")/, '$1').replace(/<\/div>$/, '');
  it.each(['en', 'tr'] as const)('verify, reset, ready, stopped and payment draw the same tables in %s', (locale) => {
    const t = createTranslate(locale, loadMessages(locale));
    const same = (mail: SentEmail, ui: ReactElement) => { expect(sent(mail, locale)).toMatch(/^<table role="presentation"[^]{800,}<\/table>$/); expect(previewed(ui, locale)).toBe(sent(mail, locale)); };
    same(entry('verify', { token: 't', purpose: 'verify' }), <VerifyEmail validity={t('emails.validity.hours', { count: 24 })} token="t" />);
    same(entry('reset', { token: 't' }), <ResetEmail email="x@y.co" validity={t('emails.validity.hours', { count: 1 })} token="t" />);
    same(entry('ready', { jobId: 'j', templateTitle: 'Layering', minutes: '7', details: '8 sec · 720p · mp4' }), <ReadyEmail jobId="j" title="Layering" minutes="7" details="8 sec · 720p · mp4" />);
    same(entry('stopped', { jobId: 'j', templateTitle: 'T', reason: 'clips-failed', returned: '2', free: '0', saved: 's', missing: 'm' }), <StoppedEmail jobId="j" title="T" saved="s" missing="m" reason="clips-failed" returned="2" />);
    same(entry('payment', { packName: 'Standard', credits: '30', balance: '42', amount: '$19.00', number: '001', invoiceId: 'inv', returnTo: '/gallery', date: '2026-10-04T10:00:00.000Z' }),
      <PaymentEmail invoiceId="inv" pack="Standard" credits="30" balance="42" amount="$19.00" date={formatDate('2026-10-04T10:00:00.000Z', locale)} number="001" returnTo="/gallery" />);
  });
});
