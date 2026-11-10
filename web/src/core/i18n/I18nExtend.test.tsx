import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nExtend, I18nProvider, useLocale, useT } from './I18nProvider';

afterEach(cleanup);

function Show() {
  const t = useT();
  return <p>{`${useLocale()}: ${t('common.a')} ${t('account.b')} ${t('common.c')}`}</p>;
}

describe('I18nExtend', () => {
  it('adds its messages to the ones of the provider above, keeps the language, and its own text wins for a key both have', () => {
    render(
      <I18nProvider locale="tr" messages={{ 'common.a': 'A', 'common.c': 'C-above' }}>
        <I18nExtend messages={{ 'account.b': 'B', 'common.c': 'C-below' }}>
          <Show />
        </I18nExtend>
      </I18nProvider>,
    );
    expect(screen.getByText('tr: A B C-below')).toBeInTheDocument();
  });

  it('leaves the provider above as it was for what is outside it', () => {
    render(
      <I18nProvider locale="en" messages={{ 'common.a': 'A' }}>
        <I18nExtend messages={{ 'account.b': 'B' }}><p>inside</p></I18nExtend>
        <Show />
      </I18nProvider>,
    );
    expect(screen.getByText('en: A account.b common.c')).toBeInTheDocument();
  });
});
