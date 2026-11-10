import { GenerateForm } from './GenerateForm';
import { GenerateNotReady } from './GenerateNotReady';
import { loadGenerate } from './load';

/** `/templates/[id]/generate`: the form, or the note that the template is not ready. `from`: a finished job whose entries start the form. */
export async function GenerateScreen({ id, from }: { id: string; from?: string }) {
  const loaded = await loadGenerate(id, from);
  if (!loaded.ready) return <GenerateNotReady failed={loaded.failed} template={loaded.template} />;
  return <GenerateForm template={loaded.template} rates={loaded.rates} free={loaded.free} freeHeld={loaded.freeHeld} paused={loaded.paused} draft={loaded.draft} fromJob={loaded.fromJob} draftKey={loaded.draftKey} />;
}
