import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@/core/config';
import { Email, withEmail } from './Email';
import { exposedAddresses } from './test-utils';

const ADDRESS = BUSINESS.supportEmail;

describe('Email', () => {
  it('prints the address between the comments Cloudflare leaves alone', () => {
    const html = renderToStaticMarkup(<Email address={ADDRESS} />);
    expect(html).toContain(`<!--email_off-->${ADDRESS}<!--/email_off-->`);
    expect(exposedAddresses(html, ADDRESS)).toBe(0);
  });

  it('as a link keeps the whole anchor, href included, inside the comments', () => {
    const html = renderToStaticMarkup(<Email address={ADDRESS} link className="font-semibold" />);
    expect(html).toContain(`<!--email_off--><a href="mailto:${ADDRESS}" class="font-semibold">${ADDRESS}</a><!--/email_off-->`);
    expect(exposedAddresses(html, ADDRESS)).toBe(0);
  });

  it('escapes what it prints as HTML', () => {
    const html = renderToStaticMarkup(<Email address={'a"<b>&@x.com'} link />);
    expect(html).toContain('href="mailto:a&quot;&lt;b&gt;&amp;@x.com"');
    expect(html).not.toContain('<b>');
  });
});

describe('withEmail', () => {
  it('leaves a text without the support address as it is', () => {
    expect(withEmail('Nothing to hide here.')).toBe('Nothing to hide here.');
  });

  it('puts every support address of a text inside the comments and keeps the words around it', () => {
    const html = renderToStaticMarkup(<p>{withEmail(`Write to ${ADDRESS}. Or to ${ADDRESS}!`)}</p>);
    expect(html.replace(/<!--\/?email_off-->|<\/?span[^>]*>/g, '')).toBe(`<p>Write to ${ADDRESS}. Or to ${ADDRESS}!</p>`);
    expect(html.match(/<!--email_off-->/g)).toHaveLength(2);
    expect(exposedAddresses(html, ADDRESS)).toBe(0);
  });
});
