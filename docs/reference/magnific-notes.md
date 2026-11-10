# Magnific wire facts (for `viraleditor/src/adapters/magnific.ts` and `routes.ts`)

Read from files in this repository on 2026-10-04. **Nothing here was checked against the live API by this task**: no request was sent. Sources: `py` = `bin/magnific.py` (the script that made the `layering-01` clips and voice), `README` = `packages/provider-magnific/README.md`, `routes.js` / `provider.js` / `errors.js` = `packages/provider-magnific/src/…`, `test` = `packages/provider-magnific/test/provider.test.js`. Those files are read for the HTTP facts only; our client is written fresh and imports nothing from them.

## Host, key, call shape

| Fact | Source |
|---|---|
| API host `https://api.magnific.com` | py:21 · provider.js:18 |
| The key goes in the header `x-magnific-api-key` (not `Authorization: Bearer`) | py:37 · README:19 · provider.js:81 |
| Bodies are JSON (`content-type: application/json`); answers are JSON objects | py:36–39 · provider.js:78–91 |
| The key is sent to the API host only, never to storage or CDN addresses | README:25 · provider.js:70, 120–122, 134 |
| A free `GET /v1/ai/uploads` answers 200 when the key is accepted | provider.js:302–312 |
| No cancel endpoint is documented | README:28 |
| An error answer is `{ message }` or `{ message, invalid_params: [{ field, reason }] }` | errors.js:17–27 · test:371 |

## Uploading a reference file

| Fact | Source |
|---|---|
| `POST /v1/ai/uploads/request-url` with `{ "files": [{ "content_type": "<type>" }] }` (with the key) | py:46 · provider.js:108–110 |
| The answer holds the slot in `files[0]` or in `data.files[0]`: `upload_url`, `asset_url`, `headers` (also `file_id`, `expires_in`) | py:47–48 · provider.js:111–114 · test:63–69 |
| `PUT <upload_url>` with the bytes, the slot's signed `headers` and our own `Content-Type`; **no key** | py:50–53 · provider.js:115–122 |
| The request then names the file by `asset_url` | py:54 · provider.js:127 |
| Accepted types: images `image/png`, `image/jpeg`, `image/webp`; Seedance reference audio `audio/mpeg`, `audio/wav` (`.mp3` is `audio/mpeg`) | routes.js:34–41 · py:44–45 · README:65 |

## A task

| Fact | Source |
|---|---|
| Submit and poll both answer `{ "data": { "task_id", "status", "generated", "error" } }` | provider.js:97–104 · py:60, 69 |
| `status`: `CREATED`, `IN_PROGRESS` (not finished) · `COMPLETED` · `FAILED` | provider.js:23, 167–185 · README:21–23 |
| The script also treats `ERROR` as failed | py:72, 127 |
| Poll: `GET <poll path>/<task id>` | py:69 · provider.js:243 |
| `generated` is a list of HTTPS addresses; the first one is the file | py:70–71 · provider.js:178–184 · test:150 |
| `COMPLETED` with an empty `generated`: **the two sources disagree.** The provider package calls it a failure at once (README:23 · provider.js:179–182); the script goes on asking, because it returns only on `COMPLETED` **and** a non-empty `generated` (py:70–71) and so treats that state as "not finished yet". Our client asks three more times at the normal pace, then gives `empty-result` | README:23 · provider.js:179–182 · py:70–71 |
| A failed task's `error` is a text, or an object with `code` and `message` / `reason` | errors.js:40–47 |
| Result addresses are signed and expire (Seedance: after 30 minutes): download at once, without the key | README:24 · provider.js:130–134 · py:77–79 |
| HTTP 429 / 5xx and network errors while polling are retried | README:26 |
| A network error on the submit leaves the outcome unknown; the script never resends ("kredi") | README:27 · provider.js:216–224 · py:58–64 |

## Routes

| Request | Submit | Poll path | Body | Source |
|---|---|---|---|---|
| Image | `POST /v1/ai/text-to-image/nano-banana-pro` | same path | `prompt`, `aspect_ratio` as written (`"9:16"`), `num_images: 1`, `reference_images: [{ image, mime_type }]` (at most 14) | routes.js:177–205, 258 · README:12, 35–45 · test:290–294 |
| Clip, Seedance 2.0 Pro (`seedance-2-pro`) | `POST /v1/ai/video/seedance-2-pro-<480p\|720p\|1080p\|4k>` | `/v1/ai/video/seedance-2-pro` | below; 4–15 s | routes.js:81–85 · README:8 |
| Clip, Seedance 2.0 Fast (`seedance-2-fast`) | `…/seedance-2-fast-<480p\|720p>` | `/v1/ai/video/seedance-2-fast` | 4–15 s | routes.js:86–90 · README:9 |
| Clip, Seedance 2.0 Mini (`seedance-2-mini`) | `…/seedance-2-mini-<480p\|720p>` | `/v1/ai/video/seedance-2-mini` | 4–15 s | routes.js:91–95 · README:10 · test:179, 198 |
| Clip, Seedance 2.5 Pro (`seedance-2.5-pro`) | `…/seedance-2-5-pro-<480p\|720p\|1080p>` | the same name **with** the resolution | 4–30 s | routes.js:96–100 · README:11 · test:216 |
| Clip, Kling 3 (`kling-v3-pro`, `kling-v3-std`) | `POST /v1/ai/video/kling-v3-<pro\|std>` | `/v1/ai/video/kling-v3` (both tiers) | `prompt`, `start_image_url`, `aspect_ratio: "9:16"`, `duration` as a **string**, `generate_audio: false`, `cfg_scale: 0.5` | py:113–117, 124 |
| Music | `POST /v1/ai/music-generation/lyria-3` | same path | `prompt`, `model: "clip"` (the script's default; the other value is `"pro"`) | py:98, 132, 69 |
| Voice | `POST /v1/ai/voiceover/elevenlabs-turbo-v2-5` | same path | `text`, `voice_id`, `stability: 0.4`, `similarity_boost: 0.75`, `speed: 1`, `use_speaker_boost: true` | py:88–89, 103–105, 69 |

Seedance bodies (routes.js:108–123, 164–171 · README:32–60 · test:181–189, 226–228):

- `duration` is an integer, 4 to the model's maximum (routes.js:134).
- From a first frame: `image` (the uploaded frame), `prompt`, `duration`, `sound_effects: false`, **no `aspect_ratio`**: with a first frame the clip follows the frame and an explicit ratio is ignored (README:57–60).
- Speaker: `reference_images: [url]`, `reference_audios: [url]`, `prompt`, `duration`, `aspect_ratio` by name, `sound_effects: true` and with it `no_music: true` (keeps speech and effects, no music bed; README:53–55). Seedance 2.0 needs a reference image or video next to reference audio (routes.js:146–148): a speaker request always has the presenter image.
- Ratio names: `1:1` square_1_1 · `4:3` classic_4_3 · `3:4` traditional_3_4 · `16:9` widescreen_16_9 · `9:16` social_story_9_16 · `21:9` film_horizontal_21_9 (routes.js:24–27 · README:47–48).
- Limits the provider enforces itself at the submit: Seedance 2.0 reference audio ≤ 15 MB and 2–15 s; Seedance 2.5 reference audio 2–60 s (README:66, 71–74). The client does not check them: a refusal there is an HTTP 4xx, nothing is started.

## What our client decides (not provider facts)

- **Ticket** = poll path + `/` + the task id, e.g. `/v1/ai/video/seedance-2-mini/<id>`. In the id every byte outside `A–Z a–z 0–9 _ -` is written `%XX` (dots too), so every ticket the client hands out is one `resume` accepts. `resume` accepts only `/v1/ai/<route segments of letters, digits, dashes>/<id in that form>`. One limit that no encoding removes: a task id that is exactly `.` or `..` cannot be asked for through a URL (the URL parser drops such a segment, also as `%2E`); its ticket is still handed out and accepted, and the wait ends as `timeout` with the ticket.
- **Submit outcome:** HTTP 2xx with `data.task_id` → accepted. HTTP 4xx → `rejected`, except 408 (a timeout is not a refusal). Everything else (no answer, timeout, 3xx, 5xx, 408, a body without a task id) → `submission-unknown`; the POST is never repeated. If `onSubmitted` throws, the client does not ask for the task and gives `submission-unknown` with the ticket.
- **A POST body is a stream that can be read once**, with an explicit `content-length`. Reason: Node's own `fetch` (Node 25.9.0, undici 7.24.4) sends a POST again when the answer is HTTP 421 and the body is a string or bytes; shown on a loopback server (`fetch-421.mjs` of the review, and the test block "Node's own fetch" in `magnific.test.ts`): 2 POSTs with a string body, 1 with the stream. With the length given, the request is not sent in chunks.
- **Redirects** of API calls are not followed (`redirect: 'manual'`): a followed redirect would carry the key header to another host.
- **Timeouts:** one API call 120 s, one upload or download 10 min, one task 30 min from its submit or from `resume`, a question every 5 s (the script used 120 s / 300 s / 1800 s / 6 s: py:38, 53, 57, 68). Task time is counted as the waits between questions plus the questions that got no answer in time.
- **A question refused for good ends the wait early:** answered by a 4xx other than 408 and 429 for 2 minutes in a row (`pollRefusedMs`; 24 questions at 5 s) → `timeout` with the ticket and the status in the message. Any other answer (a task, 408, 429, 5xx, no answer) starts the count again.
- **Download:** up to three tries (1 s, then 2 s between them); an answer of type `text/html` or `application/json` is an error page, not the file. After the third failure: `download-failed` with the ticket.
- **Base URL:** HTTPS only; plain `http` is accepted for `127.0.0.1`, `localhost` and `[::1]` alone (the loopback test).
- **`refusal(request)`** answers from the route table without sending anything or reading a file: unknown model or resolution, seconds out of range or not whole, more than 14 image references, a ratio without a name, a speaker clip on Kling. Table lookups use own keys only (a model named `constructor` is unknown).
- **Messages** never carry an address (also in the form `https:\/\/…` that JSON writes) or 8 or more characters of the key in a row.
- **Left out on purpose:** Kling's `negative_prompt` (the script sent a product-specific text: py:96, 114); the image `resolution` (`1K` / `2K` / `4K`, routes.js:185 · README:41), so the provider's default applies.
- **Tier names** are the ones in `Settings.tiers` (`seedance-2-mini`, `seedance-2.5-pro`); a dot in the name becomes a dash in the path. A Kling tier's `resolution` is not sent (the route has no such field).

## Open, needs a paid trial

- Whether the values above still match the live API (they were read, not called).
- Kling: the accepted durations, and whether `cfg_scale` and `aspect_ratio` are needed with a start image.
- Whether a finished task's result address can be fetched again after it expired (matters for `download-failed` followed by `resume`).
- The default image resolution without a `resolution` field.
- Lyria `model: "clip"`: the length of the returned music (the fake generator assumes 30 s).
