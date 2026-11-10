import type { ReactNode } from 'react';
import { FullMessages } from '@/core/i18n/FullMessages';
import { devOnly } from './dev-only';

/**
 * Everything under `/dev` is a development aid: the UI kit, the shells, the email previews with the mail outbox (verification and
 * reset links). In a production build none of it exists. Each page repeats the check before it reads anything (see `devOnly`).
 * (`/dev/reset` is a route handler: no layout wraps it, it has its own check.)
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  devOnly();
  return <FullMessages>{children}</FullMessages>;
}
