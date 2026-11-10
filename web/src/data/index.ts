import { ownerTestConfig } from '@/core/paid-mode';
import { engine } from './engine';
import { admin } from './mock/admin';
import { auth } from './mock/auth';
import { catalog } from './mock/catalog';
import { drafts } from './mock/drafts';
import { invoices } from './mock/invoices';
import { jobs } from './mock/jobs';
import { ledger } from './mock/ledger';
import { mailer } from './mock/mailer';
import { payments } from './mock/payments';
import { assertSiteOwner } from './real/site-lock';
import { dataDir, persistent, saveStore } from './mock/persist';
import { getStore } from './mock/store';
import { support } from './mock/support';
import { swap } from './mock/swap';
import type { SwapPort } from './mock/swap';
import { uploads } from './mock/uploads';
import type {
  AdminQueries, AuthService, CreditLedger, Drafts, InvoiceStore, JobRunner, Mailer, PaymentGateway, SupportDesk, TemplateCatalog, Uploads,
} from './ports';
import { paymentPipelineEnabled, paymentConfig } from '@/core/payments/config';
import { paymentsGateway } from './real/payments-gateway';
import { sendRefund } from './real/payments-gateway';
import { sweepSwapPhotos } from './real/swap-photos';
import { diskUploads } from './real/uploads';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Tells the engine that the store is on disk: the runs handed over so far may start.
 * When the engine cannot be told, the call that was just saved keeps its own result: the runs stay held, and the next time this works releases them.
 */
function release(): void {
  try {
    engine().committed();
  } catch (error) {
    console.error(`engine-commit-failed: ${messageOf(error)}`);
  }
}

/**
 * After a call that worked: the store is written, then the engine is told. A write that throws fails the call
 * (nobody is told a charge succeeded when it is not on disk), and the engine is not told.
 */
function afterSuccess<V>(value: V): V {
  saveStore(getStore());
  release();
  return value;
}

/**
 * After a call that failed: what it changed on the way is written too, and the caller always gets the error of the call.
 * A write that throws here is logged, and the engine is not told.
 */
function afterFailure(error: unknown): never {
  try {
    saveStore(getStore());
  } catch (failure) {
    console.error(`site-store-not-saved: ${messageOf(failure)}`);
    throw error;
  }
  release();
  throw error;
}

/**
 * Next to the real production system the store is written to disk after every call of a port, also one that failed
 * (see mock/persist.ts). In fake mode a call goes straight through: nothing is written and the engine is told nothing.
 */
function kept<T extends object>(port: T): T {
  const methods = Object.entries(port).map(([name, method]: [string, (...args: unknown[]) => Promise<unknown>]) => [
    name,
    async (...args: unknown[]) => {
      if (persistent()) assertSiteOwner(dataDir()); // ownership before any side effect
      const answer = method.apply(port, args);
      return persistent() ? answer.then(afterSuccess, afterFailure) : answer;
    },
  ]);
  return Object.fromEntries(methods) as T;
}

/**
 * The one place that picks the implementations. The site's own records (users, credits, purchases, invoices, emails, job records)
 * are the in-memory ones of `mock/`; what the production system knows comes from `engine()` (`./engine`): the fake, or the real one
 * with `VC_ENGINE=sqlite`. The engine is not exported here: a feature reaches it through a port of `data`.
 */
export const data: {
  auth: AuthService; catalog: TemplateCatalog; ledger: CreditLedger; jobs: JobRunner;
  payments: PaymentGateway; invoices: InvoiceStore; mailer: Mailer; admin: AdminQueries; uploads: Uploads;
  drafts: Drafts; support: SupportDesk; swap: SwapPort;
} = {
  // An account that is deleted takes its jobs with it: the photographs of its person swaps are deleted from the disk at once.
  auth: kept({ ...auth, async deleteAccount(id: string) {
    await auth.deleteAccount(id);
    sweepSwapPhotos();
  } }), catalog: kept(catalog), ledger: kept(ledger), jobs: kept(jobs),
  payments: kept(Object.fromEntries(Object.keys(payments).map(name => [name, (...args: unknown[]) => {
    if (process.env.VC_PROVIDER === 'magnific' && (paymentPipelineEnabled() || !ownerTestConfig(process.env)) && !['packs', 'rates', 'getCheckout', 'purchasesFor'].includes(name)) paymentConfig();
    const port = paymentPipelineEnabled() ? paymentsGateway : payments;
    return (port[name as keyof PaymentGateway] as (...values: unknown[]) => Promise<unknown>)(...args);
  }])) as unknown as PaymentGateway), invoices: kept(invoices), mailer: kept(mailer), admin: kept({ ...admin, async refund(purchaseId: string) {
    if (paymentPipelineEnabled() || process.env.VC_PROVIDER === 'magnific') throw new Error('refund-request-required');
    return admin.refund(purchaseId);
  }, async refundPurchase(adminId: string, purchaseId: string, reason: string, key: string) {
    if (process.env.VC_PROVIDER === 'magnific' && (paymentPipelineEnabled() || !ownerTestConfig(process.env))) paymentConfig();
    return paymentPipelineEnabled() ? sendRefund(adminId, purchaseId, reason, key) : admin.refundPurchase(adminId, purchaseId, reason, key);
  } }),
  drafts: kept(drafts), support: kept(support), swap: kept(swap),
  // The uploads write no record of the store. Which one is used is decided on every call, like `engine()`.
  uploads: { saveVideo: (userId, file) => diskUploads.saveVideo!(userId, file), save: (userId, file, kind) => (persistent() ? diskUploads : uploads).save(userId, file, kind) },
};
