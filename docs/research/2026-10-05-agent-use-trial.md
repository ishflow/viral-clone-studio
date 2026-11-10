# Agent-use trial (Task C5): a fresh agent makes a video with viraleditor from the guide alone

Date 2026-10-05. Subject and reporter: one Sonnet agent. Allowed reading: `docs/guide/viraleditor.md`, `docs/reference/edit-format.md`, `docs/reference/template-format.md`, the four `viraleditor/examples/*/edit.json`, and the CLI's own output (`--help`, `doctor`, `probe`, error messages). No source, plans, specs, ledger or tests were read. Scratch work in the scratchpad folder, outside the repository.

## Result in one line

Task A (silent, 12 s, 720x1280): `render` answered `ok: true`, 0 issues (2 `still-footage` warnings, caused by my own near-static lavfi gradient, and correct). Task B (voice-over with `say`, word captions, ducked music, 9 s): `render` answered `ok: true`, 0 issues, 0 warnings, and `inspect --edit` agreed. Task C: nine deliberate mistakes; seven gave an error that told me exactly what to do, two gave one transient `internal` crash (see S1). The CLI is good; almost every stumble was a gap in the guide about what lies **around** the editor (making clips, getting a voice into a clip, the render gate), not in the editor.

## Time and tool calls

| Task | Wall time | Tool calls | Notes |
|---|---|---|---|
| A | about 4 min of work + about 14 min waiting for the "at most 2 vitest" gate | 17 (5 of them reading the brief, guide, reference, examples; 6 waiting on the gate) | one document written, `check` ok at the first try; 1 normalize round for colour tags |
| B | about 2 min | 6 | `check` ok and `render` ok at the first try |
| C | about 3 min | 5 | 9 mutated copies of A's `edit.json`, plus 7 command-line mistakes |

Render: A 34 s wall (renderSeconds 18.4, check 7.7 s, quality 5.6 s), B 33 s wall (renderSeconds 16). Both ran while the machine load average was 30 to 48 because other agents run tests.

## What worked first time

- `doctor` (all six checks ready, names the HyperFrames version, Chrome, fonts, aligner).
- Writing a valid `edit.json` for A and B straight from the guide's example and the five rules: no schema or rule issue on the first `check`, in both tasks.
- `check <dir>` (a folder works although `--help` says `<edit.json>`).
- `probe` on a video and on an `.aiff`, `normalize` (cured `media-colour`, sound kept), `frames` (stills were readable and showed what the document said), `render --sheet` (sheet readable, each tile carries its second), `inspect <mp4> --timeline … --edit <dir>` (same warnings as the render, 0 errors).
- `words voice.aiff --script script.txt` on a macOS `say` file: all 18 words placed, scores 0.66 to 1.0; an `.aiff` is accepted although the guide only shows `voice.mp4`. Copying `frame` to `at` and `frames` to `for` is mechanical (I did it with a 3-line node `map`).
- The loudness pass: render output −14.1 LUFS in B and −14 in A, as the guide says.
- Every error of Task C that was an editor error had `code`, `path`, a message with the numbers, and a `fix` that I could apply without guessing (table below).

## Every stumble

Severity: H = I could not go on / lost real time, M = I had to work it out, L = cosmetic or only wording.

| # | Step | What I tried | What the guide / tool said | What it should say | Sev |
|---|---|---|---|---|---|
| S1 | C (breaking) | `check` of a copy with a 150-character hook and, separately, a copy with a missing media file | First run: exit with `internal`, "ReferenceError: PATTERNS is not defined" at `src/cli/project.ts:161`, stack trace on stderr (the clean document passed the same minute). Second run, same files, a minute later: the correct `text-too-long` and `media-missing`. Cause not mine: another agent was editing the source at the time. | Nothing to fix in the guide, but the `internal` fix ("run the command again; if it fails the same way, report it") was exactly right and worked. Worth knowing for the sweep: the two paths (text fit, file probe) only run after the structural rules, so a crash there is invisible to a test that only uses valid documents. | M |
| S2 | A, setup | "Make two clips with ffmpeg lavfi" | The guide says nothing on how to make a test clip. It says clips must be 30 fps (`media-fps`) and gives `normalize`, but not a command to make a clip. `init` makes stand-in clips, but I only know that from `--help` and from the guide's sentence "in the media that `init` makes". | One example command in "Your own media": `ffmpeg -f lavfi -i testsrc2=size=720x1280:rate=30:duration=7 -c:v libx264 -pix_fmt yuv420p -g 30 clip.mp4` plus "then `normalize` it" (see "Commands that worked"). | M |
| S3 | A, `check` | My lavfi clips had `-colorspace bt709 -color_primaries bt709 -color_trc bt709` | `media-colour` warning on both: "matrix bt709, transfer none, primaries none". ffmpeg had written only the matrix tag. The fix (a normalize command with my paths) was exact and worked. | Guide could add: "ffmpeg does not always write all three colour tags even when you pass them; do not hand-tag, run `normalize` once and use the copy." | L |
| S4 | B, setup | Put the spoken voice into the video | The guide shows `"sound": { "gain": 1 }` on a shot whose clip has sound, and `words voice.mp4`. It never says how a clip with a voice comes to be (here: a generated video plus an audio file, muxed) nor whether a bare audio file can carry the voice (`audio.sounds[]`: "sound effects, each played once"; `duck.under: "sound"` only ducks under a shot's own sound). I muxed the voice into a clip with ffmpeg and used the shot's `sound`. | A one-line recipe for a voice-over on a video clip, and one sentence: "a voice that is its own audio file goes in `audio.sounds[]` (and is not seen by `duck.under: "sound"`)" or whatever the truth is. | M |
| S5 | B, `words` | `words assets/voice.aiff --script script.txt` | Worked. The guide shows only `voice.mp4`; I did not know an `.aiff` is fine until I tried. | "any audio or video file with sound" in the table row. | L |
| S6 | Render gate (brief) | `pgrep -fl "vitest run" \| wc -l` must be at most 2 | The number was 6 to 218, never at most 2 for 14 minutes: `pgrep -f` matches every shell whose command line contains the words "vitest run" (including the waiting loop itself and other agents' shells) and every worker process. | A gate that counts real runs: `ps -axo command \| grep -E "vitest(\.mjs)? run" \| grep -v "grep\|zsh -c\|timeout\|pnpm" \| wc -l` (showed 1 to 3). This is a brief, not a guide, matter. | M |
| S7 | A, setup | Used a shell variable `V="node …/main.ts"` then `$V check` | zsh does not split it: "no such file or directory". My own shell mistake. The guide says "below that is written `viraleditor <command>`" but gives no ready alias. | One line in "The program": `alias viraleditor='node /path/to/viral-klon/viraleditor/src/cli/main.ts'` or a tiny wrapper script (what I used: `exec node …/main.ts "$@"`). | L |
| S8 | A, `render` | Two `still-footage` warnings on a near-static gradient clip | Correct and precise (frames 27 to 153 and 160 to 179, the fix names `from` or another clip). The guide's list of render warnings includes `still-footage`, but a lavfi `gradients` or `color` clip will always trigger it. | In S2's recipe, say which lavfi sources move (`testsrc2`, `mandelbrot`, `life`) and that a `color` or a slow `gradients` clip is flagged on purpose. | L |
| S9 | C | `frames . --at 9999` | `frame-range`: "Frame 9999 is outside the video: the document has 360 frames, 0 to 359". Exit 1. | Fine. | none |
| S10 | C | `check nosuchdir` | `file-missing`: "The edit document is not there: …/nosuchdir", fix "Give the path of a file that exists; `viraleditor init <dir>` writes a working project". The fix is generic (the same text for a missing `--script` file in `words`), and `init` is not what someone wants who only mistyped a folder. | For a path that has no `edit.json`: "no `edit.json` in … ; did you mean one of: <folders with an edit.json beside here>" or at least name `<dir>/edit.json`. | L |
| S11 | C | `firstin`: `"in": { "kind": "whip" }` on the first shot (twice mistaken: no `to`, and not allowed on the first shot) | First answer (stage `schema`): only "`shots[0].in.to` is missing". After adding `"to": "left"` the real error came: `transition-first`, "remove shots[0].in". Two rounds for one mistake; the guide does say "only the shape is reported until the shape is right", so this is as documented. | Acceptable; a hint in the schema message "(and `in` is not allowed on the first shot)" would save a round. | L |
| S12 | C | `render` with a bad `--quality high` | `flag-value`, "it takes one of: draft, looks" (the guide says `draft`; the second value is `looks`, named only here and in `--help`). | Guide row for `render`: "`--quality draft\|looks`". | L |

## Task C: the nine mistakes and whether the error told me what to do

| # | Mistake | Code and message | Did it tell me what to do without guessing |
|---|---|---|---|
| 1 | wrong key: `shots[1].media = "tow"` | `media-unknown`, "has no such key; it has: one, two, music" | Yes. Lists the real keys. |
| 2 | box off the canvas: `right: 105` | `box-out-of-range`, "every value is a percentage of the canvas, from 0 to 100", fix "keep left, top, right and bottom between 0 and 100" | Yes. (A box at `right: 99` gave `outside-safe-area` with the nearest box in the guide's own example; 105 gets the more basic code, which is right.) |
| 3 | text too long (about 150 characters in a 82 x 12 percent box) | `text-too-long`, "at the smallest size allowed (29 px …) it needs 5 lines, 2 are allowed", fix "shorten the copy, or lower `shrink`, or widen the box" (it correctly left out "raise `lines`" because 5 is above the maximum 4) | Yes. The fix list changes with the case, which is exactly right. |
| 4 | missing media file `assets/nope.mp4` | `media-missing`, absolute path in the message, fix "put the file there, or point `edit.media.one.file` at a file that exists" | Yes. Note: the fix says `edit.media.one.file`, while every other path in the output is written `media.one.file`; a tiny inconsistency. |
| 5 | bad frame numbers: `frames` 365 and shot start 175 | two `shots-gap` issues: "set `shots[1].at` to 180 (a transition never changes at)" and "set `frames` to 355" | Yes. Both fixes together are consistent (the second says 355 because it reads the broken first). The guide's warning "fix the first of a kind, then check again" is what saves the day here: following both literally would give 355 with a shot that ends at 360, but the first fix removes the second issue. |
| 6 | duplicate `id` | `id-duplicate`, names both places, fix proposes `title-2` | Yes. |
| 7 | field the format does not know: `texts[0].colour` | stage `schema`, `schema`, "unknown field", fix lists every field allowed there | Yes. |
| 8 | clip shorter than the shot (`for: 300` on a 210-frame clip) | `clip-short` ("needs 300 frames of two, but the clip has 210", fix to shorten) and `music-short` (fix: longer music or `loop`) | Yes. |
| 9 | `frames --at 9999`, `--at 12.5,abc`, `--at -3`, missing `--at`, `--quality high`, a missing script file | `frame-range`, `flag-value` (exit 2), `flag-missing`, `file-missing` | Yes. `flag-value` gives the exact form to type. |
| extra | animation longer than the element (`for: 3` with enter 6 and exit 6); a box into the buttons column | `animation-too-long` (fix: 13 or more, or shorten the fade, with an example), `outside-safe-area` (nearest box) | Yes. |

Also checked: on the first run of Task C an `unknown-command` answer came for a command line I had passed as one word. It said "Did you mean "frames"?" for a command called `frames . --at 9999`. The text is right in spirit but looks silly; it would help to say "the command name is the first word only" (this was my shell quoting, a realistic mistake for an agent that builds the command line in a variable).

## Commands that finally worked (for guide examples)

```sh
# a wrapper so that "viraleditor" works from any folder (one file named viraleditor, chmod +x)
exec node /path/to/viral-klon/viraleditor/src/cli/main.ts "$@"

# a test clip that moves, 7 s, a keyframe every second, then make it editor-ready
ffmpeg -f lavfi -i "testsrc2=size=720x1280:rate=30:duration=7" -c:v libx264 -pix_fmt yuv420p -g 30 -an clip1.mp4
viraleditor normalize clip1.mp4 assets/clip1.mp4 --canvas 720x1280   # tags colour, keyframes; keeps sound

# music from a sine (13 s, at least as long as the video)
ffmpeg -f lavfi -i "sine=frequency=330:duration=13:sample_rate=44100" -c:a libmp3lame -b:a 128k assets/music.mp3

# a voice (macOS) and its words
say -v Samantha -o assets/voice.aiff -f script.txt
viraleditor words assets/voice.aiff --script script.txt --json > words.json   # .aiff works

# a talking clip: a moving video with the voice muxed in (then normalize it, sound is kept)
ffmpeg -f lavfi -i "testsrc2=size=720x1280:rate=30:duration=7" -i assets/voice.aiff \
  -filter_complex "[1:a]apad,atrim=0:7[a]" -map 0:v -map "[a]" \
  -c:v libx264 -pix_fmt yuv420p -g 30 -c:a aac -ar 48000 -shortest talk-raw.mp4
viraleditor normalize talk-raw.mp4 assets/talk.mp4 --canvas 720x1280

# words.json to captions.words (3 lines of node)
node -e 'const w=require("./words.json").result.words;
  const d=require("./edit.json");
  d.captions.words=w.map(x=>({text:x.text,at:x.frame,for:x.frames}));
  require("fs").writeFileSync("edit.json",JSON.stringify(d,null,2))'

viraleditor check demo --json
viraleditor frames demo --at 76,270 --json
viraleditor render demo --sheet --json            # ok: true, issues: []
viraleditor inspect demo/.viraleditor/render.mp4 \
  --timeline demo/.viraleditor/composition/timeline.json --edit demo --json
```

Task A document (the part that mattered): two shots of 180 frames each of 7-second clips (210 frames, so the crossfade's 8 extra frames fit), `"in": { "kind": "crossfade" }` on the second, `push-in` / `pull-out`, a `hook` text at 0 to 150 and a `label` text from 200 to 340 in the box 9, 30, 91, 37, `audio.music` gain 0.6 with `fadeOut` 15. Task B document: one talking shot of 195 frames with `"sound": { "gain": 1 }` and a `punch-in` on the frame of the word "surprised" (81), a 75-frame b-roll shot by `crossfade`, `captions.box` 9, 50, 85, 63 with 18 words from `words`, music with `"duck": { "to": 0.15, "under": "captions" }`.

## Top findings

1. S4: no recipe for putting a voice into a clip or saying whether a bare audio file can be the voice (Task B depends on it).
2. S2 and S3: no recipe to make a test clip, and hand-tagged colour never satisfies `media-colour`; run `normalize`.
3. S6: the "at most 2 vitest" gate in the brief cannot be read from `pgrep -fl` (it counts shells and workers).
4. S1: one transient `internal` crash with a stack trace (other agents were editing the source).
5. S10 and S12: generic fixes (`file-missing` suggesting `init`; `--quality draft|looks` named only in the tool).

The editor's own errors (nine mistakes, about twenty codes seen) were all actionable as written.
