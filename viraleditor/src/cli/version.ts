import { HYPERFRAMES_VERSION } from '../adapters/renderer.ts';

/** What `--version` answers and what a stamp of a passed check is bound to: the version of the edit document the editor reads and the HyperFrames CLI it runs. */
export const VERSION = { edit: 1, hyperframes: HYPERFRAMES_VERSION } as const;
