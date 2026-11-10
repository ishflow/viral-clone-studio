export type FieldName = 'email' | 'password' | 'repeat';
export type FieldCode = 'invalid-email' | 'email-taken' | 'password-short' | 'required' | 'mismatch';

/** What the auth actions hand back to `useActionState`: codes, not text (the client translates them). */
export type AuthState = {
  fieldErrors?: Partial<Record<FieldName, FieldCode>>;
  form?: 'credentials' | 'demo-deleted' | 'rate-limited' | 'unavailable' | 'locked' | 'google-cancelled' | 'google-failed' | 'invite-only';
  email?: string;
  sent?: boolean;
  /** Seconds until the next resend (or the end of a lock) is possible. */
  retryAfter?: number;
  /** Client clock (ms) when `retryAfter` was received: the countdown runs from it. */
  at?: number;
} | null;
