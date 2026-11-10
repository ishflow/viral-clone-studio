'use server';

import { requireAdmin } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { data } from '@/data';
import { refuseForbidden } from '../admin-common/forbidden';
import { currentHealthView, type HealthView } from './health';
import { parseSettings, type SettingErrors } from './schema';

export type SettingsState = { status: 'idle' | 'saved' | 'error'; errors: SettingErrors };

/** "Save changes": validated here. Every field of the form is saved (the scan settings to the engine, the limits to the site); the provider account is not on the form. */
export async function saveSettings(_previous: SettingsState, form: FormData): Promise<SettingsState> {
  const admin = await requireAdmin();
  const parsed = parseSettings(form);
  if (!parsed.ok) return { status: 'error', errors: parsed.errors };
  try {
    await data.admin.saveSettings(parsed.value);
    if (Object.keys(parsed.limits).length > 0) await data.admin.saveLimits(admin.id, parsed.limits);
  } catch (error) {
    refuseForbidden(error);
    return { status: 'error', errors: { form: 'failed' } };
  }
  refreshShell();
  return { status: 'saved', errors: {} };
}

/** "Check connection": the production system's health as of now, or null when it could not be read. */
export async function checkConnection(): Promise<HealthView | null> {
  await requireAdmin();
  try {
    return await currentHealthView();
  } catch {
    return null;
  }
}
