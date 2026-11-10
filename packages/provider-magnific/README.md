# `@viral-clone/provider-magnific`

Hypit project Provider for the [Magnific REST API](https://docs.magnific.com) (the renamed Freepik API).
Plain ESM JavaScript, no build step. It implements existing Hypit model capabilities; the models are unchanged.

| Capability | Submit | Poll |
| --- | --- | --- |
| `@hypit/seedance@1#seedance-2` | `POST /v1/ai/video/seedance-2-pro-{480p,720p,1080p,4k}` | `GET /v1/ai/video/seedance-2-pro/{id}` |
| `@hypit/seedance@1#seedance-2-fast` | `POST /v1/ai/video/seedance-2-fast-{480p,720p}` | `GET /v1/ai/video/seedance-2-fast/{id}` |
| `@hypit/seedance@1#seedance-2-mini` | `POST /v1/ai/video/seedance-2-mini-{480p,720p}` | `GET /v1/ai/video/seedance-2-mini/{id}` |
| `@hypit/seedance@1#seedance-2.5` | `POST /v1/ai/video/seedance-2-5-pro-{480p,720p,1080p}` | `GET /v1/ai/video/seedance-2-5-pro-{res}/{id}` |
| `@hypit/nano-banana@1#nano-banana-pro` | `POST /v1/ai/text-to-image/nano-banana-pro` | same path `/{id}` |
| `@hypit/gpt-image@1#gpt-image-2` | `POST /v1/ai/text-to-image/gpt-image-2`, or `…/gpt-image-2-edit` when references are present | same path `/{id}` |

Magnific offers no Nano Banana 2 endpoint, so `nano-banana-2` is not implemented.

## Lifecycle

Auth is the `x-magnific-api-key` header (not Bearer). `start` uploads each reference once
(`POST /v1/ai/uploads/request-url` → `PUT upload_url` with the returned signed headers → `asset_url`),
submits the JSON body, checkpoints the `task_id` as the receipt and returns pending. `poll` maps
`CREATED`/`IN_PROGRESS` to pending, `FAILED` to a failure carrying `data.error`, and `COMPLETED` to
ready. `COMPLETED` with an empty `generated` array is a failure, not a pending job. `collect`
downloads every `generated` URL right away (Seedance links expire after 30 minutes) and stores it
through `context.resources`. The key goes only to `api.magnific.com`, never to storage or CDN URLs.
Signed URLs are redacted from failure messages. HTTP 429/5xx and network errors during `poll` retry.
A network error on the submit POST is reported as `MAGNIFIC_SUBMISSION_UNKNOWN`: check the task list
before submitting again. Magnific documents no cancel endpoint.

## Field mapping

| Hypit port | Seedance | Nano Banana Pro | GPT Image 2 |
| --- | --- | --- | --- |
| `prompt` | `prompt` | `prompt` | `prompt` |
| `referenceImage` / `images` | `reference_images: [url]` | `reference_images: [{image, mime_type}]` | `reference_images: [url]` (edit endpoint) |
| `referenceVideo` | `reference_videos: [url]` | | |
| `referenceAudio` | `reference_audios: [url]` | | |
| `firstFrame` / `lastFrame` | `image` / `image_end` | | |
| `duration` | `duration` (integer) | | |
| `aspectRatio` | named enum, see below | `aspect_ratio` as written (`9:16`) | named enum, see below |
| `resolution` | selects the endpoint path | `resolution` (`1K/2K/4K`) | `resolution` lowercased (`1k/2k/4k`) |
| `generateAudio` | `sound_effects`; when `true` also `no_music: true` | | |
| `outputFormat` | | `png` only (not sent) | |
| `background` | | | `background` (`opaque`, `auto`) |
| constant | | `num_images: 1` | `num_images: 1` |

Named ratios: `1:1` square_1_1, `4:3` classic_4_3, `3:4` traditional_3_4, `16:9` widescreen_16_9,
`9:16` social_story_9_16, `21:9` film_horizontal_21_9; GPT Image 2 adds `3:2` standard_3_2,
`2:3` portrait_2_3, `2:1` horizontal_2_1, `3:1` banner_3_1.

Choices worth knowing:

- **`generateAudio="true"` sends `no_music: true`.** Magnific documents `no_music` as keeping dialogue
  and sound effects while suppressing the music bed; that suits UGC/talking shots. Seedance 2.0
  ignores `sound_effects` when reference audio is attached (the soundtrack follows the reference).
- **`person-reference` is accepted and not transmitted**: Magnific has no field for it (same as Monid).
- **`aspect-ratio="adaptive"`** is sent as an omitted `aspect_ratio` in frame mode, where Magnific makes
  the output follow the first frame. Without a first frame Magnific has no adaptive ratio (it would
  render 16:9), so the request is reported unsupported. In frame mode Magnific ignores any explicit
  ratio and follows the first frame, so crop the frame to the target ratio first.

## Unsupported requests (reported by `hypit plan` before any upload)

- Seedance `web-search="true"`; Seedance 2.5 `duration="-1"` (Magnific takes 4–30 s).
- Seedance reference audio other than MP3/WAV, reference video other than MP4/MOV, images other than PNG/JPEG/WebP.
- Seedance 2.0 reference video over 50 MB or audio over 15 MB; Seedance 2.5 video over 200 MB.
- Seedance 2.0 reference audio without a reference image or video.
- Nano Banana Pro `output-format="jpg"` (no output-format field; Magnific returns PNG).
- GPT Image 2 `background="transparent"`; ratios `auto`, `1:2`, `1:3`, `9:21`, `5:4`, `4:5`; a reference over 20 MiB or more than 64 MiB in total.

Limits the Provider cannot check without decoding media, enforced by Magnific at submit:
Seedance 2.0 reference videos 2–15 s each and ≤15 s combined, 24–60 fps, 409,600–2,086,876 pixels;
reference audio 2–15 s each and ≤15 s combined. Seedance 2.5 reference videos 2–30 s (≤30 s combined),
reference audio 2–60 s. Seedance 2.5 adds reference-video seconds to the billed length.

## Profile

The key is read from the environment (`@hypit/credential-store-env`); the Profile holds no secret.

```json
{
  "credentials": { "env": { "use": "@hypit/credential-store-env" } },
  "endpoints": {
    "magnific.default": {
      "use": "@viral-clone/provider-magnific",
      "config": { "apiKey": { "store": "env", "key": "MAGNIFIC_API_KEY" }, "defaultConcurrency": 3 }
    }
  },
  "bindings": {
    "@hypit/seedance@1#seedance-2": "magnific.default",
    "@hypit/seedance@1#seedance-2-fast": "magnific.default",
    "@hypit/seedance@1#seedance-2-mini": "magnific.default",
    "@hypit/seedance@1#seedance-2.5": "magnific.default",
    "@hypit/nano-banana@1#nano-banana-pro": "magnific.default",
    "@hypit/gpt-image@1#gpt-image-2": "magnific.default"
  }
}
```

Optional config: `baseUrl` (default `https://api.magnific.com`), `pollIntervalMs` (5000),
`requestTimeoutMs` (120000, one API call), `operationTimeoutMs` (3600000, one remote task),
`actionLimits` (`submit`/`poll`/`collect` concurrency and rate). Pricing: Magnific's credit page
`https://www.magnific.com/ai/docs/ai-video-generator-credits` (no pricing API exists).

## Running Hypit with the key

Export `MAGNIFIC_API_KEY` in the shell that runs `hypit` (read it from your own secret store; never print or commit it):

```bash
export MAGNIFIC_API_KEY=...                 # your own key
hypit doctor --endpoint magnific.default   # free GETs: key accepted, routes exist
hypit check <project>/<file>.svml
hypit plan <project>/<file>.svrun
hypit build <project>/<file>.svrun          # paid: only within the agreed scope
```

The Build Worker reads the key from its own environment at startup. A Worker started without the
variable cannot see the key; restart it with the variable set when no Build is active:

```bash
hypit runtime down
hypit runtime up --endpoint magnific.default
```

## Install and test

```bash
npm install ./packages/provider-magnific   # from the project root; activation is ./src/activation.js
cd packages/provider-magnific && npm test  # offline: mocked fetch, no Magnific request
```

The tests load the installed Hypit Distribution like `bin/hypit.mjs` does (`test/hypit-sdk.mjs`) and
check each mapping against the model's own port table. `productions/_provider-test/` holds a
routing Run (`provider-test.svrun`, plan only) and a negative Run (`unsupported.svrun`) whose plan
must refuse all three requests.
