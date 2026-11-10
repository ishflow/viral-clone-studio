# C1d render investigation and bounded verification

The second render difference remains open. Removing the sweep's `uneven` filter and restoring the strict frame-identity assertion exposed a fresh failure: document 08 render 1 differed by eight decoded frames from all subsequent 19 renders. Every render lit NOW correctly. Documents 05/06 and negative controls passed that batch. This is evidence of picture instability, not evidence locating it in compose, capture or encoding.

## Local reproduction

Use the repository's installed HyperFrames 0.8.120, local Chrome, ffmpeg and ffprobe; do not upgrade or fetch dependencies. From repository root:

```sh
VE_RENDER=1 VE_SWEEP_LOG=/absolute/local/c1d.jsonl VE_SWEEP_ARTIFACTS=/absolute/local/new-artifact-directory pnpm --dir viraleditor exec vitest run src/sweep/repeat.render.test.ts
```

The test composes documents 07/08 once each, renders each folder twenty times with the adapter defaults, compares every decoded frame with render 1, and separately tests NOW on frame 60. The optional archive preserves compositions, local assets and delivered videos before the existing harness removes its temporary root. Use a fresh archive directory per run. The JSONL includes the changed frame indices. A passing batch is not proof of determinism. Keep at most two render/e2e jobs active, with 10 GB free disk.

Historical C1c evidence: document 08, paused CSS, a 200 MB script gap, draft quality, four workers, eight busy threads; 1/30 renders differed on frames 99–101, a 24×16 block on GO's edge. The previous report rounded that result to 1/29 comparisons. Studio preview under the paused rule remains untested.

## What was isolated

A direct capture probe made 300 paired seeks/screenshots across JPEG and PNG capture sessions under six busy threads; no difference appeared. Thirty debug renders of the historical gap composition (draft, four workers) produced identical decoded video and all 3,600 retained JPEG captures matched. Thirty debug renders of the current composition (looks, four workers) also produced identical decoded video. Debug capture changes timing, so those negative probes cannot clear the failing regular path. An additional thirty hardware-encoder debug renders also matched, including all 3,600 retained JPEG captures. The final regular strict repeat gate passed all forty renders (07/08, twenty each); its archived videos and JSONL recorded no changed frame. Neither negative batch explains the earlier eight-frame failure. No upstream package was modified and no upstream issue was submitted (network prohibited).

The next decisive evidence is a failing batch with raw captures retained: compare captured pixels before encoding, then encode the same fixed capture sequence repeatedly. A raw difference identifies capture/raster timing; identical raw pixels with different decoded outputs identify encoding. Also compare composition bytes between attempts. Current evidence does not justify calling this an upstream-only defect or changing compose geometry.

## Available mitigation

`createRenderer({ ..., verifyRepeat: true })` verifies every decoded video frame before publication. Two consecutive renders must match; one disagreement permits a third render, while two disagreements raise `render-picture-unstable` without publishing. Failed decoding/frame count raises `render-picture-verification-failed`. Verification performs local rendering only; it never regenerates paid assets. This option is opt-in and is not enabled automatically in the production worker. It costs at least two renders and cannot establish pixel correctness when both renders share the same defect.

Unit tests cover mismatch/match and repeated mismatch/no publication. A real CLI smoke rendered and verified the full document successfully. Adoption as the worker default and capture/encode root-cause classification remain open; strict tests no longer conceal them.

## Normal-path raw-capture probe (follow-up)

Use `src/sweep/capture-investigation.mjs` with installed 0.8.120 only. It runs the ordinary four-worker CLI path with `KEEP_TEMP=1`, **without `--debug`**, copies each JPEG sequence into `capture-N/` immediately after the render, and records per-frame raw SHA-256 plus decoded-video MD5 in `frames.jsonl`. The normal CLI startup sweeps old `work-*` directories even with KEEP_TEMP; leaving those directories alone is therefore insufficient to retain earlier evidence. The copied archive avoids that subsequent startup sweep without modifying upstream code.

From `viraleditor/`, with a previously composed local folder and a new empty archive:

```sh
node src/sweep/capture-investigation.mjs /absolute/local/composition 50 looks 8 /absolute/local/new-archive
```

Arguments are composition, bounded iteration count (1–200), draft/looks, local CPU load threads (0–8), and archive. The composition must have a 30-fps timeline with at most 1,800 frames. Input files/assets are hashed before each attempt; the archive also copies the composition and its assets. Every attempt requires the official process counter ≤1 and at least 10 GiB available. Coordinate with the other workers as well: wrapper commands can double-count a job, while a direct `vitest.mjs run` can evade the literal `vitest run` match. The archive is never overwritten or deleted. CPU-load workers terminate in `finally`.

The first changed raw hash, decoded hash or input hash ends the batch and retains the pair. A raw JPEG-byte mismatch needs an additional decoded JPEG-pixel comparison before labeling a pixel defect (metadata-only byte differences are possible). Equal composition bytes/assets with changed raw pixels places the difference before encoding, in runtime seek/capture/rasterization. Equal raw pixels with changed decoded outputs isolates the encoder/assembly path. Input changes invalidate an identical-composition comparison. A passing batch remains negative evidence and does not clear the intermittent defect.

For encoder isolation, replay one retained JPEG directory through the installed upstream `encodeFramesFromDir` export using `getEncoderPreset('standard', 'mp4')`, 30/1 fps, 1080×1920, software encoding, and **quality 16** for the CLI's `looks` alias. Plain `standard` is CRF18 and does not match `looks`. Compare every decoded output hash, and check that replay 1 matches the delivered video before treating replay stability as an exact-path control. The local follow-up scripts/logs are under `scratch/follow-up/`; no upstream file was edited or issue submitted.

To prepare an upstream reproduction packet offline: preserve the copied composition/assets, manifest, frame JSONL, both differing JPEG sequences, both videos and corresponding CLI logs. Run the command above from the installed editor directory with telemetry/update checks disabled (the script sets them). Expected: all decoded pictures match for one unchanged composition; actual: include the recorded differing frame indices and a pixel crop. State worker count, load threads, capture mode and quality. Submit only after a failure is actually retained; this note does not assert an upstream-only cause.

Bounded follow-up result: normal looks under eight load threads, 40 renders / 4,800 copied JPEGs; paused CSS plus 200 MB parser gap under eight load threads, 50 draft renders / 6,000 copied JPEGs; the sole additional zero-load profile, 20 looks renders / 2,400 copied JPEGs. All 110 renders have unchanged per-batch inputs and identical per-frame raw/decoded hashes. Loaded and quiet looks agree across profiles too. Exact CRF16 fixed-capture replay is stable for 20 outputs and equals the delivered picture. No failing pair was captured; compose/capture/encode/environment classification and paid-delivery verifyRepeat recommendation are in the follow-up report. Studio readiness/context passed, but native Chrome UI use was automatically rejected; actual paused-CSS playback is unverified. These negative results do not close C1d or establish an upstream-only cause. No further render batch was run after the bounded quiet control.
