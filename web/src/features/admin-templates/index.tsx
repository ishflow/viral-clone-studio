import { requireAdmin } from '@/core/session/guards';
import { loadEditor, loadInbox, loadList, loadScans } from './load';
import { EditView } from './EditView';
import { InboxView } from './InboxView';
import { ListView } from './ListView';
import { NewSwapView } from './NewSwapView';
import { ScansView } from './ScansView';
import { SwapEditView } from './SwapEditView';

type Params = Promise<Record<string, string | string[] | undefined>>;

export async function AdminTemplates({ searchParams }: { searchParams: Params }) {
  return <ListView {...await loadList(await searchParams)} />;
}
export async function AdminInbox({ searchParams }: { searchParams: Params }) {
  return <InboxView {...await loadInbox(await searchParams)} />;
}
export async function AdminScans({ searchParams }: { searchParams: Params }) {
  return <ScansView {...await loadScans(await searchParams)} />;
}
export async function AdminNewSwap() {
  await requireAdmin();
  return <NewSwapView />;
}
export async function AdminTemplateEdit({ id }: { id: string }) {
  const editor = await loadEditor(id);
  return editor.template.swap ? <SwapEditView template={editor.template} /> : <EditView {...editor} />;
}
