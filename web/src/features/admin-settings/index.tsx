import { providerCaps } from '../../../../viraleditor/src/robust/provider-policy';
import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import { currentHealthView } from './health';
import { SettingsView } from './SettingsView';

export async function AdminSettings() {
  await requireAdmin();
  const [settings, limits, health] = await Promise.all([data.admin.settings(), data.admin.limits(), currentHealthView().catch(() => null)]);
  return <SettingsView settings={settings} limits={limits} health={health} providerCaps={providerCaps(process.env)} />;
}
