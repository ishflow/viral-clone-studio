import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// The two screens that link to the pages of person swap: here only what the page tells them of the switch.
vi.mock('./StoppedView', () => ({ StoppedView: (props: { swapOpen?: boolean }) => <div>stopped, person swap open: {String(props.swapOpen)}</div> }));
vi.mock('./ClosedView', () => ({ ClosedView: (props: { swapOpen?: boolean }) => <div>closed, person swap open: {String(props.swapOpen)}</div> }));
const user = { id: 'u1', freeVideoAvailable: false };
const loadJob = vi.fn();
vi.mock('./load', () => ({ loadJob: (...a: unknown[]) => loadJob(...a) }));
vi.mock('@/data', () => ({ data: { auth: { getUser: async () => user }, jobs: { resumeQuote: async () => ({}) }, ledger: { balance: async () => 19 } } }));
const personSwapOpen = vi.fn();
vi.mock('@/core/person-swap', () => ({ personSwapOpen: () => personSwapOpen() }));
vi.mock('@/core/session/balance', () => ({ getBalanceLabel: async () => '19 credits' }));
vi.mock('@/core/i18n/server', () => ({ getI18n: async () => ({ t: (k: string) => k }) }));

import { JobView } from './JobView';

const job = (status: 'stopped' | 'closed') => ({ user, job: { id: 'j1', status, templateId: 'tpl-swap', templateTitle: 'T', variants: [], steps: [] }, template: null });

beforeEach(() => personSwapOpen.mockReset());
afterEach(cleanup);

describe('the page of a job tells its screen whether person swap is open', () => {
  it.each(['stopped', 'closed'] as const)('a %s job, the switch off and then on', async (status) => {
    loadJob.mockResolvedValue(job(status));
    personSwapOpen.mockResolvedValue(false);
    render(await JobView({ id: 'j1' }));
    expect(screen.getByText(`${status}, person swap open: false`)).toBeInTheDocument();
    cleanup();
    personSwapOpen.mockResolvedValue(true);
    render(await JobView({ id: 'j1' }));
    expect(screen.getByText(`${status}, person swap open: true`)).toBeInTheDocument();
  });
});
