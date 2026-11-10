// The sweep, captions and cards: word by word across a cut, pill and fill highlight, words of 1 and 2 frames, cards on word ranges.
import { captionsFill, captionsPill, cardsOnWords } from './documents.ts';
import { sweepMedia } from './media.ts';
import type { SweepMedia } from './media.ts';
import { standard } from './standard.ts';

let media: SweepMedia | undefined;
const shared = () => (media ??= sweepMedia());

standard('07-captions-pill', captionsPill, shared);
standard('08-captions-fill-1080', captionsFill, shared);
standard('09-cards-on-words', cardsOnWords, shared);
