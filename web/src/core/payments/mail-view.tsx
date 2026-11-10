import type { ReactNode } from 'react';

/**
 * The look of every email, drawn once for the sent mail and for the preview board.
 * Mail clients keep only inline styles and tables, so everything below is both; the one `<style>` text
 * (`MAIL_CSS`) only tightens the paddings and stretches the button on a phone, and the mail reads right without it.
 * Values are the light canvas design (`docs/design/tuval/project/E-*.dc.html`): the fonts are system stacks because no remote font is loaded.
 */
const C = { ground: '#F4F5EE', card: '#FFFFFF', line: '#E0E2D7', text: '#0B0C0A', text2: '#3E4236', text3: '#5A5F50', accent: '#C8F03C', onAccent: '#0B0C0A', link: '#456300', warn: '#A8400F' } as const;
const DISPLAY = "'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif";
const BODY = "Onest,'Helvetica Neue',Helvetica,Arial,sans-serif";
const RESET = { borderCollapse: 'collapse', msoTableLspace: '0pt', msoTableRspace: '0pt' } as const;

export type MailLink = { label: string; href: string };
export type MailFact = [label: string, value: string];
/** What one email says, already in its language and with absolute or site-relative addresses. */
export interface MailContent {
  status?: { label: string; tone: 'done' | 'warn' };
  title: string;
  body: string;
  /** The box of the finished video: its template and its details. */
  summary?: { title: string; details: string };
  facts?: MailFact[];
  action: MailLink;
  /** Quiet links under the button, one per line. */
  secondary?: MailLink[];
  note: string;
  home: string;
  footer: { intro: string; contact: MailLink; company: string };
}

/** Phone-only tightening, as an enhancement: the inline values are the desktop design. */
export const MAIL_CSS = '@media only screen and (max-width:599px){.mail-ground{padding:16px !important}.mail-card{padding:24px !important}.mail-foot{padding:16px 24px 0 !important}.mail-btn{width:100% !important}.mail-btn a{display:block !important;text-align:center !important}.mail-link{display:block !important}}';

/** The `bgcolor` attribute: Outlook and clients that darken a mail read it where they skip the style. */
const bg = (color: string) => ({ bgcolor: color });
const table = (extra: object = {}) => ({ ...RESET, ...extra });
/** A row of the card: 24 px of air above it, as the design's gap. */
function Block({ children, gap = 24 }: { children: ReactNode; gap?: number }) {
  return <tr><td style={{ paddingTop: gap }}>{children}</td></tr>;
}

function Logo({ href }: { href: string }) {
  const box = { width: 5, height: 14, fontSize: 0, lineHeight: 0, borderRadius: 3 } as const;
  return (
    <a href={href} aria-label="viral clone" style={{ display: 'inline-block', textDecoration: 'none', color: C.text }}>
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={table()}>
        <tbody><tr>
          <td valign="bottom" aria-hidden="true" style={{ paddingRight: 8 }}>
            <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={table()}>
              <tbody><tr>
                <td style={{ ...box, border: `2px solid ${C.text}` }}>&nbsp;</td>
                <td style={{ width: 4, fontSize: 0, lineHeight: 0 }}>&nbsp;</td>
                <td {...bg(C.accent)} style={{ ...box, background: C.accent, border: `2px solid ${C.text}` }}>&nbsp;</td>
              </tr></tbody>
            </table>
          </td>
          <td valign="bottom" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, lineHeight: '24px', letterSpacing: '-0.04em', color: C.text }}>viral clone</td>
        </tr></tbody>
      </table>
    </a>
  );
}

function Status({ label, tone }: { label: string; tone: 'done' | 'warn' }) {
  const color = tone === 'warn' ? C.warn : C.link;
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={table()}>
      <tbody><tr>
        <td valign="middle" style={{ paddingRight: 8, paddingBottom: 12, fontSize: 15, lineHeight: '20px', fontWeight: 700, color }}>
          {tone === 'warn'
            ? <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={table()}><tbody><tr><td {...bg(C.warn)} style={{ width: 8, height: 8, fontSize: 0, lineHeight: 0, background: C.warn, borderRadius: 2 }}>&nbsp;</td></tr></tbody></table>
            : <span aria-hidden="true">&#10003;</span>}
        </td>
        <td valign="middle" style={{ paddingBottom: 12, fontFamily: BODY, fontSize: 15, lineHeight: '20px', fontWeight: 600, color }}>{label}</td>
      </tr></tbody>
    </table>
  );
}

function Facts({ rows }: { rows: MailFact[] }) {
  const cell = { padding: '12px 0', borderTop: `1px solid ${C.line}`, fontFamily: BODY, fontSize: 15, lineHeight: '21px', verticalAlign: 'top' } as const;
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={table({ width: '100%', borderBottom: `1px solid ${C.line}` })}>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td style={{ ...cell, color: C.text2, paddingRight: 16 }}>{label}</td>
            <td align="right" style={{ ...cell, color: C.text, fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The whole mail as one table: light ground, card of at most 600 px, footer under the card. */
export function MailView({ mail }: { mail: MailContent }) {
  const { status, title, body, summary, facts, action, secondary, note, home, footer } = mail;
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} bgcolor={C.ground} style={table({ width: '100%', background: C.ground })}>
      <tbody><tr>
        <td align="center" className="mail-ground" {...bg(C.ground)} style={{ padding: 32, background: C.ground }}>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={table({ width: '100%', maxWidth: 600, borderCollapse: 'separate' })}>
            <tbody>
              <tr>
                <td align="left" className="mail-card" {...bg(C.card)} style={{ padding: 32, background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, textAlign: 'left' }}>
                  <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={table({ width: '100%' })}>
                    <tbody>
                      <tr><td><Logo href={home} /></td></tr>
                      <Block>
                        {status && <Status {...status} />}
                        <h1 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, lineHeight: '35px', letterSpacing: '-0.02em', color: C.text }}>{title}</h1>
                        <p style={{ margin: 0, paddingTop: 12, fontFamily: BODY, fontSize: 17, lineHeight: '25px', color: C.text2, overflowWrap: 'anywhere' }}>{body}</p>
                      </Block>
                      {summary && (
                        <Block>
                          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} bgcolor={C.ground} style={table({ width: '100%', background: C.ground, borderRadius: 12 })}>
                            <tbody><tr><td style={{ padding: 16, fontFamily: BODY }}>
                              <p style={{ margin: 0, fontSize: 17, lineHeight: '24px', fontWeight: 600, color: C.text, overflowWrap: 'anywhere' }}>{summary.title}</p>
                              <p style={{ margin: 0, paddingTop: 4, fontSize: 13, lineHeight: '18px', color: C.text3 }}>{summary.details}</p>
                            </td></tr></tbody>
                          </table>
                        </Block>
                      )}
                      {facts && facts.length > 0 && <Block><Facts rows={facts} /></Block>}
                      <Block>
                        <table role="presentation" cellPadding={0} cellSpacing={0} border={0} className="mail-btn" style={table()}>
                          <tbody><tr>
                            <td {...bg(C.accent)} style={{ background: C.accent, borderRadius: 12 }}>
                              <a href={action.href} style={{ display: 'inline-block', padding: '0 24px', fontFamily: BODY, fontSize: 15, lineHeight: '52px', fontWeight: 600, color: C.onAccent, textDecoration: 'none' }}>{action.label}</a>
                            </td>
                          </tr></tbody>
                        </table>
                        {secondary?.map((link, i) => {
                          const a = <a key={link.href} href={link.href} className="mail-link" style={{ display: 'inline-block', paddingTop: 8, fontFamily: BODY, fontSize: 15, lineHeight: '36px', fontWeight: 600, color: C.link, textDecoration: 'none' }}>{link.label}</a>;
                          return i < secondary.length - 1 ? <p key={link.href} style={{ margin: 0 }}>{a}</p> : a;
                        })}
                      </Block>
                      <Block><p style={{ margin: 0, fontFamily: BODY, fontSize: 13, lineHeight: '18px', color: C.text3 }}>{note}</p></Block>
                    </tbody>
                  </table>
                </td>
              </tr>
              <tr>
                <td className="mail-foot" style={{ padding: '16px 32px 0', fontFamily: BODY, fontSize: 13, lineHeight: '18px', color: C.text3 }}>
                  {footer.intro}{' '}
                  <a href={footer.contact.href} style={{ fontWeight: 600, color: C.link, textDecoration: 'none' }}>{footer.contact.label}</a>.<br />
                  {footer.company}
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr></tbody>
    </table>
  );
}

/** The `<head>` of the sent mail: charset, phone width, light only (a client that darkens it anyway finds every colour set on its own element), the phone CSS. */
export function MailHead({ title }: { title: string }) {
  return (
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light" />
      <meta name="supported-color-schemes" content="light" />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: `:root{color-scheme:light only}${MAIL_CSS}` }} />
    </head>
  );
}

/** Page background colour, for the body of the sent mail. */
export const MAIL_GROUND = C.ground;
