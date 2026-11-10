import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
const router = { refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { BalanceNow, ShownBalance } from './HeaderBalance';

beforeEach(() => refresh.mockReset());
afterEach(cleanup);

describe('BalanceNow', () => {
  it('refreshes the route once when the page read a balance the header does not show', () => {
    const view = render(<ShownBalance label="17 credits"><BalanceNow label="19 credits" /></ShownBalance>);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The same page again (the job page asks every 2 seconds while a job runs): nothing new to catch up with.
    view.rerender(<ShownBalance label="17 credits"><BalanceNow label="19 credits" /></ShownBalance>);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stays quiet once the header has caught up', () => {
    const view = render(<ShownBalance label="17 credits"><BalanceNow label="19 credits" /></ShownBalance>);
    view.rerender(<ShownBalance label="19 credits"><BalanceNow label="19 credits" /></ShownBalance>);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the header shows the balance the page read', () => {
    render(<ShownBalance label="19 credits"><BalanceNow label="19 credits" /></ShownBalance>);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a later change is caught up with too', () => {
    const view = render(<ShownBalance label="19 credits"><BalanceNow label="19 credits" /></ShownBalance>);
    view.rerender(<ShownBalance label="19 credits"><BalanceNow label="21 credits" /></ShownBalance>);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a page without a customer header around it', () => {
    render(<BalanceNow label="19 credits" />);
    expect(refresh).not.toHaveBeenCalled();
  });
});
