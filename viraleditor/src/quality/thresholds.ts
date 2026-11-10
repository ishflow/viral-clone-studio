// Every number the quality checks decide by, in one place, each with the reason it is what it is.
// Measured on the samples of samples.ts and on the render stand-ins of the tests; revisit them against real renders.

// ── inputs ──
/** A sound file whose integrated loudness is under this is silent. The brief says "mean below -60 dB"; a gated integrated loudness of -60 LUFS is the same idea and is what the Measure port gives. Digital silence reads -70 (the floor). */
export const SILENT_LUFS = -60;
/** The loudness meter (EBU R128, ebur128) gates on blocks of 400 ms: a sound shorter than that has no block, and its integrated loudness reads the floor, -70 LUFS, whatever it holds (measured: a 0.1 s sine, finding F13 of docs/research/2026-10-04-viraleditor-robustness.md). Such a sound is not judged silent. */
export const LOUDNESS_WINDOW_SECONDS = 0.4;
/** Two frames of rate difference are never rounding: 29.97 against 30 is also a different rate, and the check says so. Under this many fps apart the rate is the same. */
export const FPS_TOLERANCE = 0.01;
/** A browser seeks to the keyframe before a frame and decodes forward: with more than one second between keyframes, scrubbing a long-GOP clip is slow and can miss a frame. */
export const KEYFRAME_SECONDS = 1;

// ── output: file against timeline ──
/** The render and the timeline must have the same rate; a hundredth of a frame per second is a rounding of the ffprobe fraction, not a difference. */
export const FPS_TOLERANCE_OUTPUT = 0.01;

// ── output: picture ──
/** A run of black frames shorter than this is not reported: a single black frame can come from the encoder at a cut; two in a row are in the picture (ruling of fix round 1). */
export const BLACK_MIN_FRAMES = 2;
/** A transition colour explains black frames only when every channel is at most this: the level at which the detector (pix_th 0.05, luma 27 of 16-235) starts to call a pixel black. */
export const BLACK_DARK_CHANNEL = 26;
/** A dip or flash explains the black frames of its visible stretch; one frame more on each side, because the first and the last frame of a fade are only almost black or almost not. */
export const BLACK_EXPLAIN_MARGIN = 1;
/** The picture does not change for more than this many frames (half a second at 30 fps) inside a playing video shot. */
export const FROZEN_MAX_FRAMES = 15;
/** A frozen stretch in the render that is also still in the source (at least this share of its frames) is the footage's own doing: warning `still-footage`, not an error. Not all frames: the render's encoder and the source's differ by a frame or two at the edges. */
export const STILL_SOURCE_SHARE = 0.8;

// ── output: text ──
/** A pixel is "ink" (the text's own colour) when its distance to the fill colour in RGB is at most this (of 441 at most). Anti-aliased edges and codec noise stay inside; other colours stay out. */
export const INK_DISTANCE = 48;
/** At least this share of the rect must be ink, or the text did not render. Letters cover about 5-20 % of a line's rect; 0.5 % is an eighth of the sparsest case and above stray matches in footage. */
export const INK_MIN_SHARE = 0.005;
/** And at least this many ink pixels, whatever the rect (a tiny rect has a tiny share). */
export const INK_MIN_PIXELS = 12;
/** The connected-ink count (ink pixels with two ink neighbours: strokes and blocks, not scattered specks; an outline that covers the specks must not look like missing text) of the rect, with the text on screen, must be at least this many times the count on a frame of the same shot where the text is not on screen, and must have grown by the absolute count of a rendered text (the same count as the share minimum). Bright footage (sky, clouds) supplies near-white "ink" by itself. Measured on 270x480 samples: clouds alone 720 pixels; hairline text (2 px strokes) over the clouds 1632 (2.3x, +912); full letters 4752 (6.6x); clouds only on the second frame 720 (1.0x, +0). 1.5x sits between 1.0 and 2.3. */
export const INK_GROWTH = 1.5;
/** Raw-ink growth must beat the flicker of the footage's own specks by this many standard deviations (sqrt of the empty count): 3 sigma is under 0.3 % false alarms on a missing text. Measured: specks 736 +- 27 per frame on noisy bright footage; a 6-letter 1 px diagonal hairline adds 168 (needs max(46, 81)). */
/** Assumes independent specks (codec noise from one frame to the next), not footage motion: moving bright footage can change the count by far more than this. */
export const RAW_GROWTH_SIGMAS = 3;
/** When the empty rect is already this share ink, the footage has the text colour all over: nothing can be learned from the growth, and the reading goes on to the contrast (which will say 1 : 1). */
export const INK_BACKGROUND_SHARE = 0.5;
/** The ring around the ink in which the background is read, in pixels (the brief says 3). */
export const RING_PIXELS = 3;
/** Text is thin when less than this share of its ink is solid (a pixel whose 3x3 neighbourhood is all ink). Measured on real renders: weight 800 at 64 px (720) 75 … 76 %, at 96 px (1080) 84 … 85 %; weight 200 at 40 px (720) 0 %, at 60 px (1080) 0.3 % (4 pixels of 1222, where strokes meet: the ring around those 4 alone was 164 pixels and read 2.1 : 1 where the whole text reads 1.7 : 1, and 3.4 : 1 where it reads 4.3 : 1). A share holds at every canvas size; "any solid pixel" did not. */
export const SOLID_MIN_SHARE = 0.2;
/** Under this many ring pixels there is no background to compare with: the text colour fills the rect, so the letters cannot be told from what is behind them. */
export const RING_MIN_PIXELS = 12;
/** WCAG contrast under which text on its background is too hard to read; 3 : 1 is the level for large text, which all video text is. */
export const MIN_CONTRAST = 3;

// ── output: sound ──
/** Integrated loudness may be this far from the master target (LU). */
export const LUFS_TOLERANCE = 1.5;
/** With no master target (master: null), a mix outside this range is wrong for a phone video. */
export const LUFS_FLOOR_NO_MASTER = -23;
export const LUFS_CEILING_NO_MASTER = -9;
/** True peak above this clips on conversion to a lossy format and on phone speakers (dBTP). */
export const TRUE_PEAK_MAX = -0.3;
/** A mix under this integrated loudness is silent (same level as SILENT_LUFS). */
export const MIX_SILENT_LUFS = SILENT_LUFS;

// ── output: the render against its footage (measured on real renders at 720x1280 and 1080x1920, docs/research/2026-10-04-viraleditor-quality-tuning.md) ──
/** The footage's colours are looked for this many pixels around a place. Measured on the test pattern (hard edges, saturated colours) outside every element: with 1 pixel 0.32 % (720) and 0.22 % (1080) of the picture reads as "drawn" at distance 48 (the encoder moves and softens edges), with 2 pixels 0.004 % and 0.002 %. Not scaled with the canvas: it is the encoder's reach, and the larger canvas reads cleaner. */
export const MATCH_RADIUS = 2;
/** A pixel further than this (RGB distance) outside the range of the footage's colours around its place was drawn over the footage. Measured at radius 2 outside every element: 24 → 0.04 %, 32 → 0.014 %, 48 → 0.004 %, 64 → 0.000 % of the picture; white letters over the same footage: 100 % of their ink. The same number as INK_DISTANCE: what counts as "the same colour" is one idea. */
export const MATCH_DISTANCE = 48;
/** The render shows a shot's footage when at most this share of the picture outside every element is drawn over it. Measured on the labelled set (both sizes, distance 48, radius 2): good renders 0.000 … 0.028 % (the highest: noisy near-white footage); a clip frozen 10 … 39 frames back on the mostly still test pattern 1.9 … 2.5 %; another clip 98 %. 0.5 % is 18 times the worst good reading and a quarter of the weakest fault. */
export const FOOTAGE_MATCH_SHARE = 0.005;
/** The whole-picture comparison reads every n-th pixel in both directions: a share needs no more. */
export const MATCH_STEP = 2;
/** With less than this share of the picture left outside the elements there is too little footage to compare. */
export const MATCH_MIN_AREA = 0.1;
/** An element's rect is left out of the footage comparison with this much room around it, as a share of its height: outline (0.12 em at most), shadow, the overshoot of a pop. */
export const ELEMENT_MARGIN = 0.25;
/** When other elements cover the rect of a text down to less than this share, what lies over the footage there cannot be attributed to the text: the footage rule gives no verdict. */
export const OVER_MIN_AREA = 0.2;
