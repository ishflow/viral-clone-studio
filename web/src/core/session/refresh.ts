import { revalidatePath } from 'next/cache';

/**
 * Call at the end of every server action that changes the balance, the session, the locale or the theme.
 * Layouts are cached by the client router; this makes the header (balance chip, language, theme) re-render.
 */
export function refreshShell(): void {
  revalidatePath('/', 'layout');
}
