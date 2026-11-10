// The sweep, thirty seconds: 900 frames read, every transition kind, texts and a card over pictures.
import { longDocument } from './documents.ts';
import { sweepMedia } from './media.ts';
import type { SweepMedia } from './media.ts';
import { standard } from './standard.ts';

let media: SweepMedia | undefined;
const shared = () => (media ??= sweepMedia());

standard('14-thirty-seconds', longDocument, shared);
