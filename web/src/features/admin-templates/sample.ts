import type { Template } from '@/data/ports';

/** A sample of the template that is being generated now; `jobId` when the data layer names its job. */
export type RunningSample = { jobId: string | null };

/**
 * Reads the running sample of a template, when the data layer says so. Not in `Template` yet (D0 is to add it): the shapes read are
 * `sampleRunning: true` and `sampleRunning: { jobId }`. Anything else, or no field, is "none running".
 */
export function runningSample(template: Template): RunningSample | null {
  const flag: unknown = (template as Template & { sampleRunning?: unknown }).sampleRunning;
  if (flag === true) return { jobId: null };
  if (typeof flag === 'object' && flag !== null) {
    const jobId: unknown = (flag as { jobId?: unknown }).jobId;
    return { jobId: typeof jobId === 'string' ? jobId : null };
  }
  return null;
}

/** A sample can be made only of a catalog template that is not being prepared and did not fail. */
export const canSample = (template: Pick<Template, 'status' | 'preparation'>) =>
  template.status !== 'private' && template.preparation !== 'preparing' && template.preparation !== 'failed';
