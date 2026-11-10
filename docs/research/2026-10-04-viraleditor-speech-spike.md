# viraleditor — spike S3: the talking format (speech mode)

**Date:** 2026-10-04 · **Folder:** `spike/viraleditor-speech/` (git-ignored) · **Brief:** `.superpowers/sdd/2026-10-04-viral-clone-engine/spike-S3-speech-brief.md` · **Builds on:** `spike/viraleditor-render/` (revision §1)

**Machine:** Apple M5, 10 cores, 24 GB · Node 25.9.0 · ffmpeg 8.1.1 · `hyperframes` 0.8.120 (the CLI of `spike/viraleditor-render/node_modules`) · Chrome headless shell 152. Every `hyperframes` command ran with `HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1`. No paid request, no network request, no Hypit, no GSAP, no new dependency.

Every statement below is marked **[ran]** (the command or script is named; the output is in `spike/viraleditor-speech/out/`), **[read]** (read in the code of `hyperframes` 0.8.120, file `dist/chunk-IUBZ3DSO.js` unless another is named) or **[assumed]**.

---

## 1. Result in short

**Speech mode holds on HyperFrames 0.8.120.** One 30.1 s talking montage was built: three presenter clips end to end with their own sound, 88 word-by-word caption states timed from the speech, two product cards and one inset passage on word ranges, music under the voice. It lints clean, passes `check`, renders at 720×1280 and 1080×1920, and measures as designed.

| Question | Answer | Where |
|---|---|---|
| Does the picture stay with the sound over 30 s? | **Yes.** Picture: all 903 output frames show the intended source frame, at both sizes. Sound: 0.00 ms in the first segment, 0.33 ms early from the first cut on, the same at the start and the end of each segment, so nothing drifts. The 0.33 ms is HyperFrames rounding every audio start to a whole millisecond (worst case ±0.5 ms). | §3.2 |
| Do captions change on the right frame? | **Yes:** 88 of 88 changes on the wanted frame. What a viewer gets is limited by the recogniser, not the renderer: single word starts are up to 0.19 s wrong (0.33 s in another run on the same audio). | §3.3, §3.4 |
| How many timed elements before `check` or render hurts? | **More than we will write.** With 14, 102, 272, 915 and 2 717 timed elements the 720p render took 29.8, 28.0, 29.8, 32.0 and 36.3 s and `check` 7.3, 8.2, 8.9, 10.8 and 16.9 s (runs made one after the other; a speech video needs about 100). The cost is frames and pixels: 28–62 s at 720p and 50–110 s at 1080p for these 30 s, on a machine that was overloaded all day (load average 16–39), so upper bounds. `check` itself does not gate captions, though (point 2 under this table). | §3.1 |
| Can the mix stay inside HyperFrames? | **Yes for the mix, no for the music's length.** Speech comes out at −0.04 dB and music at −20.07 dB when −20.00 is asked: the mixer only adds. The −0.9 dB shift does not appear. Volume lanes (ducking) are exact up to 512 points. But a loop made of `<audio>` elements clicks unless every pass starts on a whole millisecond, and a bed with a fade-out cannot be looped mechanically at all. A loudness target or a peak ceiling needs one ffmpeg pass of our own over the finished file. | §3.5 |
| Does `alignWords` work? | **Yes on this clip:** 88 of 88 script words timed, through "last" for "lash", "Lash Lee" for "Lashly", "Ack Me" for "ACME" and an extra word. | §3.4 |

**What the design has to change** (details in §4 and §5):

1. `alignWords` needs the two merge moves (a brand name heard as two words), and must report how many words were paired with a *similar* heard word: that number, not "got a time", tells that a clip spoke other lines.
2. The `check` gate does not protect captions: an overlong caption line is only a warning, and only when a sample time falls inside it.
3. "Music: looped" becomes "music asked for after the clips are measured, as long as the video; trimmed and faded". No loop in the first version.
4. The inset's ring and shadow cannot sit on the `<video>`; the schema needs `stills` and an `inset`; caption elements need the class `caption`.

The rest of this document: what was built (§2), the numbers (§3), every warning and limit (§4), what the editor's document must say (§5), what is still unproved (§6), how to run it again (§7).

---

## 2. What was built

**Stand-in presenter clips** [ran: `node prep.mjs`]. `web/public/samples/lashly.mp4` (720×1280, 30 fps, 903 frames, 30.1 s) is cut at the level minimum of two pauses (12.01–12.07 s and 20.98–21.07 s, from a 10 ms RMS envelope) into s1 = frames 0–360 (361 frames), s2 = 361–630 (270), s3 = 631–902 (272). One ffmpeg command per clip normalises it: `trim` by frame, `atrim` by sample (1600 samples per frame), libx264 CRF 16, `-g 30 -keyint_min 30 -sc_threshold 0` (a keyframe every 30 frames: checked with ffprobe), AAC 192k at 48 kHz. Two sets: 720×1280 and 1080×1920 (upscaled). A 10-bit **frame code** is burned into the top edge of each clip (ten blocks, white = bit set, value = the clip's own frame number). It is the measuring tape for sync, not part of the format. The sample is a finished video: it already carries burned-in captions, cards and an inset; ours go on top (the caption plate hides theirs).

**Script and marks.** `script.txt`: one line per segment, the transcript corrected by hand (88 words), marks in our own syntax: `[inset]So this is week zero. No serum, nothing.[/inset]`, `[card1]It's the Lashly serum from ACME.[/card1]`, `[card2]Aloe, shea, jojoba,[/card2]`. `parseScript` (`timeline.mjs`) returns words and mark ranges; an unbalanced mark throws.

**Word timings** [ran]. `hyperframes transcribe assets/720/sN.mp4 -d out/tr-sN --engine whisper --model small.en --language en --json`: 39 + 24 + 28 heard words, 2.2–2.8 s wall per segment (model cached).

**`alignWords`** (`align.mjs`, 119 lines, pure). Global sequence alignment (Needleman–Wunsch) on normalised words (lower case, letters and digits only), scored by Levenshtein similarity, with two extra moves: one script word = two heard words ("Lashly" ← "Lash" + "Lee") and two script words = one heard word. A word that was not heard gets a time between its neighbours: the hole between them when there is one, otherwise a share of the neighbour's time by letter count. Returns `{ start, end, heard }` per script word.

**Frame table** (`timeline.mjs`, pure). Segments end to end; a word's frame = segment start + `round(start × fps)`, then forced at least 2 frames after the word before; caption groups of ≤ 4 words (a new group after `. ? !`, after a comma from two words on, after a pause over 0.35 s, at a cut); ≤ 2 lines (the split that balances the letter counts; two words of ≤ 14 letters stay on one line); one caption state per word, from its frame to the next word's frame; a group holds until the next group when the gap is ≤ 12 frames, otherwise 6 frames after its last word; a mark's window runs from the frame of its first word to the frame of the first word after it. Result: 28 groups, 88 states, inset on frames 168–259, card 1 on 362–448, card 2 on 449–521.

**The composition** (`node build.mjs <name> [--size 1080] [--density 3|frame] [--tracks N]` → `comps/<name>/index.html` + `timeline.json`). The root is the one of beats mode (`data-no-timeline`, no `<script>`, no animation, no URL outside the folder). 102 timed elements at 1×:

| What | Elements | How |
|---|---|---|
| Presenter | 5 `<video muted>` | segments end to end; s1 is cut in three pieces at the edges of the inset, each piece with `data-media-start` = its offset in the clip |
| Voice | 3 `<audio>` | `src` = the same mp4 as the segment's picture, one per segment, never cut |
| Captions | 88 `<div class="clip caption">` | leaf elements in one untimed full-frame layer; each holds its whole group as `<span>` lines and words, the active word has a background colour; the plate is `width: fit-content`, centred, between 52 % and 65 % of the height |
| Product cards | 2 `<img class="clip">` | in an untimed layer, box in percent, `object-fit: contain`, on the marks `card1` and `card2` |
| Inset passage | 1 full-frame `<img>` + 1 `<video>` in a 30 % × 30 % window with `border-radius` + 1 `<div>` for the ring and shadow | all on the mark `inset`; the window shows the s1 piece of those frames, the sound runs on unbroken |
| Music | 2 `<audio>` | the 26.04 s bed and a second pass from frame 781; gain 0.1 and a 12-frame fade-out as volume-lane points |

**Timing technique: per-element windows only** (`data-start` / `data-duration` = `String(frame / fps)`). Why: it is the technique already proved frame-exact, it needs no runtime, no script and no timeline, and it carries thousands of elements (§3.1). The inset is a hard switch: the presenter is in the window from one frame on and back from another. A real shrink needs an animation runtime and belongs to the motion spike. CSS keyframes and Web Animations were **not tried** here.

---

## 3. Numbers

### 3.1 Times, and what the number of timed elements does to them

[ran: `node run.mjs <name>` = `hyperframes lint --json`, `hyperframes check --no-contrast --json`, `hyperframes render --fps 30 --quality looks --workers 4`; wall times, all rows in `out/times.jsonl`; `./batch1.sh`, `./batch3.sh`.] All 903 frames, 30.1 s, `screenshot capture · hardware gpu` in every run. **The machine was shared and overloaded the whole time** (load average 16 to 39 on 10 cores; other agents were rendering), so every time is an upper bound: the same 720p render took between 28 s and 62 s (61.5 s on the very first render, made by hand before `run.mjs` existed). Each cell lists every run of that composition in the order they were made. The **bold** values of the 720p rows were made one after the other within four minutes (10:11–10:15 UTC) and are the fair comparison between rows.

| Composition | Timed elements (captions) | HTML, kB | lint, s | check with 9 samples, s | render wall, s (capture + encode) | Lint findings |
|---|---|---|---|---|---|---|
| `nocap-720` | 14 (0) | 5 | **0.3** · 0.6 | **7.3** · 8.9 · 10.9 | **29.8 (16.2 + 8.6)** · 45.0 (22.8 + 17.2) · 43.2 (24.2 + 12.2) | none |
| `speech-720` | 102 (88) | 29 | 0.9 · **0.3** · 1.0 | 12.7 · **8.2** · 11.3 · 9.8 | 51.7 (29.4 + 15.5) · **28.0 (17.3 + 7.4)** · 45.5 (26.3 + 10.6) · 50.5 (22.5 + 21.7) | none |
| `d3-720` (3× denser captions) | 272 (258) | 76 | **0.4** · 0.9 | **8.9** · 11.3 | **29.8 (16.8 + 7.3)** · 46.6 (25.4 + 16.6) | none |
| `dframe-720` (a caption element per frame) | 915 (901) | 247 | **0.7** · 2.0 | **10.8** · 16.8 · 19.0 | **32.0 (17.6 + 8.0)** · 64.5 (34.6 + 21.5) · 56.4 (26.4 + 15.5) | `composition_file_too_large` |
| `dframe3-720` (three such tracks) | 2 717 (2 703) | 753 | **1.5** | **16.9** · 39.6 | **36.3 (20.2 + 7.9)** · 60.6 (32.0 + 15.3) | `composition_file_too_large` |
| `speech-1080` | 102 (88) | 29 | 0.6 · 0.3 · 0.5 | 11.2 · 9.7 · 12.2 · 14.1 | 49.8 (24.0 + 18.2) · 52.1 (26.6 + 22.6) · 109.8 (48.6 + 53.2) · 63.3 (34.8 + 22.0) | none |
| `d3-1080` | 272 (258) | 76 | 0.4 · 1.2 | 11.3 · 13.1 | 62.7 (29.1 + 22.9) · 90.9 (43.9 + 39.1) | none |
| `dframe-1080` | 915 (901) | 247 | 1.5 | 19.0 · 17.5 | 111.0 (38.3 + 56.3) · 66.9 (35.9 + 22.5) | `composition_file_too_large` |

The 111 s of `dframe-1080` and the 39.6 s check of `dframe3-720` were measured while our own frame checks or a load of 36 ran beside them; `speech-720` had 101 elements in its first run (the ring of the inset came later).

What the numbers say:

- **The number of timed elements is not the cost.** Bold stretch, 14 → 102 → 272 → 915 timed elements: render 29.8, 28.0, 29.8, 32.0 s; capture 16.2, 17.3, 16.8, 17.6 s; `check` 7.3, 8.2, 8.9, 10.8 s; lint 0.3, 0.3, 0.4, 0.7 s. At 2 717 elements: render 36.3 s (capture 20.2 s, a quarter more), `check` 16.9 s, lint 1.5 s. A 30 s speech video needs about 100 timed elements. A 3× denser caption track costs nothing that can be measured here; one caption element per frame costs about 2 s of render and 3 s of `check`.
- **Pixels and frames are the cost.** The same montage at 1080×1920 (2.25 times the pixels): 49.8, 52.1, 63.3, 109.8 s. Neighbouring runs: 52.1 s against 28.0 s at 720p (capture 26.6 s against 17.3 s, encode 22.6 s against 7.4 s). On this loaded machine a 30 s speech video rendered in one to two times its own length at 720p and in two to four times at 1080p. The sound-only compositions (an empty 180×320 page, the same 903 frames) still took 13–27 s (capture 10–17 s): most of the capture time is a price per frame, not per element.
- **`check` is paid per sample time.** Nine samples (the default): 7–13 s up to 258 captions. With `--at` set to the middle of every caption state, card and inset (90 sample times; `--at` replaces the default nine): 31.7 s at 1× and 35.8 s at 3× (one run each, heavy load), about 0.3 s per sample. One sample per caption group (28 + 3 here) is enough when the highlight does not change the layout.
- **`check` does not gate a caption that is too long** [ran: `comps/long-720`, the word "ACME." replaced by a 36-character word in one group]. Default samples: not seen, `ok: true`. `--at 14.3` (inside that caption): seen, but as `container_overflow` **warning** and `canvas_overflow` **info**, still `ok: true`, exit 0. `--at 14.2,14.5,14.8`: two warnings, still `ok: true`. Only `--strict` fails (exit 1). In beats mode the text sits directly in its box and the same mistake is the error `text_box_overflow` (revision §1, not run again here); here the words are `<span>`s. The adapter must treat `container_overflow` and `canvas_overflow` as failures itself, or `compose` must refuse a line it cannot fit.
- Transcription: 2.2–2.8 s per segment, 7.6 s for the three. Lint: 0.3–1 s up to 258 captions, 1.5 s at 2 703.

### 3.2 Sync over the 30 s

**Picture: frame-exact** [ran: `node verify.mjs <name>` on `speech-720`, `speech-1080`, `d3-720`, `dframe-720`, `dframe3-720`, `dframe-1080`; the 1080p renders are scaled to 720×1280 for reading]. Every one of the 903 output frames is decoded and its frame code read, full frame and inside the inset window: **0 wrong frames in all six renders.**

| Piece | Output frames | Source frame on the first / last of them | Wanted |
|---|---|---|---|
| s1, before the inset | 0–167 | 0 / 167 | 0 / 167 |
| s1, in the window (`data-media-start` 5.6 s) | 168–259 | 168 / 259 | 168 / 259 |
| s1, after the inset (`data-media-start` 8.67 s) | 260–360 | 260 / 360 | 260 / 360 |
| s2 | 361–630 | 0 / 269 | 0 / 269 |
| s3 | 631–902 | 0 / 271 | 0 / 271 |

The evidence still is on screen on frames 168–259 and no other, the window likewise, the cards on 362–521 with the change of image on 449: all exact.

**Sound: within 0.33 ms, no drift** [ran: `node audio.mjs sync out/speech-720.mp4` and `…speech-1080.mp4`]. The output sound is cross-correlated with the original sample in 0.5 s windows at the start and the end of every segment and at every second (the three segments end to end are the original, so the right answer is a lag of 0 everywhere).

| Where | Lag at 720p | Lag at 1080p |
|---|---|---|
| s1 first / last 0.5 s | 0.01 / 0.00 samples | 0.01 / 0.00 |
| s2 first / last 0.5 s | −15.97 / −15.98 samples (−0.333 ms) | −15.97 / −15.98 |
| s3 first / last 0.5 s | −16.01 / −16.01 samples (−0.334 ms) | −16.02 / −15.99 |

The lag is the same at the start and at the end of each segment: nothing drifts. The 16 samples are explained [read: `buildTrackInputFilter`]: the mixer places each track with `adelay=round(start × 1000)` milliseconds, so s2 (12.0333… s) starts at 12 033 ms. **Any audio start is rounded to a whole millisecond: worst case ±0.5 ms, 1/67 of a frame.** Output streams [ran: ffprobe]: video 903 frames, 30.100 s, start 0; audio 30.100 s, start 0.

### 3.3 Caption timing

[ran: `node verify.mjs <name>`; the highlight colour is searched inside the caption box on every frame.]

- **88 changes of the active word wanted, 88 seen, each on the wanted frame: worst case 0 frames.** The same with 258 caption elements (3×), 901 (one per frame, at 720p and at 1080p) and 2 703 (three tracks of one per frame).
- A caption is on screen on 901 of the 901 wanted frames: windows written back to back leave no empty frame and no doubled one, even at one element per frame.
- The frame against the aligned time: median 6.7 ms; 85 of 88 words within half a frame (16.7 ms); worst 43 ms ("tried", pushed one frame by the 2-frame minimum; 3 words were pushed).
- 6 of the 88 states are shorter than 3 frames, the median is 9 frames, the longest 40.

So the renderer adds nothing. **The error of a caption is the error of the recogniser's word time** (§3.4), which is larger by an order of magnitude.

### 3.4 Alignment

[ran: `node align-report.mjs` → `out/align-report.json`]

| | s1 | s2 | s3 |
|---|---|---|---|
| Script words | 38 | 22 | 28 |
| Heard words | 39 | 24 | 28 |
| Script words with a heard time | 38 | 22 | 28 |

- **88 of 88 script words got a heard time.** The recogniser's errors on this clip, all absorbed: "lash" heard as "last", "Lashly" as "Lash Lee", "ACME" as "Ack Me", an extra "an" ("before and an after"); in the earlier whole-clip transcript also "tried" as "try" and "shea" as "Shay".
- The two extra moves matter for marks. With the plain three-move alignment the count is still 88 of 88, but "Lashly" and "ACME." take the time of "Lash" and "Me" only: their starts are 0.32 s and 0.34 s late (10 frames). A card or a highlight on a brand name would come 10 frames late.
- **Timing error that can be judged from the audio.** The level (10 ms RMS windows) rises above −24 dBFS after at least 100 ms below −30 dBFS at 26 places; 22 of them lie within 100 ms of a word start in one of the two transcripts and are taken as that word's true start (the other 4 are inside words). Against these 22 the per-segment transcript is off by 13 ms in the median, 14 are within one frame (33 ms), the worst is **190 ms** ("Let", placed inside the pause before it). The whole-clip transcript of the earlier spike: median 30 ms, worst **330 ms** ("jojoba,"). Judged from the level, not by ear; a word that both transcripts place more than 100 ms wrong is not in this sample, so the worst case is a lower bound.
- **The recogniser does not repeat itself.** The same 88 words timed from the three segments and from the whole clip differ by 43 ms in the median, 130 ms at the 90th percentile, 323 ms at most; 14 words differ by more than 100 ms.
- **It reports almost no pauses.** A word's `end` mostly runs up to the next word's `start`: the largest gap between two aligned words is 0.23 s, while the audio has a 0.31 s pause (3.47–3.78 s). Rules that look for a pause (ducking, "new caption group after 0.35 s") almost never fire on these timings.
- **A word that was not heard** (each heard word removed in turn): when its removal leaves a hole, the script word lands 0 ms off in the median, 90 ms at the 90th percentile, 195 ms at most (80 cases). When the word before swallows it, as a recogniser does: 26 ms median, 170 ms at the 90th percentile, 230 ms at most (78 cases).
- **A clip that says something else.** Script s2 against the sound of s3: 22 of 22 words still get a time, but only 4 are paired with a word at least half alike; the other two wrong pairs give 4 of 38 and 8 of 28. The right clips give 38 of 38, 22 of 22, 28 of 28.

### 3.5 Audio

Sound-only compositions (`audiocomp.mjs` → `comps/a-*`, 180×320, the same `<audio>` elements) were rendered for these measurements [ran: `./batch2.sh`]. They are a fair stand-in: the sound of the full montage and of `a-full` are equal sample for sample (difference −240 dB) [ran: `node audio.mjs gains out/speech-720.mp4`].

**Levels** [ran: `node audio.mjs levels …` = ffmpeg `volumedetect` and `ebur128=peak=true`]

| | mean | max | integrated | true peak |
|---|---|---|---|---|
| the original sample | −20.8 dB | −1.6 dB | −17.4 LUFS | −1.6 dBFS |
| voice only, the three segments (`a-voice`) | −20.9 | −1.6 | −17.4 | −1.6 |
| the music file | −14.3 | −0.2 | −12.4 | −0.1 |
| music only at lane 0.1 (`a-music`) | −34.3 | −20.1 | −32.5 | −20.1 |
| the mix (`a-full`, `speech-720.mp4`) | −20.7 | −1.7 | −17.4 | −1.7 |
| the mix after our own loudness pass (below) | −17.6 | −1.3 | −14.4 | −1.3 |

**Speech and music inside the mix** [ran: `node audio.mjs gains`]. The level of a source inside a render is its projection on the source (`<source, render> / <source, source>`), so the other sound does not disturb the reading.

| | Speech s1 / s2 / s3 | Music pass 1 / pass 2 (lane asks −20.00 dB) |
|---|---|---|
| alone, sound taken from the mp4 | −0.03 / −0.04 / −0.05 dB | −20.02 / −20.03 dB |
| alone, sound taken from a wav | −0.03 / −0.03 / −0.03 dB | |
| in the mix | −0.04 / −0.05 / −0.06 dB | −20.07 / −20.08 dB |

Mix minus voice-only minus music-only leaves −47.3 dBFS against a mix of −17.7 dBFS: 30 dB down, the noise of three separate AAC encodings. **The mixer adds, and nothing else.** [read: `mixAudioTracks`] Every track is trimmed, delayed, padded to the full length, then `amix` and `volume=N` undo each other: a plain sum, in float. There is no limiter and no loudness step: peaks add (not a problem here: −1.7 dBFS), and the loudness is whatever the clips bring (−17.4 LUFS here).

**The −0.9 dB shift of revision §1 point 6 does not appear** [ran: `node audio.mjs tone`]. A 1 kHz tone with a lane at 0.9, levels against the tone file:

| | Tone level |
|---|---|
| alone | −0.92 dB (20·log 0.9 = −0.915) |
| with a second `<audio>` from an mp4 (`data-media-start` 2 s) on 2–8 s: before it / under it / after it | −0.92 / −0.96 / −0.92 dB |
| lane 0.1 under the three voices (1–11 s / 13–20 s / 22–29 s) | −20.11 / −20.10 / −20.15 dB |
| `data-volume="0.1"`, no lane | −20.01 dB |

The second audio itself sits at −0.04 dB and at a lag of 0 samples. One trap, possibly the source of the earlier reading [assumed]: speech has energy at 1 kHz, so a level read straight off a mix that contains speech was wrong by 0.2 dB at this tone level and by up to 0.8 dB at the low one (raw readings: −1.15 dB; −20.87 / −20.80 / −19.43 dB). The numbers in the table are taken after the speech is removed (its source, or the voice-only render, subtracted).

**Does the music loop join without a click?** [ran: `node audio.mjs loop a-music`; a 450 Hz tone that holds a whole number of periods in the loop, so an exact join is invisible]

| Loop | Pass starts at | Phase jump at the three joins | What is left at the join when the tone is taken away |
|---|---|---|---|
| 120 frames (4 s), wav | 4, 8, 12 s: whole milliseconds | −0.03, −0.01, 0.01 samples | −39 … −49 dB (elsewhere −47 … −56 dB): clean |
| 120 frames, mp3 | the same | 0.03, 0, 0 samples | −36 … −44 dB (elsewhere −40 … −54 dB): clean |
| 100 frames (3.33 s), wav | 3.3333 s → 3.333, 6.6667 s → 6.667, 10 s | +16, −32, +16 samples | −0.8, **+4.2**, −0.8 dB: as loud as the tone itself; at the second join a hole of 32 samples (the level drops to −51 dB) |

- **A loop made of several `<audio>` elements joins exactly only when every pass starts on a whole millisecond** (the same rounding as in §3.2). Otherwise passes overlap or leave a hole (16 and 32 samples measured; up to 24 and 48 follow from the rounding): a click. At 30 fps only every third frame is a whole millisecond.
- The real bed (`a-music`, join at 26.033 s): **no click** (the largest sample step near the join is −85 dB), but for another reason: the bed ends in silence. It fades out over its last 3.5 s (from −13 dB to −60 dB). Looped as it is, the music is gone from second 23 to 26 and then starts again. The same hole is there when ffmpeg loops the file with a 0.5 s crossfade (`a-single`, `assets/music-looped.wav`).
- So looping "a bed with an ending" is a musical cut (drop the outro, crossfade before it), not a mechanical one. The simple way out: **ask for the music after the clips are measured, at least as long as the video, and only trim and fade it.** It needs no loop at all, and the step order allows it (the music depends on nothing).

**Is ducking possible inside HyperFrames?** Yes, as volume-lane points, and exactly [ran: `node audio.mjs lane a-lane-40 a-lane-200 a-lane-512 a-lane-600`; a tone stepped between 0.5 and 0.1].

| Lane | Rendered against asked |
|---|---|
| 40 points, a step every 0.6 s | within 0.09 dB on the flat parts, 0.19 dB on the 50 ms ramps, 0 ms offset |
| 200 points, a step every 0.12 s | the same |
| 512 points, a step every 47 ms | follows (worst 0.95 dB, on 23 ms ramps read with 5 ms windows) |
| 600 points | follows up to point 512 (10.22 s), then the gain stays at that point's value to the end: up to 14 dB wrong. **Cut silently, no warning** |

- [read: `applyVolumeEnvelopeToWav`] The lane is written into the track's samples one by one, linearly between points; the 32-segment limit in the code only applies to a fallback path.
- What we do not get for free is the decision *where* to duck. The word times show no pause of 0.3 s in this script (§3.4), so a pause rule produces a flat lane: `node build.mjs duck-720 --music duck` writes exactly three points. For jump-cut talk a constant gain is the right answer.
- HyperFrames' own "voiceover carve" (the bed follows the voice by itself) needs `@hyperframes/core` as a project dependency, which is not installed: **not tried**.

**Effects on a bus** [ran: `a-limiter`, `a-busgain`]. All five tracks on one `<hf-audio-group>`: a `gain` of −12 dB on the bus gives −12.0 dB (mean −32.7, max −13.6). A `limiter` with `limit: −6` on the same bus renders without error or warning and **does not limit**: the peak stays at −1.6 dBFS. Cause not established. Peak control cannot be left to this.

**Our own pass, when a loudness target or a peak ceiling is wanted** [ran]:

```bash
ffmpeg -i out/speech-720.mp4 -map 0:v -c:v copy -map 0:a \
  -af "volume=3.4dB,alimiter=limit=0.841:attack=5:release=50:level=false:latency=true" \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart out/speech-720.loud.mp4
```

2.6 s; the video stream is byte-identical (same MD5 of the copied packets); −14.4 LUFS, true peak −1.3 dBFS; sync unchanged (0 / −16 / −16 samples). Without `latency=true` the limiter delays the sound by 239 samples (5 ms): measured.

**Answer to "inside HyperFrames or our own ffmpeg":** the mix itself (voices at 1, music at a fixed gain, a fade, lanes up to 512 points) can stay inside HyperFrames: it is a plain sum and the levels are right to 0.1 dB. Ours are two things around it: the music's length (before composing), and, only if we want a loudness target or a peak ceiling, one ffmpeg pass over the finished file.

---

## 4. What breaks: every warning, wrong frame and limit met

No wrong frame was produced by any render. The list:

1. **`box-shadow` and `border` on a `<video>` are not rendered** [ran: the first render showed the window with round corners but without its ring and shadow]. [read: `MEDIA_VISUAL_STYLE_PROPERTIES`, `dist/chunk-2WKWEB4T.js`] The renderer hides the `<video>` and shows an `<img>` with the extracted frame; only these properties are copied to it: size and position, `object-fit`, `object-position`, `z-index`, `opacity`, `visibility`, `filter`, `mix-blend-mode`, `backdrop-filter`, `border-radius`, `overflow`, `clip-path`, `mask*`, `transform*`, `translate`, `rotate`, `scale`, `box-sizing`. Fix used: a timed `<div>` with the same box and window under the video carries the ring and the shadow (one more timed element per inset).
2. **Lint warning `timeline_track_too_dense`** on the first build: "Track 5 has 88 timed elements". [read] It fires above 3 timed non-media elements with one `data-track-index`; elements whose class or id is `caption`, `caption-word|group|line|block|cue|text`, `subtitle…` or `cg-…` are exempt. With the class `caption` on the caption elements: 0 errors, 0 warnings [ran].
3. **Lint warning `composition_file_too_large`** above 300 lines outside `<style>` [ran: the one-element-per-frame builds; the 3× build has 293 such lines and stays clean]. A warning only: `check` is still `ok: true`, the render goes on. Writing several elements on one line avoids it.
4. **Audio starts are rounded to milliseconds** (§3.2), and so are the joins of a loop (§3.5).
5. **The recogniser's word times are the weak part** (§3.4): single words up to 0.19–0.33 s wrong, different from run to run, almost no pauses.
6. **`check` finds a caption that is too long only where it samples** (§3.1): the default nine sample times miss it.
7. **A pause-based ducking rule finds nothing** in this script (§3.4, §3.5).
8. **The stand-in footage is a finished video** with burned-in captions, cards and an inset. It is good enough to measure with; it is not what a speaker clip looks like.
9. **A volume lane is cut silently after 512 points** (§3.5): the gain then stays at the last kept value. No lint finding, no render warning.
10. **A loop made of several `<audio>` elements clicks** unless every pass starts on a whole millisecond (§3.5). **A bed with a fade-out cannot be looped mechanically at all**: the music disappears for three seconds.
11. **A `limiter` on an `<hf-audio-group>` did nothing**, without error (§3.5).
12. **The mixer has no limiter and no loudness step** [read]: peaks add, and the output is as loud as its inputs.
13. **`alimiter` in our own pass delays the sound by 5 ms** unless `latency=true` is set (§3.5).
14. **A level read off a mix that contains speech is unreliable**: off by up to 0.8 dB at a low music level (§3.5). Measure the parts, or project on the source.
15. **Timings on this machine today are upper bounds** (§3.1): load average 16–39 the whole time.

---

## 5. What the editor's document must be able to say for this format

Derived from what the build needed. Names are proposals; the schema is the owner's and the document-format spike's call.

**Script**
- `segments: [{ id, lines }]` in speaking order, one presenter clip each. No `at` / `for`: a segment's length is its normalised clip's frame count, known only after generation.
- Marks `[name]…[/name]` inside `lines` (names `[a-z0-9-]+`, may nest, each name once). The prototype lets a mark run across a cut; windows are computed on the whole word stream. A fill that loses a mark is an error (already in the plan).
- A trim rule per segment ("keep N frames before the first word and after the last"), because generated speaker clips start and end with silence. The mechanism (`data-media-start` on the picture and on the sound) is proved; the rule itself was not needed for the stand-ins and is **not tried**.

**Things that hang on a mark** (each names its `mark`)
- `card`: `image` (`product:N`), `box` in percent, look (background, radius, ring).
- `inset`: the full-frame `image`, the presenter's `window` box, radius, ring. Keep the window's aspect equal to the canvas, then nothing is cropped. The composer cuts the presenter clip at the window's edges itself; the document only names the mark.
- `text`: a label on a mark (the "WEEK 0" of `lashly-01`): today's text, with `mark` in place of `at` / `for`.
- One end rule for all three: "to the first word after the mark; when that word starts more than 12 frames after the mark's last word, or there is none, to the end of the last word". Offsets (`lead`, `tail` in frames) are an obvious later addition; not needed here.

**Evidence stills**
- `stills: [{ id, prompt, references }]`, used as `inset.image: "still:<id>"`. They are generated images: `paidFor` for speech = 1 presenter still + the stills.

**Captions**
- `style` (font, size, weight, fill, shadows), `highlight` (the active word: background or fill), `box` in percent.
- Grouping: `maxWords` 4, `maxLines` 2, break after a sentence end, after a comma from two words on, after a pause over 0.35 s, at a cut.
- Timing: `minFrames` 2 per word, `hold` 6 frames after the last word, `join` 12 frames (bridge to the next group).
- The greedy rule left 4 one-word groups out of 28 ("weeks.", "zero.", "nothing.", "four."). Splitting a sentence evenly instead is a change in `compose`, not in the document.
- Rule for the composer, not the document: one leaf element per word state holding the whole group; the highlight must not change the layout (same padding on every word), so one layout check per group covers all its states.

**Sound**
- Voice: each segment's own sound at gain 1, one `<audio>` per segment.
- Music: `gain` (0.1 here) and `fadeOut` in frames. No `loop` in the first version: `produce` asks for the music after the clips are measured, at least as long as the video, and trims it; the composition gets one `<audio>`. If a loop is ever wanted, it is an ffmpeg step of `produce` (cut the outro, crossfade), never several `<audio>` elements (§3.5).
- Ducking: a list of lane points, computed from the word times. Not needed for jump-cut talk (no pause of 0.3 s in this script); keep the field out of the first version.
- An optional `loudness` target for the finished file (our own ffmpeg pass, §3.5).

**What `timeline.json` must carry for speech** (the frame table the tests and the check use)
- `segments [{ id, at, for }]`, `pieces [{ id, segment, at, for, offset, inset }]`, `words [{ text, start, end, heard, frame }]`, `captions [{ id, group, word, at, for }]`, `marks { name: { at, for } }`.
- `alignment { similar, of }` per segment: how many script words were paired with a heard word that is at least half alike (similarity ≥ 0.5). It is the only automatic sign that a paid clip did not speak its lines (§3.4: 100 % for the right clip, 11–29 % for a wrong one); `produce` should stop below a threshold (about 70 %) instead of rendering wrong captions. "Got a heard time" is **not** that sign: a wrong clip still pairs most words.

---

## 6. Still unproved

- **A generated speaker clip.** The stand-ins are cut from a finished video. Whether a paid clip speaks its lines, how well the recogniser times generated speech, and whether its own lips match its own sound are untouched. We only prove that what a clip brings is kept.
- **Nobody listened.** Every statement about sound is a measurement (correlation, projection, level, phase). Clicks, the music hole and the loudness pass were not judged by ear.
- **Word times better than the recogniser's.** `small.en` through `hyperframes transcribe` is the only recogniser tried. `large-v3` (cached), Parakeet (`hyperframes models install parakeet`, not installed) and WhisperX were not compared. Whether an error of 0.2–0.3 s on single words is visible in word-by-word captions was not judged by eye either.
- **Motion.** The inset is a hard switch and cards appear without a move. A shrink, a pop-in or a per-word animation needs CSS keyframes or Web Animations under `data-no-timeline`: not tried (the motion spike's question).
- **Trimming the silence at the head and tail of a segment**, and cuts that fall inside sound instead of a pause (the ±0.5 ms rounding then overlaps or opens the sound at the cut).
- **Length and shape:** more than 30 s, more than three segments, 60 fps, a clip whose sound is mono or 44.1 kHz (the mixer converts to 48 kHz stereo [read], not measured), a non-Latin script in captions.
- **HyperFrames' voiceover carve and effect chains** beyond one bus gain and one limiter.
- **Times on a quiet machine**, Docker mode, a render started by `launchd`.
- **A loop that sounds right.** Only the mechanics are measured; where to cut a bed's outro is not solved.

---

## 7. Files and how to run it again

All in `spike/viraleditor-speech/` (plain `.mjs`, Node 25, no dependency of its own; the CLI is the one of `spike/viraleditor-render/node_modules`).

| File | What it does |
|---|---|
| `prep.mjs` | cuts and normalises the three stand-in clips (720 and 1080), burns the frame code, prepares the music, test tones and images |
| `script.txt` | the script with marks |
| `align.mjs` | `alignWords` (pure) |
| `timeline.mjs` | `parseScript`, `buildTimeline`, `seconds` (pure) |
| `build.mjs` | writes `comps/<name>/index.html` and `timeline.json` |
| `audiocomp.mjs` | writes the sound-only compositions `comps/a-*` |
| `run.mjs` | lint, check, render with wall times → `out/times.jsonl`, `out/<name>.*` |
| `verify.mjs` | reads every frame of a render: frame code, still, window, cards, caption highlight → `out/<name>.verify.json` |
| `audio.mjs` | `sync`, `levels`, `gains`, `tone`, `loop`, `lane` → `out/audio-*.json` |
| `align-report.mjs` | alignment accuracy → `out/align-report.json` |
| `times.mjs` | the table of §3.1 from `out/times.jsonl` |
| `batch1.sh`, `batch2.sh`, `batch3.sh` | the runs of this report, one render at a time |

```bash
cd spike/viraleditor-speech
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1
node prep.mjs
for s in s1 s2 s3; do ../viraleditor-render/node_modules/.bin/hyperframes transcribe assets/720/$s.mp4 -d out/tr-$s --engine whisper --model small.en --language en --json; done
node align-report.mjs
node build.mjs speech-720 && node run.mjs speech-720 && node verify.mjs speech-720 && node audio.mjs sync out/speech-720.mp4
node build.mjs speech-1080 --size 1080 && node run.mjs speech-1080 && node verify.mjs speech-1080
./batch1.sh && ./batch2.sh && ./batch3.sh
node audio.mjs levels work/original.wav out/a-voice.mp4 out/a-music.mp4 out/a-full.mp4 && node audio.mjs gains out/speech-720.mp4
node audio.mjs tone && node audio.mjs loop a-music && node audio.mjs lane a-lane-40 a-lane-200 a-lane-512 a-lane-600
node times.mjs
```

Two compositions were made by hand from others, with `sed`: `comps/long-720` (from `speech-720`: `s/ACME\./ACME-ACME-ACME-ACME./g`, then `hyperframes check --no-contrast --json [--at 14.3] [--strict]`) and `comps/a-busgain` (from `a-limiter`: the limiter node replaced by `{"type":"gain","id":"n1","params":{"gain":-12}}`).

The finished montages: `out/speech-720.mp4` (24 MB), `out/speech-1080.mp4` (44 MB) and `out/speech-720.loud.mp4` (after the loudness pass), with the frame code visible on the top edge. Frames to look at: `out/frames/sheet-720.jpg`, `out/frames/sheet-1080.jpg`.
