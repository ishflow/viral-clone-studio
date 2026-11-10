# viraleditor speed 2 (task C3): the animated 30 s 1080×1920 render

Date 2026-10-04, 19:30 to 21:25. HyperFrames 0.8.120, ffmpeg 8.1.1, Chrome headless shell 152, the Mac of the first spike. Work folder `spike/viraleditor-speed2/` (git-ignored): `make.ts` (the test documents), `bench.sh` / `round1.sh` / `round2.sh` (CLI-level runs, rows in `results.tsv`), `run.ts` / `e2e.sh` (runs through `createRenderer`, rows in `e2e.tsv`), `q1.sh` / `cmp.sh` / `q.sh` (quality, `quality.tsv`, `final.tsv`, `repeat.tsv`), `detect.ts`, `crop.sh`, logs in `logs/`.

**Result in one paragraph.** A new path, `createRenderer({ encode: 'hardware' })`, renders the animated 30 s 1080×1920 test in **59.2 s at load 30→34 and 39.6 s at load 47→40**, where today's path took **173.2 s and 213.9 s** in the same interleaved rounds; at load 130→69 it took 116.0 s (today's path: 241.0 s). So the 60 s target is met up to a load of about 45, without margin at load 30, and **not met on a machine at load 70 or more**. The default is **not** switched: the hardware-encoded file passes the five checks of the brief, but the project's freeze detector reads it differently (section 7). Nothing below was measured on a quiet machine: the load was 7 to 136 the whole time and changed inside single runs.

**Load caveat.** Every number has its 1-minute load average before→after the run (`uptime`). Other agents rendered all evening; the load average does not show contention for the GPU. The same command at the same load average varied by a factor of 1.7 (hardware, 4 workers: 33.5 s and 58.0 s at load 21 to 27). Conclusions rest on interleaved rounds, not on single rows.

## 1. The test compositions (built with our editor)

`make.ts` writes an edit document and runs `compose` + `writeComposition`. `comp-1080-30`: 900 frames, 1080×1920, 15 shots of 2 s, a motion on every shot (push-in, pull-out, punch-in), a transition on 14 cuts (cut, crossfade, whip, push), 10 texts with enter and exit (one every 3 s), 24 caption words over frames 300 to 540, one card with a push-in, music, master −14 LUFS / −1 dBTP; 121 animations in `timeline.json`. `comp-720-8`: 240 frames, 720×1280, 4 shots, 48 animations. Footage: the normalised clips of `spike/viraleditor-speed/pool-*`. `hyperframes lint`: 0 errors, 0 warnings for both. The frame cache was cold in the first run only (extract 4.7 s), warm (0.0 s) in every other.

## 2. Baseline: today's path (4 workers, `looks` = libx264 CRF 16 in the CLI, then the loudness pass)

CLI only (`bench.sh`), wall seconds [load before→after], capture / encode stage:

| Run | Wall | Load | Capture / encode |
|---|---|---|---|
| base-0 | 58.2 | 6.9→11.3 | 24.2 / 25.9 (extract 4.7 cold) |
| r1 | 149.5, 87.8 | 18→36, 87→35 | 59.7 / 81.8, 34.9 / 45.8 |
| r2 | 81.8, 104.8 | 7→21, 20→24 | 31.7 / 46.1, 36.7 / 61.5 |
| r3 | 75.0, 125.7 | 22→27, 25→29 | 39.8 / 28.2, 40.3 / 76.7 |
| r4 | 170.8, 148.2 | 43→36, 33→33 | 52.9 / 101.2, 56.8 / 78.1 |

End to end through `createRenderer` (CLI + probe + loudness + gain pass + second probe), six rounds: 96.0 [18.4→18.1], 106.8 [15.9→22.9], 73.8 [23.5→22.6], 173.2 [29.7→29.8], 241.0 [35→130], 213.9 [136→47]. **Finding:** after the CLI, today's path spends 13.5 to 82 s more: probe 5.0 to 25.1 s, loudness 1.3 to 4.4 s, gain 0.6 to 3.1 s, second probe 6.4 to 51.8 s. `measure.streams` decodes the whole picture to count frames (twice: before and after the gain pass) and `measure.loudness` decodes the picture a third time although it only needs the sound.

The libx264 encode stage is the load-sensitive one: 25.9 s at load 7, 46 to 101 s at load 20 to 43. Capture: 24.2 s at load 7, 32 to 57 s at load 20 to 43.

## 3. The CLI's own hardware encode (`--gpu`), 4 workers

| Run | Wall | Load | Capture / encode |
|---|---|---|---|
| `--gpu` (CLI default bitrate, 10 Mbit/s) | 35.9, 33.2 | 35→21, 12→9 | 24.6 / 5.2, 24.9 / 5.1 |
| `--gpu --video-bitrate 18M` | 37.5, 58.0, 33.5, 71.7 | 9→7, 21→21, 27→18, 36→33 | 27.0 / 6.7, 36.9 / 12.2, 24.0 / 4.7, 42.6 / 16.2 |
| `--gpu --video-bitrate 75M` | 32.9, 32.2 | 29→19, 19→12 | 24.4 / 5.0, 23.6 / 5.1 |

The encode stage falls from 26 to 101 s to 5 to 16 s. Two faults of the CLI's `--gpu` as it comes: (a) at its default bitrate the picture is 1.8 dB under today's (section 6); (b) the file carries the BT.709 matrix but **no primaries and no transfer tag** (`color_transfer=unknown`, `color_primaries=unknown`). It also puts a keyframe every 12 frames (ffmpeg's default for that encoder; the CLI has no flag for it).

## 4. Cheap intermediate + our own final encode in the loudness pass

| Intermediate from the CLI | Result |
|---|---|
| `--quality draft --crf 6` | 33.0 s [21→15], 400 MB. **Fails:** PSNR 47.81 dB against the lossless reference, under today's finished file (48.71) before any second encode. Cause (read in the CLI's bundle): `draft` captures the frames as JPEG quality 80, every other quality as 95. |
| `--format mov` (ProRes 4444) | 720p 8 s only: **105.6 s** [32→25] (capture 87.2 s: PNG capture), 196 MB. **Fails on speed.** Not run at 1080p. |
| `--format png-sequence` | not measured (same PNG capture as `mov`). |
| `--gpu --video-bitrate 75M` | 32 to 33 s, 269 MB, PSNR 54.60 dB avg / 51.34 min. Usable. |

Our final encode from the 75 Mbit/s intermediate (decode + encode + gain + AAC in ONE ffmpeg pass, a keyframe every 30 frames), seconds [load]: h264_videotoolbox 12M 5.9 [6.9] · 18M 5.8 [10.2] · 24M 6.3 [10.3] · constant quality q60 5.4 [10.7] · q70 5.8 [10.8] · q76 6.3 [15.1] · q80 8.5 [25.3] · q84 7.2 [26.7] · libx264 veryfast CRF 16 10.3 [9.9], 10.5 [15.4]. From today's file at load 75 to 82: videotoolbox 6.4 s, libx264 veryfast 21.6 s, libx264 faster 35.1 s. The hardware pass barely feels the load; libx264 does.

This variant was built first (intermediate + our q82 pass, the delivered file probed with `measure.streams`) and measured end to end against today's path: **74.1 / 71.0 / 40.8 s** [18→13, 23→26, 23→14] against 96.0 / 106.8 / 73.8 s. It was replaced (section 5) because it is slower by the second pass (4.7 to 7.0 s) and by the decoding probe (5.4 to 13.7 s), and its picture is not better at equal size (section 6: 48.35 dB at 18 Mbit/s against 48.66 dB for the CLI's single hardware encode). The quality of q82 itself was not measured (q80 and q84 were).

## 5. Workers, capture path, other switches

**The fast capture (drawElement) does not engage on our compositions.** With 1 worker, and with `--experimental-fast-capture` at 4 workers, the CLI logs `fast capture: falling back to screenshot capture — css-animation detected (drawElementImage cannot reproduce it; see fast-capture-limitations.md)`. Every animated render here is screenshot capture. `--experimental-fast-capture`, 4 workers: 76.7 s [66→37], same frames as the baseline (0 of 900 checksums differ). With `HF_DE_PARALLEL_STREAM=true` as well: 56.2 s [15→42], same fallback.

Workers (wall [load]):

| Workers | libx264 `looks` | hardware 18M, three rounds |
|---|---|---|
| 1 | 128.8 [36→79] (one run) | 84.1 [27→22], 111.8 [48→43], 113.4 [34→31] |
| 2 | 127.7 [79→66] (one run) | 65.4 [24→20], 72.7 [19→25], 95.0 [34→33] |
| 4 | section 2 | 58.0 [21→21], 33.5 [27→18], 71.7 [36→33] |
| 6 | not measured | 54.5 [24→24], 82.6 [29→34], 85.6 [33→32] |

4 workers stays: 1 and 2 are slower in every round, 6 is slower in two of three. 8 workers: not measured.

**Encode while capturing** (`HF_CAPTURE_PARALLEL_STREAM=true`, not in `render --help`; the CLI prints the name when it is on, and it is this version's default on Linux): with more than one worker the frames go to the encoder during capture instead of to disk first. Same frames (0 of 900 differ, libx264 and hardware).

| Round | libx264: off → on | hardware: off → on |
|---|---|---|
| r1 | 149.5, 87.8 → 79.1 [37→87] | 35.9 → 37.5 [42→29] |
| r2 | 81.8, 104.8 → 75.8 [24→27] | 58.0 → 44.0 [21→24] |
| r3 | 75.0, 125.7 → 152.0 [34→48] | 33.5 → 34.4 [18→19] |
| r4 | 170.8, 148.2 → 124.0 [32→34] | 71.7 → 59.1 [33→34] |

Hardware: equal within 1.6 s in two rounds, 12.6 and 14.0 s faster in the two rounds where the separate encode stage had been slowed to 12 to 16 s. Used on the hardware path. libx264: faster in three rounds of four; not applied (the default path was to stay as it is).

## 6. The five checks

Reference: the same composition rendered with `--quality looks --crf 0` (libx264 lossless of the same captured frames, 72.2 s). PSNR is the mean of the per-frame `psnr_avg`; 900 frames compared in every row.

| File | MB | Mbit/s | PSNR avg | PSNR min (frame) | SSIM avg | SSIM min (frame) |
|---|---|---|---|---|---|---|
| **today: libx264 CRF 16** | 46.9 | 12.5 | **48.71** | **46.53** (190) | 0.99141 | 0.98740 (359) |
| **hardware path as built: CLI hardware 18M** | 65.1 | 17.4 | **48.66** | **44.12** (191) | 0.99189 | 0.98650 (189) |
| CLI hardware, its default 10M | 36.5 | 9.7 | 46.89 | 40.47 (191) | 0.98920 | 0.97577 (189) |
| CLI hardware 75M (intermediate) | 269.3 | 71.8 | 54.60 | 51.34 (667) | 0.99723 | 0.99509 (886) |
| ours from 75M: hardware 12M | 43.6 | 11.6 | 47.33 | 41.94 (191) | 0.98988 | 0.98130 (189) |
| ours: hardware 18M | 65.0 | 17.3 | 48.35 | 44.14 (191) | 0.99147 | 0.98655 (856) |
| ours: hardware 24M | 86.4 | 23.0 | 49.11 | 45.21 (191) | 0.99248 | 0.98835 (856) |
| ours: hardware q76 | 33.5 | 8.9 | 47.67 | 45.95 (666) | 0.98931 | 0.98425 (860) |
| ours: hardware q80 | 47.8 | 12.7 | 48.38 | 46.75 (666) | 0.99052 | 0.98600 (860) |
| ours: hardware q84 | 83.7 | 22.3 | 49.61 | 48.14 (189) | 0.99244 | 0.98913 (860) |
| ours: libx264 veryfast CRF 16 | 46.1 | 12.3 | 47.66 | 45.32 (190) | 0.99000 | 0.98435 (869) |
| CLI `draft --crf 6` | 400.3 | 106.7 | 47.81 | 45.76 (668) | 0.99096 | 0.98813 (338) |

1. **Frame accuracy: pass.** No frame of the hardware path is under 44.1 dB against the reference; a moved frame would be under 30. The worst frame is the same for every encoder (189 to 191, the end of a push transition): the hardest picture, not a shifted one. The frame bar of the fixture reads the expected source frames (render test).
2. **Repeatability: pass, bit for bit.** Three renders through `createRenderer({ encode: 'hardware' })` at loads 30, 130 and 47: 0 of 900 frame checksums differ; 720p: 0 of 240. Also 0 of 900 between: two CLI hardware renders at 75M, two of our hardware encodes (18M, q80), hardware with and without encode-while-capturing, the file before and after our copy pass. libx264: 0 of 900 across 1, 2, 4 workers, fast capture and encode-while-capturing. So the hardware encoder is repeatable on this machine; other machines and OS versions were not tested.
3. **Quality: average equal, worst frame 2.4 dB lower, file 39 % larger.** For the controller: crops at 200 % (nearest neighbour) of a text edge (frame 40) and a footage area (frame 75): `spike/viraleditor-speed2/crops/baseline-text.png`, `hardware-text.png`, `baseline-detail.png`, `hardware-detail.png`, `ref-text.png`, `ref-detail.png`, and `side-by-side-base-vs-hw18M.png` (left today's, right hardware). I looked at the side by side and saw no difference.
4. **Colour: pass after our pass.** Both paths: H.264 High, yuv420p, `color_range=tv`, space, transfer and primaries `bt709`. Our pass adds the two missing tags without touching the picture (`-c:v copy -bsf:v h264_metadata=…`; 0 of 900 checksums differ).
5. **Sound: pass, same as today.** Both paths: picture 30.000 s, sound 30.016 s (the AAC frame grid), integrated −14.0 LUFS, peak −11.9 dBFS. On the hardware path the loudness is measured on the sound alone (0.3 to 0.6 s at load 30 to 47) and set in the one pass (0.6 to 1.5 s).

## 7. Why the default is not switched: the freeze detector

`measure.frozen` (the `src/quality` check, tuned at −60 dB on libx264 files) on the same 900 frames:

| File | Frozen runs |
|---|---|
| lossless reference | {at 131, for 5}, {at 155, for 4} |
| today's path | {at 130, for 5}, {at 156, for 4} |
| **hardware path as built** | **none** |
| CLI hardware 75M | {at 157, for 4} |
| ours from 75M (q80, q84, 18M, libx264 veryfast) | one run each, at 156 or 157 |

The footage is nearly still on those frames. The hardware encoder leaves more frame-to-frame noise there (mean luma difference 0.22 to 0.24 against 0.10 to 0.13 in the reference) and each keyframe, every 12 frames, is a jump (0.88). `black` reads all files alike (no runs). Until `src/quality` is tuned for hardware files, or rules that these short runs do not matter, a hardware render would pass a check that today's render is held to. That is a ruling for the controller, so the path stays behind its option.

## 8. The path as built, end to end (through `createRenderer`, interleaved with today's path)

`encode: 'hardware'`: the CLI with `--gpu --video-bitrate <0.29 bit per pixel and frame>` (18M at 1080×1920×30, 8M at 720×1280×30), 4 workers, encode while capturing; the sound alone is copied out and measured; one ffmpeg pass copies the picture, completes the tags and applies the gain; the delivered file is checked from its container (0.1 s) instead of by decoding.

| Round | Today's path | Load | Hardware path | Load |
|---|---|---|---|---|
| d, 1080p 30 s | 173.2 | 29.7→29.8 | **59.2** (CLI 57.1, loudness 0.6, pass 1.0, check 0.1) | 29.8→33.9 |
| e | 241.0 | 35→130 | **116.0** (CLI 108.2) | 130→69 |
| f | 213.9 | 136→47 | **39.6** (CLI 37.2) | 46.7→39.8 |
| d, 720p 8 s | 36.8 | 34→30 | 21.8 | 30→35 |
| e | 61.8 | 69→122 | 28.9 | 122→136 |
| f | 33.4 | 40→40 | 24.0 | 40→39 |

Not measured: the path as built below load 30 (CLI-level rows at load 7 to 27 say 33 to 44 s for the CLI part, plus about 2 s of ours); a static composition (1 worker) on the hardware path; any other machine.

## 9. What stays in the way of 60 s with margin, and what I would try next

Everything tried, in order: (1) CLI `--gpu` at its default: fast, fails quality and tags. (2) `draft` intermediate: fails quality (JPEG 80 capture). (3) ProRes / PNG intermediate: fails speed. (4) 75M hardware intermediate + our own encode: works, 41 to 74 s at load 13 to 26, replaced by (5). (5) CLI hardware at 18M + our copy pass + sound-only loudness + container check: 39.6 to 59.2 s at load 30 to 47. (6) 1, 2, 6 workers: slower. (7) Fast capture: refused for CSS animations. (8) Encode while capturing: 12 to 14 s on a busy machine.

What is left is **capture**: 22 to 27 s at load under 20, 30 to 50 s at load 30 to 47, 80 s at load 130; it is Chrome taking 900 screenshots, and no encoder choice touches it. Next, in the order I would try them:

1. **Rule on section 7**, then switch `DEFAULT_ENCODE` to `'hardware'` (one line; the unit tests name their path, one assertion pins the default).
2. **Make the fast capture engage.** It is refused only because the compositions animate with CSS `@keyframes`. Read `fast-capture-limitations.md` of the CLI package (I did not) and see which animation form it accepts; the first spike measured 27.8 s for a static 30 s 1080p render with it, encode included. This is a `src/compose` change.
3. **Take the three decodes out of today's path too** (sound-only loudness, one check instead of two): 13 to 82 s measured here, no output bit changes. Not done: the default path had to stay exactly as it is.
4. **Encode while capturing on the libx264 path**: same frames, faster in 3 of 4 rounds.
5. If the worst frame must match today's: our own constant-quality encode (q84 is above today's on all four numbers) from a 75M intermediate, 5 to 7 s more, and a keyframe distance we choose.
6. A quiet-machine run of sections 2 and 8.
