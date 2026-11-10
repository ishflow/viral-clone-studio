import { z } from 'zod';
import { LOCALES, type Locale } from '@/core/i18n/types';
import { readTheme, type ThemeChoice } from '@/core/theme/theme';

export type ProfileErrorCode = 'nameLong' | 'emailInvalid' | 'emailTaken' | 'failed';
export const NAME_MAX = 80;
export const DELETE_WORD = 'DELETE';

const profile = z.object({
  name: z.string().trim().max(NAME_MAX, 'nameLong'),
  email: z.string().trim().pipe(z.email('emailInvalid')),
});

/** A new address is at most 254 characters and its part before the `@` at most 64 (RFC 5321). The address the account already has is not asked again. */
export const emailLengthOk = (email: string): boolean => email.length <= 254 && email.lastIndexOf('@') <= 64;

export type ProfileInput = { name: string; email: string; locale: Locale; theme: ThemeChoice };
export type ProfileParse = { ok: true; value: ProfileInput } | { ok: false; errors: Partial<Record<'name' | 'email', ProfileErrorCode>> };

/** Reads the profile form. Messages of the schema are error codes the page translates. */
export function parseProfile(form: FormData): ProfileParse {
  const text = (key: string) => String(form.get(key) ?? '');
  const parsed = profile.safeParse({ name: text('name'), email: text('email') });
  if (!parsed.success) {
    const errors: Partial<Record<'name' | 'email', ProfileErrorCode>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] === 'name' ? 'name' : 'email';
      errors[field] ??= issue.message as ProfileErrorCode;
    }
    return { ok: false, errors };
  }
  const locale = LOCALES.find((l) => l === text('locale')) ?? 'en';
  return { ok: true, value: { ...parsed.data, locale, theme: readTheme(text('theme')) } };
}
