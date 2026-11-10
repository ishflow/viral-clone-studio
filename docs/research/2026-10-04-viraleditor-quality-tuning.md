# viraleditor quality checks, tuned on real renders (Task C2)

2026-10-04. Everything below was run on this machine unless a line says "not run" or "assumed".

## Result in one line

With the source clips given to `checkOutput`: false alarms 4 → 0, misses 8 → 0 (2 warnings on the good set, both true).
Without the source clips (today only `viraleditor inspect`): false alarms 4 → 0, misses 8 (of 38 rows) → 10 (of 44 rows; the two more are the added zoom rows); six of the ten now carry the warning `text-unverified`, four raise nothing. See "Rows that are still wrong".

Caution on the comparison: the "before" run had 38 rows. Six rows were added afterwards (`good-push`, `good-zoom`, `removed-zoom-whole`, each at two sizes). The old code was never run on those six.

## The labelled set

`viraleditor/src/quality/labelled.ts` builds it: every render goes through `compose` and `createRenderer` with its defaults (quality `looks`, the CLI's libx264), at 720x1280 and 1080x1920, 2 s each (`cuts`: 4 s). Footage is made with ffmpeg at the canvas size, BT.709 tagged, a keyframe every second:

- `busy`: `testsrc2` (hard edges, saturated colours, white and black, things that move)
- `fractal`: `mandelbrot`, a slow zoom
- `clouds`: white clouds that drift about 5 px a frame over a blue sky; the clouds are exactly `#ffffff`
- `white`: a gradient from `#ffffff` to `#e6e6e6` that turns, with noise (footage of white text's own colour)
- `calm`: a still gradient with one small thing that moves, light noise
- `dark`: a night gradient (luma 8 to 37) with one dim light
- `real`: generated product footage (`spike/viraleditor-render/assets/clip-d.mp4`, 1072x1928 at 24 fps, scaled and cropped to the canvas at 30 fps); only where that file is on disk

Good renders: `good-busy` (outlined headline, hairline text, small captions in two groups), `good-clouds` and `good-white` (one text on screen for its whole shot from frame 0, one that comes in late), `good-cuts` (calm shot, dip through black into the dark shot, white flash, crossfade, music and the loudness pass), `good-real`, `good-push` (test pattern under a push-in over the whole shot), `good-zoom` (clouds under a push-in).

Bad renders, one planted fault each. A removed or moved text is planted by rendering the composition of the document without (or with the moved) text and checking it against the timeline of the full document. A swapped clip is planted by linking another file into the composition's assets and giving the check the true source. Sound and size faults are made with ffmpeg from a good render.

## Table before any change (38 rows)

| render | size | planted fault | errors | warnings | verdict |
|---|---|---|---|---|---|
| good-busy | 720 | (none) | text-missing(cap-2) | low-contrast(hair-1) | FALSE ALARM x1 |
| good-busy | 1080 | (none) | text-missing(cap-2) | low-contrast(hair-1) | FALSE ALARM x1 |
| good-clouds | 720 | (none) | - | - | ok |
| good-clouds | 1080 | (none) | - | - | ok |
| good-white | 720 | (none) | - | - | ok |
| good-white | 1080 | (none) | - | - | ok |
| good-cuts | 720 | (none) | - | - | ok |
| good-cuts | 1080 | (none) | - | - | ok |
| good-real | 720 | (none) | text-missing(cap-2) | - | FALSE ALARM x1 |
| good-real | 1080 | (none) | text-missing(cap-2) | - | FALSE ALARM x1 |
| removed-busy | 720 | text "head" removed (busy footage, the text comes in late) | text-missing(head-1), text-missing(cap-2) | low-contrast(hair-1) | found |
| removed-busy | 1080 | text "head" removed (busy footage, the text comes in late) | text-missing(head-1), text-missing(cap-2) | low-contrast(hair-1) | found |
| removed-clouds-late | 720 | text "late" removed (bright moving footage) | text-missing(late-1) | - | found |
| removed-clouds-late | 1080 | text "late" removed (bright moving footage) | text-missing(late-1) | - | found |
| removed-clouds-whole | 720 | text "whole" removed (bright moving footage, covers its whole shot from frame 0) | - | low-contrast(whole-1) | MISSED |
| removed-clouds-whole | 1080 | text "whole" removed (bright moving footage, covers its whole shot from frame 0) | - | low-contrast(whole-1) | MISSED |
| removed-white-whole | 720 | text "whole" removed (footage of the text colour, covers its whole shot from frame 0) | - | low-contrast(whole-1) | MISSED |
| removed-white-whole | 1080 | text "whole" removed (footage of the text colour, covers its whole shot from frame 0) | - | - | MISSED |
| removed-real | 720 | text "head" removed (real footage) | text-missing(head-1), text-missing(cap-2) | - | found |
| removed-real | 1080 | text "head" removed (real footage) | text-missing(head-1), text-missing(cap-2) | - | found |
| bare-white | 720 | text "late" in the footage's own colour without outline | - | low-contrast(late-1) | found |
| bare-white | 1080 | text "late" in the footage's own colour without outline | - | low-contrast(late-1) | found |
| pushed-busy | 720 | text "head" pushed off its box (48 % of the height lower) | text-missing(head-1), text-missing(cap-2) | low-contrast(hair-1) | found |
| pushed-busy | 1080 | text "head" pushed off its box (48 % of the height lower) | text-missing(head-1), text-missing(cap-2) | low-contrast(hair-1) | found |
| black-clip | 720 | the clip replaced by black | black-frames(s1), black-frames(s1), black-frames(s1), text-missing(cap-2) | - | found |
| black-clip | 1080 | the clip replaced by black | black-frames(s1), text-missing(cap-2) | - | found |
| frozen-clip | 720 | the clip frozen from source frame 20 | text-missing(cap-2) | low-contrast(hair-1) | MISSED |
| frozen-clip | 1080 | the clip frozen from source frame 20 | text-missing(cap-2) | low-contrast(hair-1) | MISSED |
| wrong-clip | 720 | the wrong clip (the fractal in place of the test pattern) | text-missing(cap-2) | low-contrast(hair-1) | MISSED |
| wrong-clip | 1080 | the wrong clip (the fractal in place of the test pattern) | text-missing(cap-2) | low-contrast(hair-1) | MISSED |
| no-sound | 720 | the sound stream removed | output-mismatch(render.mp4) | - | found |
| no-sound | 1080 | the sound stream removed | output-mismatch(render.mp4) | - | found |
| quiet-sound | 720 | the sound 12 dB low | - | too-quiet(render.mp4) | found |
| quiet-sound | 1080 | the sound 12 dB low | - | too-quiet(render.mp4) | found |
| wrong-size | 720 | a file of three quarters the size | output-mismatch(render.mp4) | - | found |
| wrong-size | 1080 | a file of three quarters the size | output-mismatch(render.mp4) | - | found |
| wrong-rate | 720 | a file at 25 fps | output-mismatch(render.mp4) | - | found |
| wrong-rate | 1080 | a file at 25 fps | output-mismatch(render.mp4) | - | found |

false alarms 4, warnings on good 2, misses 8

What it showed:

1. `text-missing` on caption group 2 in every render with two caption groups (4 good renders, and as a stray error in 12 bad ones). Cause: the comparison frame was the frame before the group, which shows the group before it in the same rect. A fault of the rule, at both sizes.
2. A text on screen for its whole shot, removed: missed on clouds and on white footage, at both sizes (the known limit).
3. The clip frozen from source frame 20: missed at both sizes. The captions and the texts keep the picture changing, so the freeze detector (mean difference over the whole frame) never sees 15 still frames.
4. The wrong clip: missed; no check looked for it.
5. `low-contrast` on the hairline text over the test pattern: looked at the frame, the thin white text is unreadable over yellow and green. A true warning.
6. No row showed a wrong constant for black frames, frozen frames, still footage, ink distance, ink share or loudness. `good-cuts` (dip, flash, crossfade, dark and calm clips) raised nothing at either size.

## Numbers behind the new rule

The render against its source frame, outside every text and caption, share of pixels that read as "drawn over the footage":

| footage | size | radius 1, distance 48 | radius 2, distance 32 | radius 2, distance 48 | radius 2, distance 64 |
|---|---|---|---|---|---|
| test pattern | 720 | 0.32 … 0.34 % | 0.013 … 0.017 % | 0.003 … 0.004 % | 0.000 % |
| test pattern | 1080 | 0.21 … 0.23 % | 0.007 … 0.011 % | 0.001 … 0.002 % | 0.000 % |
| white noisy footage | 720 | not recorded | 0.11 … 0.18 % | 0.013 … 0.028 % | 0.001 … 0.004 % |
| clouds, real footage, calm, dark, fractal | 720 | not recorded | 0.000 … 0.001 % | 0.000 % | 0.000 % |

(1080 was probed for the test pattern only; the other footage was probed at 720.)

Faults, radius 2, distance 48, 720: clip frozen 10 to 27 frames back on the test pattern 1.9 … 2.4 %; another clip 98 %.
Under a push-in (scale 1.00 to 1.08, centre assumed), test pattern: 0.007 … 0.198 % at 720, 0.001 … 0.138 % at 1080.
Source read with the other colour matrix (BT.601 against BT.709, simulated with `colormatrix`): 0.007 % at 720, 0.003 % at 1080.

Inside a text's rect (720, rect 547x74 = 40 478 pixels, a text needs 203):

| case | pixels drawn over the footage |
|---|---|
| text removed, clouds | 0 |
| text removed, white footage | 15 |
| text removed, real footage | 0 |
| bare white text on white footage (rendered, invisible) | 11 |
| outlined white text on white footage | 4 467 … 5 266 |
| hairline text (rect 547x46, needs 126) | 1 175 … 2 361 |
| outlined headline on clouds, pattern, real footage | 21 177 … 23 170 |

Solid ink (pixels whose 3x3 neighbourhood is all ink) as a share of the ink: weight 800 at 64 px (720) 75 … 76 %, at 96 px (1080) 84 … 85 %; weight 200 at 40 px (720) 0 %, at 60 px (1080) 0.3 % (4 pixels of 1 222).

## The rule chosen for `text-missing`

(a) Compare against the source, with (b) as the fallback. `checkOutput` already receives `sources` from the render command and from the produce pipeline.

On the rest frame nearest the middle on which one shot fills the picture untouched (no second shot, no transition effect, no window; `quality/placement.ts` reads this from `timeline.animations`), the source frame `from + (f − at)` is decoded, placed as the canvas shows it (cover, then the motion scale around the focus) and compared with the render. A pixel is "drawn" when its colour lies more than 48 (RGB distance) outside the range of the footage's colours within 2 pixels of its place. The text is there when at least 0.5 % of its rect (the old ink share) is drawn; the old gate (enough pixels in the fill colour) stays.

Why this one: it needs no frame without the text (the whole-shot rows), it does not care how the footage moves (the cloud rows), and the gap between "nothing" and "a text" is 0 … 15 against 1 175 … 23 170 pixels. (b) alone cannot solve a text with no text-free frame; (c) was not built as a rule of its own.

The comparison is used only when the render shows that footage: at most 0.5 % of the picture outside the elements may differ. Otherwise the rule falls back.

Fallback (b), without sources or without a usable frame: the old growth rule, with two changes. The comparison frame must be free of every other text or caption that meets the rect (this removed the caption false alarm). And the footage's own change is measured on a second text-free frame as far from the first as the rest frame is, on the other side: the growth must hold with that change added and with it taken away; when it holds only one way the result is the warning `text-unverified`, not a pass and not an error. A text with no text-free frame at all and a contrast under 3 : 1 is also `text-unverified`.

Consequence to know: a text that DID render in exactly the footage's colour with no outline or plate gives the same pixels as a text that did not render. With sources both are now the error `text-missing` (the message says both causes and both cures). Before, this was the warning `low-contrast`.

## Table after (44 rows, with sources)

| render | size | planted fault | errors | warnings | verdict |
|---|---|---|---|---|---|
| good-busy | 720 | (none) | - | low-contrast(hair-1) | ok |
| good-busy | 1080 | (none) | - | low-contrast(hair-1) | ok |
| good-clouds | 720 | (none) | - | - | ok |
| good-clouds | 1080 | (none) | - | - | ok |
| good-white | 720 | (none) | - | - | ok |
| good-white | 1080 | (none) | - | - | ok |
| good-cuts | 720 | (none) | - | - | ok |
| good-cuts | 1080 | (none) | - | - | ok |
| good-real | 720 | (none) | - | - | ok |
| good-real | 1080 | (none) | - | - | ok |
| good-push | 720 | (none) | - | - | ok |
| good-push | 1080 | (none) | - | - | ok |
| good-zoom | 720 | (none) | - | - | ok |
| good-zoom | 1080 | (none) | - | - | ok |
| removed-busy | 720 | text "head" removed (busy footage, the text comes in late) | text-missing(head-1) | low-contrast(hair-1) | found |
| removed-busy | 1080 | text "head" removed (busy footage, the text comes in late) | text-missing(head-1) | low-contrast(hair-1) | found |
| removed-clouds-late | 720 | text "late" removed (bright moving footage) | text-missing(late-1) | - | found |
| removed-clouds-late | 1080 | text "late" removed (bright moving footage) | text-missing(late-1) | - | found |
| removed-clouds-whole | 720 | text "whole" removed (bright moving footage, covers its whole shot from frame 0) | text-missing(whole-1) | - | found |
| removed-clouds-whole | 1080 | text "whole" removed (bright moving footage, covers its whole shot from frame 0) | text-missing(whole-1) | - | found |
| removed-white-whole | 720 | text "whole" removed (footage of the text colour, covers its whole shot from frame 0) | text-missing(whole-1) | - | found |
| removed-white-whole | 1080 | text "whole" removed (footage of the text colour, covers its whole shot from frame 0) | text-missing(whole-1) | - | found |
| removed-zoom-whole | 720 | text "whole" removed (bright moving footage in a shot that zooms in all along; covers its whole shot from frame 0) | text-missing(whole-1) | - | found |
| removed-zoom-whole | 1080 | text "whole" removed (bright moving footage in a shot that zooms in all along; covers its whole shot from frame 0) | text-missing(whole-1) | - | found |
| removed-real | 720 | text "head" removed (real footage) | text-missing(head-1) | - | found |
| removed-real | 1080 | text "head" removed (real footage) | text-missing(head-1) | - | found |
| bare-white | 720 | text "late" in the footage's own colour without outline | text-missing(late-1) | - | found |
| bare-white | 1080 | text "late" in the footage's own colour without outline | text-missing(late-1) | - | found |
| pushed-busy | 720 | text "head" pushed off its box (48 % of the height lower) | text-missing(head-1) | low-contrast(hair-1) | found |
| pushed-busy | 1080 | text "head" pushed off its box (48 % of the height lower) | text-missing(head-1) | low-contrast(hair-1) | found |
| black-clip | 720 | the clip replaced by black | black-frames(s1), black-frames(s1), black-frames(s1) | - | found |
| black-clip | 1080 | the clip replaced by black | black-frames(s1) | - | found |
| frozen-clip | 720 | the clip frozen from source frame 20 | wrong-footage(s1) | low-contrast(hair-1) | found |
| frozen-clip | 1080 | the clip frozen from source frame 20 | wrong-footage(s1) | low-contrast(hair-1) | found |
| wrong-clip | 720 | the wrong clip (the fractal in place of the test pattern) | wrong-footage(s1) | low-contrast(hair-1) | found |
| wrong-clip | 1080 | the wrong clip (the fractal in place of the test pattern) | wrong-footage(s1) | low-contrast(hair-1) | found |
| no-sound | 720 | the sound stream removed | output-mismatch(render.mp4) | - | found |
| no-sound | 1080 | the sound stream removed | output-mismatch(render.mp4) | - | found |
| quiet-sound | 720 | the sound 12 dB low | - | too-quiet(render.mp4) | found |
| quiet-sound | 1080 | the sound 12 dB low | - | too-quiet(render.mp4) | found |
| wrong-size | 720 | a file of three quarters the size | output-mismatch(render.mp4) | - | found |
| wrong-size | 1080 | a file of three quarters the size | output-mismatch(render.mp4) | - | found |
| wrong-rate | 720 | a file at 25 fps | output-mismatch(render.mp4) | - | found |
| wrong-rate | 1080 | a file at 25 fps | output-mismatch(render.mp4) | - | found |

false alarms 0, warnings on good 2, misses 0

How the formerly missed rows were found: whole-shot texts through the footage rule ("0 of 40478 pixels differ from source frame 30"); the frozen clip as `wrong-footage` ("starts on its footage and leaves it … 2.0 % … its first frame matches"); the wrong clip as `wrong-footage` (98 %).

## Without sources

False alarms 0, warnings on good 2, misses 8: `removed-clouds-whole` (720, 1080: only a `low-contrast` warning), `removed-white-whole` (720: `low-contrast` warning; 1080: nothing at all), `frozen-clip` (both), `wrong-clip` (both). All other rows as with sources, except that `bare-white` is the warning `low-contrast` there.
That was the first run (42 rows, before the thin-text change and the last `text-unverified` change). The second run, on the final code (44 rows): false alarms 0, warnings on good 2, misses 10. `removed-clouds-whole`, `removed-white-whole` and `removed-zoom-whole` raise the warning `text-unverified` at both sizes (none is silent any more; still no error, so they count as missed). `frozen-clip` and `wrong-clip` raise nothing about the fault at either size.

## Rows that are still wrong

1. **Text removed, on screen for its whole shot, no sources** (clouds, white and the zoomed clouds, both sizes; 6 rows). Tried, in order:
   - ink share alone (the old rule): passes; the footage supplies 5 822 (clouds) and 9 452 (white) pixels of 40 478 at 720, a text needs 203.
   - (b) the footage's own change: needs a frame of the shot without the text; there is none.
   - (c) through the ring contrast: 1.31 : 1 on clouds and 2.16 : 1 on white at 720, so a warning is raised; at 1080 on white nothing was raised (the number was not recorded). It cannot be an error: a text that rendered without outline over bright footage reads the same low contrast, and bright footage with a hard edge would read a high contrast and pass.
   - now: the warning `text-unverified` when the contrast is under 3 : 1. On the set all six rows raise it. It is a warning, and it rests on the same contrast reading: bright footage with a hard edge would still pass in silence (no such row in the set).
   - what would solve it: give `inspect` the sources, or carry the outline colour in the timeline and look for it next to the ink (not built).
2. **Wrong clip, no sources** (2 rows): cannot be known without the source.
3. **Frozen clip under animated text, no sources** (2 rows): the freeze detector reads the whole frame. Nothing was tried beyond the measurement (a detector that leaves the element rects out was not built).

## Limits that remain with sources (no row in the set, not measured)

- A text whose whole rest lies inside a window, a transition or an overlap of two shots: no untouched frame, the fallback is used.
- A shot with a focus other than the centre and a zoom or a crop: the timeline does not carry the focus, the centre is assumed; when the footage then does not match within 0.5 %, the fallback is used and `wrong-footage` is not raised (it is raised only where the place is certain: same shape as the canvas and scale 1).
- A source of another shape than the canvas was not in the set.
- `wrong-footage` looks at one frame per shot (the last untouched one); a clip that is wrong only in the middle of a shot is not seen.
- The frozen detector itself is unchanged: `frozen-clip` is found as `wrong-footage`, not as `frozen-frames`.

## Observations, not changed

- The black clip at 720 raises three `black-frames` errors for one fault: with text over it less than 98 % of the picture is black on some frames, so the run breaks. With more text on screen blackdetect would see no black at all; `wrong-footage` would then report it (not tested).
- `measure.frozen` returns runs that include the frame on which the picture changes again; holds that follow each other back to back therefore merge into one long run in `checkOutput` (seen on a stand-in: runs 31+10, 41+8, 49+8 …).
