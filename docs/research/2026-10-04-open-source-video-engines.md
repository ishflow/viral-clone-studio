# Open-source video engines vs. Hypit: build-or-adopt assessment

Date read: 2026-10-04. Sources: each project's LICENSE file / GitHub repo and docs (URLs inline). Stars and dates are from the GitHub API on the same day. Items I did not verify are marked "not verified".

## 1. Short answer

- Is there a drop-in, fully open-source Hypit? **No.** Hypit is an orchestration layer (planning, provider calls, transcription, build records, authoring format). Nothing open-source ships that whole stack with usable quality and a SaaS-safe licence. The closest whole-pipeline projects (MoneyPrinterTurbo, ShortGPT) are far lower quality and structurally different.
- But the part that actually matters most, the **renderer, is itself open source and permissive**. Hypit's renderer is HyperFrames, and HyperFrames is plain Apache-2.0 with no SaaS clause. So "write our own with the same logic" does not mean writing a renderer; it means writing the layer above HyperFrames.
- Recommended core: **HyperFrames (Apache-2.0)**. Runner-up: **Revideo (MIT)**.
- Popular but NOT fully open source: **Remotion** (custom licence; company licence above 3 people; per-render fee for automations).

## 2. Hypit, for reference

Read locally (/opt/homebrew/lib/node_modules/@hypit/hypit, v0.2.17). Its LICENSE is Apache-2.0 plus conditions. The two that block us:

- "Unless explicitly authorized by Hypit.AI in writing, you may not use the Hypit source code, or any derivative work of it, to operate a multi-tenant environment, or to offer Hypit's functionality to third parties as a hosted, managed, or software-as-a-service offering."
- A second clause forbids commercial redistribution, alone or bundled in a product, without written authorisation.

Its `packages/` directory shows the layers: `render-hyperframes` and `hyperframes` (renderer), `provider-*` plus `seedance`, `seedream`, `nano-banana`, `elevenlabs-speech`, `wan` etc. (generation clients), `whisperx` / `speech-alignment` (word timing), `caption`, `typography-track`, `audio-track`, `build-result*` and `store-sqlite` (build records), `compiler-*`/`elaborator`/`program-space` (author-file compiler), `transport-aws-lambda`. Only the renderer layer has an open-source upstream we may use.

## 3. Rendering / composition engines

Licence SPDX and dates from GitHub API (2026-10-04). "Headless" means a documented non-GUI render on macOS and Linux.

| Engine | Licence (source) | Maintained | How a video is described | Notes for our use |
|---|---|---|---|---|
| **HyperFrames** (heygen-com/hyperframes) | **Apache-2.0** (github.com/heygen-com/hyperframes/blob/main/LICENSE, standard text, no extra clause) | Very active: v0.8.120 released 2026-10-04, ~56k stars, repo created 2026-03-10 (young) | HTML + CSS + data-* timing attributes + seekable GSAP/Lottie/WAAPI timelines | Headless Chrome, frame seeking, deterministic ("same input, identical output", docs/concepts/determinism.mdx). Local, Docker, Cloud Run, Lambda. Web fonts, shadows, per-word captions are just HTML/CSS/GSAP. Video clips as layers via ffmpeg frame extraction; audio mixing via `<hf-audio-group>`, ducking, fades. Docs state a 300-frame 1080p render took 9.8 to 25 s depending on CSS cost (their own benchmark; our template may differ). Limitation: very young, fast-moving API (0.x); breaks quietly if timeline rules are violated; heavy blur/backdrop-filter/shadows slow renders. |
| **Remotion** (remotion-dev/remotion) | **Custom "Remotion License"**, SPDX NOASSERTION (github.com/remotion-dev/remotion/blob/main/LICENSE.md) | Very active: v4.0.532 on 2026-10-01, ~62k stars | React components, pure function of frame | Most mature (Lambda, docs, ecosystem). Licence: free only for "an individual; a for-profit organization with up to 3 employees; a non-profit...". Otherwise a Company License (remotion.pro). Their FAQ (remotion.dev/docs/license/faq): letting users render "their own personalized video based on your Remotion template" is allowed, and the Automators plan applies to programmatic render APIs at "$0.01 per render, with a minimum spend of $100/month". Not fully open source; also a recurring cost that scales per render. |
| **Revideo** (midrender/revideo, formerly redotvideo) | **MIT** (github.com/midrender/revideo/blob/main/LICENSE) | Active but slower: last push 2026-07-15, ~4.1k stars, no GitHub releases (use npm); now the engine behind Midrender | TypeScript generator scenes (Motion Canvas fork) | Headless render API ("ships a headless render API"), React player. Canvas-based text (not browser CSS), so rich text/shadows are API-limited vs HTML. Smaller ecosystem. Speed figures not verified. Fork of Motion Canvas so it inherits its canvas-2D model. |
| **Motion Canvas** | **MIT** (github.com/motion-canvas/motion-canvas) | Stalled: last release v3.17.2 on 2024-12-14; ~19k stars; pushed 2026-07-02 | TypeScript generator scenes | Built for explainer animation, editor-centred; headless export is awkward (plugin-based). Not a fit for template-driven server rendering. |
| **Editly** (mifi/editly) | **MIT** | Low: last push 2025-05-12, last release v0.15.0-rc.1 2025-01-19; ~5.5k stars | JSON / JSON5 edit spec: clips, images, titles, audio | Closest in "JSON in, mp4 out" spirit. Uses ffmpeg + headless-gl/node-canvas; text via system TTF `fontPath`; no CSS-grade text, per-word karaoke captions would need custom canvas layers. Linux needs headless-gl system deps. Usable for simple cuts, not for our caption/card quality. |
| **FFCreator** (tnfe/FFCreator) | **MIT** | Stale: last push 2024-12-19, ~3.2k stars | JS scene/element API | Node + headless-gl + ffmpeg. Weak text and stale. Skip. |
| **MoviePy** | **MIT** | Active: v2.2.1 2025-05-21, pushed 2026-08-26, ~15k stars | Python code | Simple, Python, ffmpeg + Pillow/ImageMagick text. Frame-accurate if careful, but slow (per-frame Python compositing), text and animation quality limited, no web fonts without effort. Good for prototypes. |
| **Diffusion Studio Core** | GitHub says **MPL-2.0**, but the README says "free as long as you keep the 'Made with Diffusion Studio' watermark... To remove the watermark, you can purchase a license key" (github.com/diffusionstudio/core) | Low: last release v1.1.1 2024-10-29, pushed 2025-11-18; ~1.2k stars | TypeScript clip/layer API | Browser-only (WebCodecs, needs COOP/COEP headers); README says "You need to render videos server side - Use Remotion". Watermark/paid key: not a clean fit. |
| **Etro** | **GPL-3.0** (github.com/etro-js/etro) | Active: v0.14.1 2026-08-12 | JS layer API in a browser canvas | GPL-3.0 is a copyleft problem for a closed SaaS and it is browser-oriented. Skip. |
| **Twick** (ncounterspecialist/twick) | **Sustainable Use License v1.0** (LICENSE.md) | Active (2026-06), ~0.5k stars | React editor SDK + serverless export | Its licence says you may not "Provide the Software or backend functions as a hosted service, platform, or SaaS without a commercial agreement". Not open source for us. |
| **OpenCut** (OpenCut-app/OpenCut) | **MIT** | Active (~92k stars, pushed 2026-09-24) but "being rewritten from the ground up"; headless mode only a roadmap item | GUI editor (no declarative render) | A consumer editor, not an engine. Not usable today. |
| **MLT / melt** (mltframework/mlt) | **LGPL-2.1** core (COPYING); some modules GPL (a GPL directory exists in the repo) | Very active: v7.42.0 on 2026-10-03; ~1.9k stars | XML project / C API / bindings | Proven NLE engine (Kdenlive, Shotcut), frame-accurate, headless via melt. Text via Pango/Qt modules, no web-font CSS typography, no per-word animation without heavy work. LGPL is fine for SaaS if dynamically linked; GPL modules must be avoided. Powerful but a poor match for designed text. |
| **GStreamer Editing Services** | **LGPL-2.1** (COPYING.LIB in the gstreamer monorepo; GitHub's licence API returns NOASSERTION) | Maintained inside the gstreamer monorepo (~3.3k stars on the monorepo) | C API / timeline XML | Frame-accurate pipelines, but text overlay is pango-based and animation is awkward. Heavy integration cost for little benefit. |
| **Plain ffmpeg filter graphs** | LGPL/GPL depending on build (check the build for `--enable-gpl`) | Very active | Command line / filtergraph | Perfect for the last stage (audio mix, mux, concatenation, normalisation). Drawtext gives no good word-by-word captions or shadows at design-grade quality. Use as a tool, not the core. |

Not covered in depth: Lottie/Rive-based players (animation, not composition), cloud APIs such as Shotstack/Creatomate (hosted, not open source), and browser-capture hacks (Puppeteer + ffmpeg by hand; that is effectively what HyperFrames productises).

## 4. Whole-pipeline projects ("template + AI assets -> short vertical video")

| Project | Licence | Maintained | What it automates | Base to build on? |
|---|---|---|---|---|
| **MoneyPrinterTurbo** (harry0703) | MIT | Very active (v1.3.8 on 2026-10-03, ~128k stars) | Topic -> LLM script -> TTS (Edge, Azure, ElevenLabs, Kokoro...) -> stock footage from Pexels/Pixabay -> subtitles (TTS timestamps or faster-whisper) -> 9:16 1080x1920 mp4; WebUI + API | Ideas only. MoviePy/ffmpeg compositing, stock-footage collage model, no exact shot list, no designed text/cards. Good reference for provider integration and subtitle timing. |
| **ShortGPT** (RayVentura) | MIT | Stale (last push 2025-02-10) | Script, ElevenLabs/EdgeTTS voice, Pexels footage, MoviePy edit | Ideas only. |
| **MoneyPrinterV2** (FujiwaraChoki) | **AGPL-3.0** | Active (2026-09) | YouTube Shorts / Twitter bot automation with cron | Do not use: AGPL. Not a rendering reference either. |
| **AI-Youtube-Shorts-Generator** (Anil-matcha) | MIT | Active (2026-09) | Long video -> highlight shorts | Different problem (clipping). |

None of them takes a JSON shot list with exact frame timings, designed text boxes, or product cards. None keeps build records for paid outputs.

## 5. Is any of this "Hypit, but fully open source"?

**No.** Reasons:
1. The only engine with the same architecture (HTML compositions in headless Chrome) is HyperFrames itself, and it is the renderer, not the orchestration. Hypit's compiler, build records, provider clients and alignment layers are not available under any open licence.
2. Whole-pipeline projects target "stock-footage collage" shorts, not template-driven brand videos with frame-exact timing and designed typography.
3. The other credible engine, Remotion, is source-available with fees, not open source.

## 6. Build-our-own assessment

Because HyperFrames is Apache-2.0 and is what Hypit renders with, the realistic plan is: **our code on top of HyperFrames, not a renderer from scratch.** Piece by piece:

| Piece | Difficulty | Notes |
|---|---|---|
| Template JSON -> HyperFrames composition generator | **Hard (the core of our work)** | Needs a stable schema (shots, text boxes, fonts, fills, shadows, cards), a generator that emits correct `data-*` timing and a paused GSAP timeline, and a long tail of visual cases (text fit/wrapping, safe zones, card layouts, transitions). Easy to produce something; hard to match a reference video's look and keep 100 templates from drifting. |
| Caption timing (word-by-word) | Medium | Word timings come from a transcriber (WhisperX, faster-whisper or a provider) or from TTS alignment; rendering them is easy CSS/GSAP. Pain points: Cyrillic/Arabic or other scripts, punctuation, line breaking, timings drifting from the music. |
| Audio mix | Easy to medium | HyperFrames has gain, ducking, fades; or do the final mix with ffmpeg. Loudness normalisation and music-bed ducking under voice need tuning by ear. |
| Generation clients (image, video, voice, music) | Easy per provider, tedious overall | Each API has its own polling, failure modes, rate limits and output formats. Paid calls, so idempotency matters. |
| Build records / reuse of paid outputs | Medium | Content-addressed cache keyed by (provider, model, prompt, params, seed, input hashes). Simple idea; the subtle bugs are invalidation and partial failures after money was spent. |
| Job queue, workers, storage | Easy to medium (standard) | Chrome is memory-hungry; concurrency per machine and cold-start behaviour must be measured. Deployment on Linux (fonts, GPU-less Chrome, ffmpeg builds) is the real work. |
| Renderer | **Not ours** | HyperFrames. We inherit its bugs and its release pace (v0.8.x, 0.x API). Pin the version; vendoring or forking is allowed by Apache-2.0. |

What "production quality" depends on, in order:
1. **Generated assets** (video/image models, voice, music). Our code cannot fix a bad Seedance clip. Biggest lever on perceived quality.
2. **Our template layer** (typography, timing, caption style, cuts). This is where Hypit's polish lives and where most of our effort goes.
3. **The renderer**. HyperFrames is deterministic and good enough; it is the lowest risk of the three, provided speed is acceptable.

Honest risks:
- HyperFrames is about seven months old and on 0.x; breaking changes are likely. Pin and test with golden-frame comparisons.
- We would be re-implementing, over time, many things Hypit already solved (compiler, elaboration, caching). Scope should stay to what we need (a narrow JSON schema), not "Hypit v2".
- Hosted HeyGen cloud rendering is a HeyGen service; we should not depend on it. Local/Docker rendering is what we run.
- HyperFrames' stated speed numbers are for a 10 s, 1080p test composition; our 35 s, 1080x1920 compositions with video layers and shadows could be several times slower. Not verified.
- No legal review done; the Apache-2.0 text is standard, but our dependency set (fonts, ffmpeg build, models, music) each carries separate licences. Fonts: use only fonts with an embedding/SaaS-friendly licence (OFL).

## 7. Recommendation

- **Core: HyperFrames** (Apache-2.0). Same engine Hypit renders with; HTML/CSS gives the best text quality (web fonts, shadows, per-word caption animation); deterministic seeked frames give frame accuracy; Docker/Linux path exists; no SaaS clause.
- **Runner-up: Revideo** (MIT). Clean TypeScript scenes with a headless render API; weaker text model and smaller community, but a different failure profile if HyperFrames' young API hurts. Third choice for simple templates: Editly (MIT, JSON in, but stale and plain text).
- **Avoid:** Remotion (fees, per-render pricing for automations), Twick (SaaS barred), Etro (GPL-3.0), MoneyPrinterV2 (AGPL-3.0), Diffusion Studio Core (watermark / paid key, browser-only).

### Prove with a small test before committing
1. **Speed and memory on our real shape.** One 1080x1920, 30 fps, 30 s composition: 6 video layers with hard cuts, 3 text boxes with shadows, word-by-word captions, a card, and a music bed. Measure render time on the Mac and on a small Linux box in Docker (target: a few minutes) and peak memory with 2 to 4 concurrent jobs.
2. **Frame accuracy and determinism.** Render the same composition twice and compare frames (identical hashes expected); verify a cut lands on the exact frame (check frame N and N-1 against the source clips) and that audio stays in sync after mux.
3. **Caption and font fidelity.** Reproduce one real reference video's captions and text boxes (our chosen web fonts, weights, fills, shadows, multilingual text) and judge against the original side by side; also check that the generator output survives the HyperFrames lint/check step with no silent failures.

If all three pass, build the template->composition generator first; it is the part that decides quality.
