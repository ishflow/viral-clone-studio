# viraleditor spike S2: render speed

Date 2026-10-04. HyperFrames 0.8.120 (`spike/viraleditor-render/node_modules/.bin/hyperframes`), Apple M5, 10 cores, 24 GB, ffmpeg 8.1.1, Chrome headless shell 152. Work folder: `spike/viraleditor-speed/` (git-ignored; `gen.mjs` composition generator, `pool.sh` footage normaliser, `bench.sh`, `footage.sh`, `still.sh`, raw rows in `results-run12.tsv`, `results.tsv`, `anim.tsv`, logs in `logs/`).

**Load caveat (applies to every number below).** Other agents rendered on this Mac the whole time. Load average was 3 to 7 only in short windows and 20 to 50 most of the time. A render at load 25 takes 2 to 4 times longer than at load 5, and the variation inside one 3-run cell was often larger than the difference between the settings. Each row gives the minimum of the runs and the load of that run. Conclusions that rest on a same-load, interleaved comparison are marked "A/B". Everything else is indicative only.

## 1. The two targets

Composition: shots of 2 s tiling the timeline (9 normalised source clips, cover-cropped, 30 fps, keyframe every second, no sound), 2 text lines per 3 s with two text-shadows, one music track with gain and fade-out. Same style as `spike/viraleditor-render/index.html`. Lint: 0 errors, 0 warnings. All times from `/usr/bin/time` wall clock; "CLI" is the "rendered in" figure.

| Case | Best flags (all quality `looks`, `--fps 30`) | Wall (min) | Load | CLI stage times | Peak RSS |
|---|---|---|---|---|---|
| 8 s, 720x1280 | `--workers 1` (auto picks drawElement capture) | **6.5 s** (3 runs: 6.54, 6.57, 6.60) | 7.0 | compile 0.2, extract 0.0, audio 0.2, probe 0.1, setup 0.1, capture 5.1 (encode runs inside capture), assemble 0.2 | 0.8 GB |
| 8 s, 720x1280 | `--workers 4` (screenshot capture) | 6.5 s (A/B quiet window), 8.6 s in run 1 | 3.9 / 30 | compile 0.2, extract 0.0, setup 0.2, capture 4.7, encode 2.6, assemble 0.4 | 0.34 GB |
| 30 s, 1080x1920 | `--workers 1` (drawElement) | **27.8 s** (27.8, 27.9, 35.7) | 6.8 | compile 0.5, extract 2.5 (cold), audio 0.4, probe 0.4, setup 0.1, capture 22.9 (encode inline), assemble 0.5 | 1.5 GB |
| 30 s, 1080x1920 | `--workers 4` (screenshot) | 42.5 s | 28 | compile 0.9, capture 19.8, encode 19.3 (partly overlapping), assemble 0.6 | 0.63 GB |

**Both targets are met (10 s and 60 s), but only in the quiet windows or with margin to spare.** The 30 s case under load 20 to 30 took 40 to 95 s with every setting, so the 60 s target is not safe on a busy machine. One more 1080p w1 run in a window at load 3.3 took 41 s (the cause is not established; another process was probably using the GPU), so treat 28 to 41 s as the quiet-machine range.

The worker count does not scale the way it would on a CPU-bound render, because the default path changes with it (section 2).

## 2. Workers, capture path, where the time goes

Capture paths seen in the CLI summary:

- `--workers 1` → **drawElement** capture (Chrome `drawElementImage`, the "experimental fast capture", on by default on macOS with a hardware GPU). Encoding runs inside the capture loop, so there is no separate encode stage.
- `--workers >= 2` → **screenshot** capture (`Page.captureScreenshot`) plus a separate encode stage. Forcing `--experimental-fast-capture` with 2 or 4 workers keeps drawElement and works (see table), it was not faster than the plain screenshot path in my runs.
- The auto worker count is unstable here (see revision plan §1, item 9), pass `--workers` explicitly.

Min of 3, quality `looks`, default capture. Load in brackets.

| Workers | 8 s 720p wall | 30 s 1080p wall |
|---|---|---|
| 1 (drawElement) | 6.5 s [7.0] | 27.8 s [6.8] |
| 2 | 10.9 s [12.9] | 54.8 s [10.7] |
| 4 | 8.6 s [30] | 42.5 s [28] |
| 6 | 18.9 s [24.5] | 57.6 s [29.5] |
| 8 | 7.7 s [22.9] | 42.0 s [26] |

Reading: at low load, 1 worker with drawElement beat 2 workers with screenshot capture (6.5 vs 10.9 s; 27.8 vs 54.8 s) because the screenshot path is about 2 times slower per frame, as the CLI help says. 4 and 8 workers on the screenshot path land near 1 worker drawElement, with a large load dependence. The 6-worker cell is an outlier on both sizes (run under load 25 to 30); I did not re-run it. 8 workers hit the "Node heap supports about 5" warning in the earlier spike.

Interleaved A/B at 8 s 720p, three rounds (load 4, 22, 24) gave: w1 6.5 / 16.5 / 16.2 s; w4 6.5 / 17.0 / 16.8 s; w8 5.7 / 17.3 / 17.1 s; w1 with `--experimental-fast-capture=false` 12.2 / 22.2 / 22.3 s. So at 720p the worker count 1, 4 or 8 makes no measurable difference, and drawElement is about 1.4 to 1.9 times faster than the screenshot path at 1 worker.

**Stage breakdown** (CLI summary, 30 s 1080p, w1 drawElement, load 6.8): compile 0.5, extract 2.5, audio 0.4, probe 0.4, setup 0.1, capture+encode 22.9, assemble 0.5. Capture is 82 % of the wall time. Browser start and page setup are about 0.3 to 0.6 s (setup plus the first `initSession` lines in the log). Frame extraction is 2.5 s cold and 0.0 to 0.1 s warm for our pre-normalised clips (all-keyframe, 30 fps); the cache holds 149 MB of JPEG frames for the 30 s 1080p case (default location `$TMPDIR/hyperframes-extract-cache-501`, I used `--frames-cache-dir` with fresh folders; the Chrome download was not touched). Cold vs warm at load 32 to 50: extract 6.0 s vs 0.1 s, total wall 88 s vs 97 s (no difference beyond the noise, capture dominates).

**Encoding.**
- Screenshot path, 30 s 1080p, quality `looks` (libx264 CRF 16): encode is the bottleneck. With the animated composition (section 5): 34 s at 4 workers, 72 s at 6, 79 s at 8 (load 25 to 29), against a capture stage of 25 to 53 s. With `draft` the encode falls to 5 to 12 s.
- `--gpu` (VideoToolbox) at load 12: 1080p 30 s, w4: **25.0 s** against 42.5 s without (different loads, so indicative; at 720p 8 s w4 it was 7.2 s quiet, 11.8 / 14.8 loaded, no clear gain). With `--gpu` at 1 worker (drawElement path) it was no faster (47 s at load 16; not comparable). I did not verify the quality or the determinism of `--gpu` output, and a hardware encode is likely not bit-reproducible: the determinism claim below is only for the default libx264 path.
- Quality at 1 worker, 720p 8 s: draft 13.2 s [25], looks 6.5 s [7], delivery 25.0 s [29]. The loads differ, so only the ordering delivery > looks is trustworthy (CRF and preset are costlier).
- Software GL (`--no-browser-gpu`): slower and uses more memory (w1 18.8 s at 720p, 0.9 GB; w4 12.0 s) and **produces different pixels** (section 4).

## 3. Overlay-only strategy and alpha

**An alpha output exists.** `hyperframes render --format mov` writes ProRes 4444 (`yuva444p12le`, alpha 0 to 255 verified with `alphaextract`), `--format webm` writes VP9 with alpha (alpha side-channel; the ffmpeg native vp9 decoder drops it, `-c:v libvpx-vp9` before `-i` reads it, alpha verified), `--format png-sequence` writes RGBA PNGs (240 frames for 8 s, 5 MB). `hyperframes snapshot --at t1,t2,...` also writes RGBA PNGs of a transparent composition, with the same coverage (16433 non-zero alpha pixels in the same frame from mov, png-sequence and snapshot). It needs a transparent root (`background: transparent` on html, body and `#root`); the render then works as usual.

Pipelines tried, all with the same shots, texts and music:

| Pipeline | 8 s 720p | 30 s 1080p |
|---|---|---|
| A: all-HyperFrames (w1) | 22.5 / 22.0 / 19.3 s [A/B loads 33, 29, 27] | 77.5 to 78.9 s [26 to 34] |
| B: ffmpeg footage (VideoToolbox) + HyperFrames overlay `mov` (w1) + ffmpeg overlay pass | 1.3 + 18.3 + 3.5 = 23.1 s (round 1) | footage 9.8 + overlay render 118 + overlay pass 23.0 = 151 s [load 32] |
| C: ffmpeg footage + **stills** from `snapshot` + one ffmpeg pass (`overlay enable='between(n,a,b)'`), VideoToolbox | **5.6 s** [23] | **12.5 to 19.6 s** [26 to 34] (snapshot 4.7 to 6.6, ffmpeg 7.8 to 13.0) |
| C with libx264 CRF 16 | 11.7 s | 65.5 to 80.1 s (ffmpeg libx264 58 to 73 s at load 26 to 34) |

Findings:
1. **Rendering a transparent overlay video with HyperFrames saves almost nothing** (B vs A, 8 s: overlay render 17.6 to 19.4 s against the full 19.3 to 22.5 s at equal load). The cost per frame is the capture itself (a screenshot of a 720x1280 or 1080x1920 page), not the video decode. The CLI also disables the static-frame dedup for non-GSAP compositions ("no GSAP tweens"), so static text is captured every frame. Adding two ffmpeg passes makes B slower than A in total.
2. **For static texts, stills are far faster** (C): about 5 s of browser start and capture for all the text groups, then one ffmpeg pass. It is 4 times faster than A at the same load for 8 s, and 4 to 6 times faster for 30 s (VideoToolbox). Pixel check: C (libx264) against A, 8 s: PSNR average 45.7 dB, minimum 44.1 dB over 240 frames; at 30 s 1080p average 44.6 dB, minimum 42.8 dB. There is no dip at any cut or text edge, so cuts and text edges fall on the same frames. The residual 42 to 46 dB is the extra lossy generation (HyperFrames extracts JPEG frames and re-encodes; ffmpeg-only reads the source once).
3. C only works for text that does not move. Animation (CSS keyframes, which the controller has decided to use for motion, transitions and captions) needs per-frame capture, so it must go through HyperFrames (A or an animated overlay B).
4. Transitions in an ffmpeg-built footage track would need `xfade` (offset = shot end minus transition length, in seconds, which must stay frame-exact; the filter chain grows with the shot count and re-encodes once). Not built or measured here.

## 4. Determinism

All with the default libx264 CRF 16 path, 8 s 720p composition, `ffmpeg -i out.mp4 -map 0:v -f framemd5 -`, 240 frame hashes compared:

| Pair | Different frames |
|---|---|
| w1 drawElement, run a vs run b | **0 of 240** |
| w1 drawElement vs w4 screenshot | **0 of 240** |
| w4 vs w4 (two runs) | 0 of 240 |
| w1 vs w8 | 0 of 240 |
| w1 (hardware GL) vs w4 `--no-browser-gpu` (software GL) | **240 of 240**, PSNR average 48.3 dB, min 45.9 dB (no frame infinite) |

Also: the ffmpeg-only pipeline C gave identical frame hashes across two runs for both VideoToolbox and libx264 outputs at 30 s 1080p (0 of 900 differing, `framemd5`). The same input renders to identical pixels regardless of worker count and capture path, as long as the Chrome GPU mode is the same. Software GL changes pixels slightly. Not tested: different load levels with the same flags beyond the above runs (they ran at load 4 to 33), `--gpu` encode, and different machines.

## 5. Animated 30 s 1080p (requested by the controller)

Composition `anim-1080-30`: the 30 s montage plus a CSS `@keyframes` pop-in on every text line and a CSS zoom on every shot (2 s linear). One run per cell, no repeat, so no minimum was taken. The CLI chose the screenshot path in all six.

| Workers | Quality | Wall | Load | Stages (capture / encode, s) |
|---|---|---|---|---|
| 4 | draft | **41.2 s** | 24.8 | 26.9 / 5.4 (extract 5.0 cold) |
| 4 | looks | 62.3 s | 25.1 | 24.5 / 34.1 |
| 6 | draft | 42.5 s | 33.6 | 27.8 / 9.9 |
| 6 | looks | 115.9 s | 26.7 | 36.0 / 71.5 |
| 8 | draft | 56.4 s | 33.6 | 35.5 / 12.3 |
| 8 | looks | 148.8 s | 28.9 | 53.2 / 78.6 |

Reading: with animation, the capture stage is 25 to 53 s and does not shrink above 4 workers (Chrome processes compete for the same cores and GPU, and for other agents' load). The libx264 encode stage with `looks` is the real cost and grows with more workers (more frames in flight, more CPU contention); `draft` cuts it by 5 to 6 times. 4 workers was the best of 4, 6, 8 for both qualities. Under load 25 the 60 s target was missed with `looks` (62 s) and met with `draft` (41 s). I did not run 4 workers with `--gpu` on the animated case.

## 6. Cells not measured

- 15 s at either resolution (the whole 15 s row), 8 s at 1080p, 30 s at 720p. Only the corners (720p 8 s, 1080p 30 s) were measured.
- `--quality draft` and `delivery` at 2 / 6 / 8 workers on static compositions; `--gpu` and `--no-browser-gpu` at 2 / 6 / 8 workers and at 1080p 8 s; software GL at 1080p except w1 and w4.
- Static-case 6-worker cell was an outlier and was not repeated; the animated case has one run per cell, none at 1 or 2 workers.
- Peak memory only from `/usr/bin/time -l` of the whole process tree (maximum resident set size), not per Chrome process.
- `xfade` transitions, Docker mode (`--docker`), `HF_SEGMENTED_CAPTURE`, un-normalised footage (kling clips with one keyframe, 24 fps) in the speed matrix, and the page-side compositing flag.
- A clean-machine repeat of everything above.

## 7. Recommendation

**Strategy: HyperFrames renders everything (as decided), run with explicit `--workers 4`, `--quality draft` for previews and for the 60 s case under load, `looks` when the machine is quiet; keep `--workers 1` (drawElement) as the fast path for compositions with no animation, and pre-normalise every clip (30 fps, keyframe every second) so extraction costs 0 to 2.5 s.** Add an optional "static text" fast path (ffmpeg footage with `h264_videotoolbox` + `snapshot` RGBA stills + one `overlay enable=between` pass) only if the 60 s budget turns out to be missed in real use: it is 4 to 6 times faster for static text and keeps cuts and text edges on the same frames (PSNR floor 42.8 dB), but it cannot carry animation, and it adds a second renderer to keep pixel-consistent.

Risks and caveats (stated once): all timings were taken at load 20 to 30 except a few quiet windows, so the 60 s target for an animated 30 s 1080p video is **not demonstrated** on a busy machine (62 s with `looks`, 41 s with `draft` at load 25); the static case meets it with room (27.8 s quiet). The `--workers 1` fast path changes to the screenshot path as soon as the composition needs more than one worker, drawElement may fall back to screenshots for "clip-boundary frames" (seen in the earlier spike's log), and pixels are identical across both paths only on the same GPU mode. Software GL gives different pixels, so the editor must not mix GPU modes between renders it expects to match.
