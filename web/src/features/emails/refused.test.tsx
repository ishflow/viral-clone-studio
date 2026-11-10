// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/core/i18n/messages';
import { createTranslate } from '@/core/i18n/translate';
import { renderEmail } from '@/core/payments/email';
import { FakeMailer } from '@/data/real/payments-outbox';
import type { SentEmail } from '@/data/ports';
import { EMAIL_NAMES, emailNameOf, propsFor } from './build';

// The mail of a person swap that was not approved (an admin said no, or nobody answered in 48 hours), as the sender's path renders it.
// The sender here is the fake one: nothing leaves the machine.

const mail: SentEmail = {
  id: 'mail-1', kind: 'refused', to: 'demo@viralclone.app', at: '2026-10-07T12:00:00.000Z',
  data: { jobId: 'job-9', templateTitle: 'Walk to the camera', returned: '3', returnTo: '/jobs/job-9' },
};
const BASE = 'https://viralclone.test';

describe('the mail of a person swap that was not approved', () => {
  it('says in English that it was not approved, that the credits are back and that the photos were deleted, and links to the job', async () => {
    let sent = { subject: '', html: '', text: '' };
    const receipt = await new FakeMailer((item) => (sent = renderEmail(item, 'en', BASE))).send(mail, mail.id);
    expect(receipt).toEqual({ id: 'fake:mail-1' });
    expect(sent.subject).toBe('Your person swap was not approved');
    expect(sent.text).toContain('was not approved');
    expect(sent.text).toContain('Your 3 credits are back in your balance.');
    expect(sent.text).toContain('Your photos were deleted.');
    expect(sent.text).toContain('Open the job: https://viralclone.test/jobs/job-9');
    expect(sent.html).toContain('href="https://viralclone.test/jobs/job-9"');
    expect(`${sent.subject}${sent.text}${sent.html}`).not.toMatch(/emails\.refused|\{credits\}/);
  });

  it('says the same in Turkish', () => {
    const sent = renderEmail(mail, 'tr', BASE);
    expect(sent.subject).toBe('Kişi değiştirme isteğin onaylanmadı');
    expect(sent.text).toContain('3 kredin bakiyene geri döndü.');
    expect(sent.text).toContain('Fotoğrafların silindi.');
    expect(sent.text).toContain('İşi aç: https://viralclone.test/jobs/job-9');
    expect(`${sent.subject}${sent.text}`).not.toMatch(/emails\.refused|\{credits\}/);
  });

  it('has its board in the preview of the mails, built from the entry of the outbox', () => {
    expect(EMAIL_NAMES).toContain('refused');
    expect(emailNameOf(mail)).toBe('refused');
    const t = createTranslate('en', loadMessages('en'));
    expect(propsFor('refused', mail, t, 'en')).toEqual({ kind: 'refused', props: { jobId: 'job-9', title: 'Walk to the camera', returned: '3' } });
    expect(propsFor('refused', null, t, 'en')).toMatchObject({ kind: 'refused', props: { jobId: 'sample', returned: '3' } });
  });
});
