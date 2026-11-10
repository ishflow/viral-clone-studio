// The sweep, picture documents: cuts, transitions between footage and pictures, texts at cuts. Every frame of every render is read.
import { cuts, textExits, textsAtCuts, transitionsImageImage, transitionsVideoImage, transitionsVideoVideo } from './documents.ts';
import { sweepMedia } from './media.ts';
import type { SweepMedia } from './media.ts';
import { available } from './run.ts';
import { standard } from './standard.ts';

let media: SweepMedia | undefined;
const shared = () => (media ??= sweepMedia());
void available;

standard('01-cuts', cuts, shared);
standard('02-transitions-video-image', transitionsVideoImage, shared);
standard('03-transitions-video-video', transitionsVideoVideo, shared);
standard('04-transitions-image-image-1080', transitionsImageImage, shared);
standard('05-texts-at-cuts', textsAtCuts, shared);
standard('06-text-exits', textExits, shared);
