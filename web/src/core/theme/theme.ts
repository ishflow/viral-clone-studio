export const THEME_COOKIE = 'vc_theme';
export type ThemeChoice = 'system' | 'dark' | 'light';

export function readTheme(value: string | undefined): ThemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system';
}
