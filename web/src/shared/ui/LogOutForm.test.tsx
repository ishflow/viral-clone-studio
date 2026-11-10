import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDraft, writeDraft } from '@/shared/lib/session-draft';
import { LogOutForm } from './LogOutForm';
import { renderWithI18n } from './test-utils';

const logOut = vi.fn();
vi.mock('@/core/session/actions', () => ({ logOut: () => logOut() }));

afterEach(() => {
  cleanup();
  logOut.mockClear();
  window.sessionStorage.clear();
});

describe('LogOutForm', () => {
  it('logs out and clears every form this tab kept, for any person', async () => {
    writeDraft('vc:draft:generate:usr-demo:tpl-a', { products: [] });
    writeDraft('vc:draft:add-video:usr-demo', { link: 'x' });
    renderWithI18n(
      <LogOutForm>
        <button type="submit">Out</button>
      </LogOutForm>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Out' }));
    expect(logOut).toHaveBeenCalledTimes(1);
    expect(readDraft('vc:draft:generate:usr-demo:tpl-a')).toBeNull();
    expect(readDraft('vc:draft:add-video:usr-demo')).toBeNull();
  });
});
