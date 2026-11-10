# viraleditor: word times forced onto the sound (Task C4-a)

2026-10-04. Question: the script of a talking clip is known. Does forcing those known words onto the sound (CTC forced alignment) give better word times than the speech recogniser (whisper `small.en` through `hyperframes transcribe`, then `resolve/align.ts`)?

Everything below was run on this machine unless it says "read" or "not measured". **Nothing was judged by ear**: every statement about sound is a level measurement. The sample is small and of one kind: the speech spike's three stand-in clips (`spike/viraleditor-speech/assets/720/s1…s3.mp4`, 12 s + 9 s + 9 s, 88 script words, one voice, cut from one finished video). No generated speaker clip was tried.

---

## 1. Result in short

**Yes for the large errors, no for the median.** Against 21 word starts that can be read from the level of the sound, the recogniser's word starts are off by 7 ms in the median and **170 ms at worst** (4 of 21 further than one video frame, 33 ms); the aligner's by 14 ms in the median and **58 ms at worst** (2 of 21 further than one frame; 90th percentile 31 ms against 73 ms). With a larger, less certain reference (30 starts): recogniser 27 ms median, 193 ms worst; aligner 14 ms median, 82 ms worst. The aligner's times are tied to the 20 ms frames of its model, so it cannot beat the recogniser where the recogniser is already right; what it removes is the recogniser's occasional word placed 0.1–0.4 s off: "Let" 170 ms early inside a pause, "No" 110 ms early, and the brand name "ACME." about 370 ms late, in the silence after the word (not in the 21: see §3.1, disputed). It also repeats itself (per clip against the whole 30 s: 4 ms median, 82 ms at most; the recogniser: 43 ms, 323 ms), places a brand name as one word, and its score tells a clip that speaks its lines (mean 0.92–0.97) from one that does not (0.20–0.39). It costs a second Python environment (412 MB on disk, torch + torchaudio, a 378 MB weight file), 1–5 s and 1.1–1.8 GB of memory per clip. It should not be used for another language than English, for a clip whose script is not what is spoken (it forces the words anyway: the times are then meaningless and only the score says so), or as a measure of pauses: its word ends come early, so its gaps overstate them.

The numbers of the speech spike (§3.4 there: recogniser median 13 ms, worst 190 ms on 22 onsets) are reproduced, but that reference has a flaw that favours the recogniser: it names the word of each onset from the recogniser's own times. Four of its 22 points are the wrong word (§3.1).

---

## 2. What was built

| File | What it is |
|---|---|
| `viraleditor/tools/align/align.py` | the tool: request `{ media, words, language }` on stdin or as a file → one JSON object `{ words: [{ text, start, end, score }], model, seconds }`; `--check` → `{ ready, note }`. Its rules are written at the top of the file |
| `viraleditor/tools/align/pylock.toml` | the pinned requirement list (PEP 751): 11 wheels, each with URL and sha256, Python 3.13, macOS arm64 |
| `viraleditor/tools/align/setup.sh` | builds `.venv` from the local uv cache, offline (`uv venv --offline`, `uv pip sync --offline`), then runs `--check` |
| `viraleditor/tools/align/test_rules.py` | the pure rules (spelling of digits, folding, the gap rule, the media check, the ffmpeg command) with plain asserts |
| `viraleditor/src/adapters/aligner.ts` | `createAligner(options): Aligner` with `ready()`, `AlignError` (`not-installed`, `language-unsupported`, `bad-media`, `tool-failed`, `bad-output`, `timeout`), the media checked before the child starts, the answer checked with zod and by hand |
| `aligner.test.ts`, `aligner.real.test.ts` | 31 fast tests against a stub child; 11 tests against the real tool (`VE_ALIGN=1`) |

How it works: ffmpeg decodes the first sound stream to 16 kHz mono; torchaudio's wav2vec2 "base" model, fine-tuned on 960 h of LibriSpeech (`WAV2VEC2_ASR_BASE_960H`), gives a probability for each of 29 labels (26 letters, apostrophe, word break, blank) on every 20 ms frame; `torchaudio.functional.forced_align` finds the most probable path that spells the given words in order. A word starts on the frame of its first letter and ends after the frame of its last one. Plain torchaudio does the job; WhisperX and its dependencies (pyannote, faster-whisper, transformers …) are not installed and not needed.

The environment: built offline [ran: `./setup.sh` steps by hand, "Installed 11 packages in 289ms"]. The uv cache holds the wheels but no index page for torch, so `uv pip compile --offline` cannot resolve them ("torch was not found in the cache"); a lock that names each wheel by URL and hash installs from the cache without asking an index. The URLs and hashes in `pylock.toml` were read from the cache's own pointer files (`~/.cache/uv/wheels-v6/pypi/<name>/<wheel>.http`), nothing was looked up online. Where a newer cached version had no hash stored, the version with a hash was taken (filelock 4.0.1, setuptools 83.0.0, networkx 3.6.1).

No network: the adapter starts the child with the allow-listed environment plus `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 UV_OFFLINE=1`; `align.py` replaces `socket.connect`, `create_connection` and `getaddrinfo` with a function that raises before any library loads [ran: all three raise], and loads the weights with `torch.load(local path, weights_only=True)` instead of the bundle's download helper. A system-level trace was not possible here (`sandbox-exec -n no-network` is killed inside this sandbox): not verified at that level.

ffmpeg is a separate program that this guard cannot see (found in review: a `media` of `http://…` made it open a connection). Closed in three places: the adapter refuses, before any child starts, a `media` that is not an existing regular file (a URL, `concat:`, `subfile,`, `pipe:`, `fd:`, `data:`, a leading `-`, a folder, a named pipe: `bad-media`); `align.py` checks the same before it starts ffmpeg; and ffmpeg gets the absolute path behind `file:` with `-protocol_whitelist file`, so that a local playlist cannot send it to a URL either [ran: a `.m3u8` that names `http://127.0.0.1:9/seg.ts` → ffmpeg: "Protocol 'http' not on whitelist 'file'!"].

### The rules of the tool (also at the top of `align.py`)

1. One entry per given word, in the given order, with the given text untouched.
2. What is aligned is a folded form: upper case, A–Z and the apostrophe. Accents come off ("café" → CAFE); a sign inside a word breaks it into parts aligned one after the other ("must-have" → MUST, HAVE).
3. **Numbers.** A number is spelled in English only when it is the one number of its word, 0 … 999, written as one run of one to three digits without a leading zero, in a word without letters; the signs around it are left out ("4." → FOUR, "30%" → THIRTY, "$20" → TWENTY, "№1" → ONE). Digits are never joined over a sign and nothing is guessed. Every other word with a number in it is **not aligned**: two runs of digits ("1,000", "2,500", "10,000", "2.5", "3–5", "3-5", "24/7"), digits next to letters ("1st", "x2", "4-week"), more than three digits, a leading zero, a number sign that is not 0–9 ("½", "²"). A thousands separator always means a number above 999, so those are never spelled. Nor is a word aligned that has a letter with no A–Z form ("ß", a Cyrillic word): the letter is never just left out.
4. A word that is not aligned (rule 3, or nothing left of it: "%", an emoji) shares the gap between its aligned neighbours in equal parts with the other such words there; when the gap is shorter than 20 ms per word it takes the rest from the neighbour after it, else the one before, at most half of that neighbour. Score 0.
5. Every word has `start < end`, words never overlap, all times lie inside the decoded sound.
6. `score`: the mean probability the model gives the word's letters on their frames, 0 … 1.
7. A word starts on the frame of its first letter and ends after the frame of its last one.
8. `media` is an existing regular local file; English only; sound up to 120 s.

---

## 3. Measurements

Machine: shared, load average 6–26 during these runs. Scripts and raw results: `spike/viraleditor-align/` (§6).

### 3.1 Accuracy of word starts

Recogniser = whisper `small.en` per clip + `alignWords` (what the pipeline uses today). Errors in ms; minus = too early.

| Reference | Points | Recogniser median / p90 / worst | within 33 ms | Aligner median / p90 / worst | within 33 ms |
|---|---|---|---|---|---|
| **A.** the spike's 22 onsets, as published | 22 | 13 / 87 / **190** | 14 | 31 / 160 / **278** | 12 |
| A without its 4 wrong-word points | 18 | 13 / 90 / 190 | 12 | 27 / 59 / 67 | 12 |
| **B.** starts after a pause ≥ 100 ms, interval reference | 21 | 7 / 73 / **170** | 17 | 14 / 31 / **58** | 19 |
| B against its loud point only (no interval) | 21 | 13 / 120 / 190 | 12 | 27 / 58 / 67 | 13 |
| **B-60.** the same with pauses ≥ 60 ms (larger, less sure) | 30 | 27 / 170 / **193** | 19 | 14 / 72 / **82** | 24 |

[ran: `node measure-a.mjs`, `node measure-b.mjs 100`, `node measure-b.mjs 60`]

**Reference A and its flaw.** The spike's rule: the level (10 ms RMS windows) rises to −24 dBFS after at least 100 ms under −30 dBFS; the onset belongs to the script word whose start is nearest *in one of the two recognitions*, within 100 ms. On it the aligner looks worse. But four of the 22 are not the start of the word they are named for:

- 0.10 s "tried": the sound that starts there is "I" (0.10–0.21 s), then the closure of the t. The recogniser puts "I" at 0.06–0.09 s, in silence, and "tried" on the onset. The aligner: "I" 0.12 s, "tried" 0.26 s.
- 5.73 s "this" is "So"; 7.17 s "serum," is "No" (the same pattern: the word before is put into the pause).
- 16.57 s "jojoba,": most likely the second half of the word ("pep|tides": a 60 ms burst at 16.34 s, 170 ms of closure, then the long vowel). The aligner has the word at 16.30 s, the whole-clip recognition at 16.24 s, the per-clip recognition at 16.56 s. The spike counted this point as the whole-clip recognition's worst error (330 ms); it is more likely the per-clip recognition that is about 0.26 s late. Not resolved by ear.

**Reference B, built without trusting one system.** Same pauses and the same loud point. The word's audible start is taken to lie in an interval `[first, loud]`: `first` is where the level reaches −30 dBFS, or where the band above 4 kHz rises 10 dB over its floor (a quiet f, s, th or h before the vowel: 9 of the 21 starts), never more than 150 ms before `loud`. A system's error is its distance to the interval. The word: per system, the first script word that starts after the quiet begins; a point counts only when both systems name the same word and one of them is within 150 ms. Of 26 pauses that gives 21 points, 3 pauses inside a word (both systems agree nothing starts there) and 2 disputed.

Further than one frame (33 ms) on B: recogniser "Let" −170, "No" −110, "Lashly" +73, "And" −60; aligner "No" +58, "for" −37.

**Disputed (in no statistic):**

| Pause | Recogniser | Aligner | Other evidence [ran] |
|---|---|---|---|
| 13.99–14.56 s | "ACME." starts 13.99 s, at the end of the sound | "ACME." 13.62–14.14 s | the loud block is 13.65–13.98 s; sound in the recogniser's span of the word 49 %, in the aligner's 92 %; whole-clip recognition 13.84 s. The recogniser is about 0.37 s late on the brand name |
| 16.42–16.57 s | "jojoba," starts 16.56 s | "jojoba," 16.30–16.95 s | whole-clip recognition 16.24 s (see above) |

With pauses ≥ 60 ms there are 6 disputed and 6 inside a word; one more large recogniser error shows up among the points ("from" +193 ms: the three words before "ACME." are all late in clip s2).

**C. Starts put into silence** (all 88 words; no sound for 100 ms or more after the start): recogniser 2 ("Let" 170 ms, "No" 110 ms), aligner 0.

**Repeatability** (88 word starts, each clip alone against the whole 30 s clip) [ran: `node scores.mjs`]:

| | median | p90 | max | words over 100 ms |
|---|---|---|---|---|
| Recogniser | 43 ms | 130 ms | 323 ms | 14 |
| Aligner | 4 ms | 21 ms | 82 ms | 0 |

Limits of this reference: it is the level, not an ear; it only covers words after a pause (21–30 of 88); a word inside fluent speech has no reference at all, and that is where "from" and "ACME." sit.

### 3.2 Pauses

[ran: `node measure-b.mjs 100`; 21 of the 26 pauses lie between two words of one clip]

| | Recogniser | Aligner |
|---|---|---|
| Leaves a gap ≥ 100 ms at a pause | 3 of 21 | 20 of 21 |
| Median gap at a pause (the quiet stretch itself: 320 ms median) | 40 ms | 441 ms |
| Gap minus quiet stretch: median (range) | −270 ms (−570 … −10) | +70 ms (−200 … +801) |
| Gaps ≥ 0.35 s in all (pauses of that length by level: 7) | 0 | 10, every one on a real pause (6 of ≥ 0.35 s, 4 of 0.19–0.34 s) |
| Gaps ≥ 100 ms that are not on a pause | 4 of 7 | 24 of 40 |

The spike's example, the pause before "Let me show you": the level is under −30 dBFS for 0.31 s (3.47–3.78 s). The recogniser leaves 0.12 s there (per clip), the aligner 0.46 s: its "Let" is on the onset (0 ms), but its "weeks." ends at 3.32 s, before the quiet s of the word has faded.

So the aligner does not hide pauses, and a rule such as "new caption group after 0.35 s" fires where there is a pause, which it never does on the recogniser's times. But its gap is not the length of the pause. A word ends after the frame of its last letter; on words that end in a long vowel or a nasal that is 100–300 ms before the sound ends ("zero." −163, "nothing." −251, "now." −296 ms), on words that end in a stop it is within 40 ms. Reading the word break of the model instead of the last letter is no better (median error 103 ms against 116 ms) [ran: `node ends.mjs`]. And 24 of its 40 gaps of 100 ms or more lie inside fluent speech: a short gap means nothing.

### 3.3 Brand names, digits, odd words

[ran: `node run.mjs right digits odd`, `node scores.mjs`; times in clip s2]

| Word | Recogniser | Aligner | Score |
|---|---|---|---|
| "Lashly" | heard as "Lash" + "Lee", 0.57–1.23 s: start +73 ms | 0.461–0.983 s: start inside the interval (0 ms) | 0.98 |
| "ACME." | heard as "Ack" + "Me.", 1.96–2.88 s: in the pause after the word | 1.584–2.105 s, on the loud block (1.62–1.95 s) | 0.83 |

- **Digits.** Script s1 with "4", "0." and "4." in the place of "four", "zero." and "four.", s3 with "2": the times are identical to the spelled script (largest difference 0 ms). Other ways to write a number ("1,000", "2.5", "3–5", "24/7", "1st", "½") are not spelled but placed by the gap rule [ran: `test_rules.py`]; none occurs in this script, so no real sound was aligned against one.
- **Words the model cannot spell.** `→`, `✨`, `%`, `2026`, a Cyrillic word and an emoji put into script s2: each gets a share of the gap between its neighbours (`✨` 2.105–2.947 s between "ACME." and "Aloe,"; `%` and `2026` back to back in the gap before "and"), score 0; no aligned word moves (0 ms).
- **A brand whose spelling is far from its sound** (a French or Chinese name, an acronym read letter by letter): not measured. The word is forced between its neighbours either way; expect a low score.
- The model's own reading of the clips, without the script: "LASH LEE SERUM FROM ACK ME ALOE SHAY JOJOBA". It does not know these words; forced alignment does not need it to.

### 3.4 A clip that says something else

[ran: `node run.mjs wrong odd`, `node scores.mjs`; score = mean frame probability of the word's letters]

| | Mean word score | Words with score ≥ 0.5 | Recogniser's `alignmentShare` [spike §3.4] |
|---|---|---|---|
| 3 right pairs (s1, s2, s3 on their own sound) | 0.92, 0.92, 0.97 | 38/38, 22/22, 28/28 | 1.00, 1.00, 1.00 |
| 6 wrong pairs (each script on another clip's sound) | 0.20 – 0.39 | 11 % – 27 % | 0.11 – 0.29 (the three the spike ran) |

Per word, over all pairs: a score of at least 0.5 for 88 of 88 right words (lowest: "tried" 0.50, which the speaker shortens: the recogniser hears "try") and for 16 % of 176 wrong ones. Any threshold on the mean between 0.4 and 0.9 separates these nine cases; **0.7** leaves room on both sides.

One line changed, the rest spoken: three words of s2 replaced ("Aloe," → "Vitamin,", "swipe" → "rub", "eyeliner." → "mascara."): the three score 0.32, 0.00 and 0.16; the lowest of the 19 spoken words is 0.73; none of the 19 moves. The mean of the clip stays at 0.83.

Can the score replace `alignmentShare`? On this sample it separates as well, and it also points at the single word that is not spoken. But it is nine pairs from one voice, and the aligner is told the script: it answers "does this text fit this sound", while the recogniser hears without being told. Use it to back the recogniser's check, not to replace it, until it has been tried on generated speech.

### 3.5 Time and memory

[ran: `/usr/bin/time -l python align.py request.json`, two rounds, load 6; and through the adapter with `node run.mjs`, load 9–17]

| | 9 s clip | 12 s clip | 30 s clip |
|---|---|---|---|
| Wall time, second run and later (load 6) | 1.0 – 2.1 s | 1.8 – 2.4 s | 2.4 – 2.9 s (once 14 s) |
| Wall time through the adapter (load 9–17) | 0.9 – 4.5 s | 1.0 – 3.6 s | 5.2 s |
| of which the model | 0.2 – 0.9 s | 0.4 – 0.6 s | 1.1 – 8.3 s |
| Peak memory | 1.1 GB | 1.3 GB | 1.6 – 1.8 GB |

- Cold start: the first import of torch and torchaudio in the fresh environment took 11.5 s (load about 20). A start after a reboot, with the 378 MB weight file not in the file cache: not measured.
- `--check`: 0.8 s, 0.2 GB. The real test file (8 alignments, the check, the rules): 43 s at a load above 20.
- Every run loads the model again; a process that stays alive would save about 1 s per clip. Not built.
- Sound longer than 120 s is refused (one pass through the model; memory grows with length) [ran: 121 s of silence → `failed`]. So are a file without a sound stream, a file that is not there and sound too short for the letters; each answers with one error object and exit 1 [ran].

---

## 4. Licences

No GPL or AGPL package is installed. "Disk": read from the file named, in `viraleditor/tools/align/.venv/lib/python3.13/site-packages/`.

| Package or file | Version | Licence | Where it was read |
|---|---|---|---|
| torch | 2.8.0 | BSD-3-Clause | disk: `torch-2.8.0.dist-info/METADATA` (`License: BSD-3-Clause`), `licenses/LICENSE`, `licenses/NOTICE` |
| torchaudio | 2.8.0 | BSD-2-Clause | disk: `torchaudio-2.8.0.dist-info/licenses/LICENSE` ("BSD 2-Clause License") |
| filelock | 4.0.1 | MIT | disk: METADATA `License-Expression`, `licenses/LICENSE` |
| fsspec | 2026.9.0 | BSD-3-Clause | disk: METADATA, `licenses/LICENSE` |
| jinja2 | 3.1.6 | BSD (3-clause text) | disk: METADATA classifier, `licenses/LICENSE.txt` |
| markupsafe | 3.0.3 | BSD-3-Clause | disk: METADATA, `licenses/LICENSE.txt` |
| mpmath | 1.3.0 | BSD | disk: METADATA, `LICENSE` |
| networkx | 3.6.1 | BSD-3-Clause | disk: METADATA, `licenses/LICENSE.txt` |
| setuptools | 83.0.0 | MIT | disk: METADATA, `licenses/LICENSE` |
| sympy | 1.14.0 | BSD | disk: METADATA, `licenses/LICENSE` |
| typing-extensions | 4.16.0 | PSF-2.0 | disk: METADATA, `licenses/LICENSE` |
| CPython | 3.13.13 (uv-managed) | PSF-2.0 | disk: `~/.local/share/uv/python/cpython-3.13.13-macos-aarch64-none/lib/python3.13/LICENSE.txt` |
| weights `wav2vec2_fairseq_base_ls960_asr_ls960.pth` (378 MB, sha256 `488fd4f1…958c945d`) | — | MIT | disk, a statement only: the docstring of `WAV2VEC2_ASR_BASE_960H` in `torchaudio/pipelines/_wav2vec2/impl.py` ("published by the authors of wav2vec 2.0 under MIT License and redistributed with the same license"). The file carries no licence of its own; fairseq's licence text is not on this disk |
| LibriSpeech (the training data of the weights) | — | CC BY 4.0 | from memory, not verified |

Two things for the owner to know:

- **torch's own licence file contains the texts of GPL-3 and LGPL-2.1.** `torch-2.8.0.dist-info/licenses/LICENSE` is a bundle of third-party notices (8 842 lines). The GPL-3 text stands under the heading `third_party/kineto/libkineto/third_party/dynolog/third_party/cpr/test/LICENSE` ("applies to everything inside this directory": the test folder of a library nested three levels down), the LGPL text under `third_party/opentelemetry-cpp/tools/vcpkg/ports/ffnvcodec/LICENSE.txt` (a packaging recipe for an NVIDIA codec header). By their paths neither is code that is built into the macOS wheel; that was not verified beyond the paths. torch itself is distributed as BSD-3-Clause.
- **ffmpeg** on this machine is a GPL build (`--enable-gpl --enable-version3`, read from `ffmpeg -version`). The tool starts it as a separate program, as viraleditor's `Media` and `Measure` adapters already do; it is not a new dependency.

Hypit: no file of Hypit was opened for this task. The wheels in the uv cache were put there by an install of its whisperx service (a `uv.lock` exists at `../hypit/services/whisperx/`; seen in a file listing, not read); `pylock.toml` was written from the cache's pointer files.

---

## 5. Not measured, and limits

- **A generated speaker clip.** Three stand-ins, one natural voice. How wav2vec2 scores synthetic speech, an accent, music under the voice or a noisy room is open.
- **By ear.** Nobody listened.
- **Words inside fluent speech** have no level reference; the 21–30 points are all starts after a pause.
- Other languages (the model is English only: the adapter refuses), a brand name spelled far from its sound, sound longer than 120 s, a clip with two speakers.
- Numbers other than one plain 0 … 999 per word (a decimal, a range, an ordinal, a thousands separator), acronyms read letter by letter: such a word is not aligned, its time is a share of the gap between its neighbours. How close that share comes to the spoken word was not measured.
- A cold start after a reboot; a quiet machine.
- The model's resolution is 20 ms: a word start cannot be placed finer than that.
- The environment is pinned to Python 3.13 on macOS arm64, because those are the wheels in this machine's cache. Another machine needs its own wheels and a new `pylock.toml`.

---

## 6. Files and how to run it again

```bash
cd viraleditor/tools/align && ./setup.sh                      # offline; ends with {"ready": true, "note": null}
cd ../.. && pnpm vitest run src/adapters/aligner.test.ts      # 31 fast tests
VE_ALIGN=1 timeout 900 pnpm vitest run src/adapters/aligner.real.test.ts   # 11 real tests
cd tools/align && python3 test_rules.py                       # the pure rules, any Python 3 (3.7 or newer)
```

Scratch, in `spike/viraleditor-align/` (not in git: `/spike/` is ignored), needs the speech spike's `out/tr-s*/transcript.json` and `work/original.wav`:

| File | What it does |
|---|---|
| `run.mjs` | the alignments through the adapter: `right`, `whole`, `wrong`, `digits`, `odd` → `out/<name>.json` |
| `measure-a.mjs` | reference A (the spike's 22 onsets) → `out/measure-a.json` |
| `measure-b.mjs [pause ms]` | reference B and C, the pauses, the disputed points → `out/measure-b-<ms>.json` |
| `scores.mjs` | right against wrong pairs, digits, odd words, repeatability → `out/scores.json` |
| `strip.mjs <from> <to>` | the level of the clip as a line of characters with both systems' word starts under it |
| `spans.py`, `ends.mjs` | the letter spans, the model's own reading, three readings of a word's end |
| `pointers.py` | reads URL and sha256 of the cached wheels (how `pylock.toml` was written) |

```bash
cd spike/viraleditor-align
node run.mjs && node measure-a.mjs && node measure-b.mjs 100 && node measure-b.mjs 60 && node scores.mjs
```
