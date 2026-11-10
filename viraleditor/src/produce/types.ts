import type { StopReason } from '../contracts.ts';
import type { FillJson } from '../template/schema.ts';

/** Everything one variant needs to be assembled: the adapted fill and the paid files, as paths under data/. */
export interface VariantMedia {
  n: number;                              // 1-based
  dir: string;                            // jobs/<runId>/v<n>, under data/
  fill: FillJson;
  images: Record<string, string>;         // by shot id, 'presenter', or still id
  clips: Record<string, string>;          // by shot id (beats) or segment id (speech): the files as generated, not normalised
  music: string | null;
  voice: string | null;
}
export type Gathered = { n: number; ok: true; media: VariantMedia } | { n: number; ok: false; reason: StopReason };
/** A paid file of the variant that is at fault. `id`: its key in `VariantMedia.images` / `.clips`; none for music and voice. */
export type Faulty = { kind: 'image' | 'clip' | 'music' | 'voice'; id?: string };
/** Paths under data/. On a stop: `detail`, one line for the admin; `faulty`, the paid files that have to be made again. */
export type Assembled = { ok: true; video: string; image: string } | { ok: false; reason: StopReason; detail?: string; faulty?: Faulty[] };
