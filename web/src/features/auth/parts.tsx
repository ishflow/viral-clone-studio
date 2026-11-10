import type { ReactNode } from 'react';
import { PASSWORD_MIN_LENGTH } from '@/core/config';
import type { Translate } from '@/core/i18n/types';
import type { FieldCode } from './types';

/** Heading of every auth screen (board: 32 px, line 1.1, -0.02em). */
export function AuthTitle({ children }: { children: ReactNode }) {
  return <h1 className="m-0 font-display text-32 leading-[1.1] font-extrabold tracking-[-0.02em]">{children}</h1>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 text-15 leading-normal text-text-2 text-pretty">{children}</p>;
}

const MARK = '\u0001';

/** `auth.verify.text` and friends hold `{email}`; the address is shown in bold without putting markup in the messages. */
export function withStrongEmail(t: Translate, key: string, email: string, params: Record<string, string | number> = {}): ReactNode {
  const [before, after = ''] = t(key, { ...params, email: MARK }).split(MARK);
  return (
    <>
      {before}
      <strong className="font-semibold break-all text-text">{email}</strong>
      {after}
    </>
  );
}

const ERROR_KEYS: Record<FieldCode, string> = {
  'invalid-email': 'auth.error.invalidEmail',
  'email-taken': 'auth.error.emailTaken',
  'password-short': 'auth.error.passwordShort',
  required: 'auth.error.passwordRequired',
  mismatch: 'auth.error.mismatch',
};

export function errorText(t: Translate, code: FieldCode | undefined): string | undefined {
  return code ? t(ERROR_KEYS[code], { min: PASSWORD_MIN_LENGTH }) : undefined;
}
