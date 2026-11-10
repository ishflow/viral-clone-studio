# HyperFrames CLI facts used by viraleditor (version 0.8.120)

Every `hyperframes` child runs with `HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1`.

## transcribe

| Fact | Source |
|---|---|
| Usage `hyperframes transcribe [OPTIONS] <INPUT>`; INPUT is an audio/video file (or a .json/.srt/.vtt to import). | `cd viraleditor && ./node_modules/.bin/hyperframes transcribe --help` |
| `-d, --dir` is the project directory (default: the current directory); the transcript is written there. | same command |
| `-e, --engine` is `auto`, `parakeet` or `whisper`; we pass `whisper` to be independent of whether Parakeet is installed. | same command |
| `-m, --model` is a whisper model: `tiny.en, base.en, small.en, medium.en, large-v3`; default `small.en`. We use `small.en` for English and `large-v3` otherwise (the `.en` models are English only). | same command |
| `-l, --language` is a code such as `en`, `es`, `ja`; it filters out speech in other languages. | same command |
| `--json` prints a result object on stdout. | same command; output below |
| `--timeout` is the whisper spawn timeout in ms (min 5000); env `HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS`. Not used; our adapter has its own 30 min limit on the child. | same command |
| Call used: `hyperframes transcribe <media> -d <dir> --engine whisper --model small.en --language en --json`; 91 words in 16.1 s for 30 s of speech, model cached. | `spike/viraleditor-render/out/transcribe.stdout.json`, revision §1 point 11 |
| Stdout with `--json`: `{"ok":true,"engine":"whisper","model":"small.en","wordCount":91,"durationSeconds":30.04,"speechOnsetSeconds":null,"transcriptPath":".../out/transcript.json"}` | `cat spike/viraleditor-render/out/transcribe.stdout.json` |
| `<dir>/transcript.json` is a JSON array of words `{ "text": "I", "start": 0.07, "end": 0.09, "id": "w0" }`; times are seconds from the start of the media. We read only `text`, `start`, `end`. | `head spike/viraleditor-render/out/transcript.json`; copy at `docs/reference/fixtures/transcript.json` |
| The model hears words, not our script ("try" where the script says "tried"): captions must show our script, timed by alignment. | revision §1 point 11 |

Exit code: the adapter treats non-zero as failure and a missing or malformed `transcript.json` after exit 0 as `bad-output`. That a failing run exits non-zero was not observed here (only assumed from the CLI convention); it is covered against a stub executable only.

## claude (the LLM CLI, v2.1.289)

Each line is from `claude --help`; no model call was made.

| Flag we use | `--help` line |
|---|---|
| `-p` | `-p, --print    Print response and exit (useful for pipes). ...` |
| `--output-format text` | `--output-format <format>    Output format (only works with --print): "text" (default), "json" (single ...` |
| `--no-session-persistence` | `--no-session-persistence    Disable session persistence - sessions will not be saved to disk and cannot be ...` |
| `--allowedTools Read` | `--allowedTools, --allowed-tools <tools...>` |
| `--add-dir <dir>` (once per folder of an input file) | `--add-dir <directories...>    Additional directories to allow tool access to` |
| `--model <model>` (only when the caller sets one) | `--model <model>    Model for the current session. ...` |

The prompt goes on stdin (with `-p` and no prompt argument). The child runs in a fresh empty temp directory and without `ANTHROPIC_API_KEY` (with it the CLI bills the API key instead of the subscription login).

## yt-dlp (v2026.08.19)

Each line is from `yt-dlp --help`; no download was made.

| Flag we use | `--help` line |
|---|---|
| `--no-playlist` | `--no-playlist    Download only the video, if the URL refers to a video and a playlist` |
| `--no-progress` | `--no-progress    Do not print progress bar` |
| `--no-warnings` | `--no-warnings    Ignore warnings` |
| `--no-simulate` | `--no-simulate    Download the video even if printing/listing options are used` |
| `--dump-json` | `-j, --dump-json    Quiet, but print JSON information for each video. Simulate unless --no-simulate is used...` |
| `-f 'b[ext=mp4]/b'` | `-f, --format FORMAT    Video format code, see "FORMAT SELECTION" for more details` |
| `-o <dir>/%(id)s.%(ext)s` | `-o, --output [TYPES:]TEMPLATE    Output filename template; see "OUTPUT TEMPLATE" ...` |

Not observed (needs the network): the JSON field holding the downloaded path (`requested_downloads[0].filepath`, fallback `_filename`).

## Live check of the stripped environment

`hyperframes transcribe` through `createTranscriber` with the allow-listed child environment (no inherited variables beyond PATH, USER, LANG, ...; HOME is not passed since the SEC2 round, a call that needs a home gets an empty one of its own) and the three switches: `web/public/samples/lashly.mp4`, `en` -> 91 words in 4.4 s (model cached); first word after `I` is `try` 0.09-0.25, same as the spike.

## Not used by Task 4b

`check`, `render` (the renderer adapter, Task 4c) are documented in the revision, §1 points 1-10.

## lint, check, render, doctor (Task 4c, `adapters/renderer.ts`)

Real output captured on 0.8.120 with the three switches; fixtures in `docs/reference/fixtures/hf-*` (scratch paths replaced by `/work/`). Where the real CLI differs from revision §1, it is said.

| Fact | Source |
|---|---|
| `hyperframes --version` prints `0.8.120`, exit 0. | `node_modules/.bin/hyperframes --version` |
| `doctor --json` prints `{ ok, checks: [{ name, ok, detail, hint? }], _meta }`. The top-level `ok` is false on this Mac because optional items (Kokoro, MusicGen, Docker running) are missing, so the adapter reads only the check named `Chrome` (`ok: true`, detail `cache: …/chrome-headless-shell`). | `hyperframes doctor --json` |
| `lint <dir> --json` prints `{ ok, errorCount, warningCount, infoCount, findings: [{ code, severity, file, message, fixHint }], filesScanned }`; exit 1 when there is an error. A finding names a `file`, not an element. | `hyperframes lint <dir> --json`; `fixtures/hf-lint-error.json` |
| `check <dir> --no-contrast --json --at <s,s,…>` prints one object with sections `lint`, `runtime`, `layout`, `motion`, `contrast`, each `{ ok, errorCount, warningCount, infoCount, findings }`; exit 0 when `ok`, exit 1 otherwise. `--at` takes comma-separated seconds; `layout.samples` then lists exactly those times. | `fixtures/hf-check-ok.json` (`--at 1`: `"samples":[1]`) |
| `check` repeats the lint findings inside its own `lint` section (selector `[data-composition-id]`, `sourceFile`). The adapter takes both and drops the duplicate (same code, message and time). | `fixtures/hf-check-lint-error.json` against `hf-lint-error.json` |
| When lint has an error, `check` does not open the browser: `browserSkipped: true`, runtime and layout are empty. | `fixtures/hf-check-lint-error.json` |
| A runtime finding has `code` `console_error`, `page_error`, `http_error` (`404 loading assets/fonts/missing.woff2`) or `request_failed`, `severity: error`, `sourceFile`, `selector` (the composition root, not an element), `time: 0`. A missing font file is caught here, not by lint. | `fixtures/hf-check-runtime-layout-errors.json` |
| **Differs from the brief:** a text that does not fit gives `text_box_overflow` with **severity `error`** (not a warning), plus `canvas_overflow` with severity **`info`** ("Text extends outside the composition canvas.") when it also leaves the canvas. Both carry `selector: "#t-hook"` and `time` (the `--at` second). `container_overflow` is a `warning` (layout-audit source). The adapter makes an issue of every layout error and of every layout finding of any severity whose code matches `overflow` or `clipped`, or whose message says text/element extends/overflows outside a box/canvas/container. | same fixture; `node_modules/hyperframes/dist/commands/layout-audit.browser.js` (severity at lines 629, 766, …) |
| `check` or `lint` on a folder that is not there: stdout `{"ok":false,"error":"Command failed"}` (lint adds `"findings":[]`), stderr `Not a directory: …`, exit 1. A report with no `lint`/`runtime`/`layout` section is therefore a thrown `RenderError`, not "no issues". | `fixtures/hf-check-no-dir.json` |
| `render <dir> --fps 30 --quality looks --workers 1 --output <file.mp4>` writes nothing into `<dir>`, creates the output's folder if missing, exit 0. `--quality` shows as `standard` in the header (alias). | `hyperframes render … ` run on the test composition |
| **Differs from the brief:** the progress line is `Streaming frame n/N` (not `frame n/N` alone), drawn as a bar with escape codes and `\r` on **stdout** (non-TTY too), at frames 1, 16, 31, 43, 54, 60 of 60 (every ~25 %); only the pattern `frame n/` is read. The last line may not come (a fast render): the adapter ends with frames/frames after the file is verified. Chrome / compiler log lines go to stderr. | `fixtures/hf-render-stdout.txt` |
| A render of a folder without `index.html` exits 1 with `No composition found in …  No index.html file found.`. A `<video>` whose file is missing does **not** fail a render ("will silently skip", lint error `missing_local_asset`): `check` is what catches it. | `render` on an empty folder; `lint` of `fixtures/hf-lint-error.json` |
| Output of the test composition (720×1280, 60 frames): H.264, 30/1, 60 frames; AAC 48 kHz. | `ffprobe -show_entries stream=… out.mp4` |
| The CLI starts Chrome as a child. On a timeout the adapter kills the whole process group (`detached: true`, `process.kill(-pid)`), so no Chrome stays behind. | `adapters/renderer.ts`, tested with a stub that sleeps |
| Loudness pass on the test composition: the tone rendered at −28.5 LUFS / −26.5 dBTP; with `master: { lufs: -14, peak: -1 }` the adapter applied +14.5 dB and the file measured −14.0 LUFS / −12.0 dBTP. | one run of `createRenderer(…).render` followed by `measure.loudness` |
