import { data } from '../index';
import type { GenerateInput, Id, Job } from '../ports';
import { fixtureStore, getStore, now, openingEntries } from './store';
import type { JobRecord } from './store';

/** The moment the tests of the fakes freeze the clock at. */
export const START = new Date('2026-10-04T12:00:00Z');

/**
 * The time limit of a test that checks dozens of passwords (every sign-up and every log-in is one scrypt hash, tens of milliseconds on a quiet machine).
 * The limit is only there to stop a hang: on a machine with a load of 100 such a test takes ten times as long as on a quiet one, and a test that
 * runs past its limit goes on in the background and breaks the tests after it.
 */
export const SLOW_HASHING = { timeout: 60_000 };

/** A valid form input for a template: one product, fast, 1 variant. */
export function generateInput(templateId: string, over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    templateId,
    products: [{ name: 'Test product', description: '', images: ['/samples/f20a7ed7a7bc172a7da483415800077f.jpg'] }],
    quality: 'fast',
    variants: 1,
    language: 'en',
    ...over,
  };
}

/** The record the store keeps for a job, with the fields only the runner knows. */
export function storedJob(id: string): JobRecord {
  const job = getStore().jobs.find((item) => item.id === id);
  if (!job) throw new Error(`no stored job: ${id}`);
  return job;
}

/** Start a job the way the site does: the estimate of now is the confirmed one. */
export async function startConfirmed(userId: Id, input: GenerateInput, idempotencyKey: string): Promise<Job> {
  return data.jobs.start(userId, input, idempotencyKey, await data.jobs.estimate(userId, input));
}

/** Resume a job the way the site does: the cost of now is the confirmed one. */
export async function resumeConfirmed(id: Id, viewerId: Id): Promise<Job> {
  return data.jobs.resume(id, viewerId, await data.jobs.resumeCost(id, viewerId));
}

/**
 * The demo customers of the fake mode, added to a store of the real engine (`VC_ENGINE=sqlite`), which seeds only the administrator.
 * For tests that need a customer with a balance next to the real engine; without `VC_DEV_PASSWORD` they cannot log in.
 */
export function addDemoCustomers(): void {
  const fixtures = fixtureStore();
  const store = getStore();
  const customers = fixtures.users.filter((user) => user.role !== 'admin');
  store.users.push(...customers);
  store.credentials.push(...fixtures.credentials.filter((credential) => customers.some((user) => user.id === credential.userId)));
  store.ledger.push(...openingEntries(customers, fixtures.ledger, now().toISOString()));
}
