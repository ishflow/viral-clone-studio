// The sweep, windows: one, two in order, with swaps, over a picture and over footage, next to a transition. Two renders are
// compared by decoded positions (design §12.9), not by checksum.
import { windowsImage, windowsVideo } from './documents.ts';
import { sweepMedia } from './media.ts';
import type { SweepMedia } from './media.ts';
import { standard } from './standard.ts';

let media: SweepMedia | undefined;
const shared = () => (media ??= sweepMedia());

standard('10-windows-image', windowsImage, shared, { windows: true });
standard('11-windows-video', windowsVideo, shared, { windows: true, skip: { window: 'edge scan of a clip in a window stops early at the frame bar of the clip: harness limit, undecided' } });
