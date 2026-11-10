# viraleditor: the guide for an agent

viraleditor makes a vertical video (mp4, 30 frames a second) from one JSON file, the **edit document** (`edit.json`). You write which clip is on screen from which frame, which text stands where, which word is spoken when. The editor checks the document, shows you single frames, renders, and then checks the render itself. You cannot watch a video, so every command answers in JSON and gives you pictures to open.

The program is the file `viraleditor/src/cli/main.ts` of this repository: run it as `node <repository>/viraleditor/src/cli/main.ts <command> …` from the folder you keep your projects in (paths are read from the folder you stand in; keep projects outside the repository). Below that is written `viraleditor <command>`. A command that takes a project takes its folder or its `edit.json`.

## The answer of every command

With `--json` a command prints one JSON object on stdout and nothing else (progress goes to stderr):

```
{ "ok": true, "command": "check", "issues": [], "warnings": [], "result": { … } }
```

- `issues` are errors: one entry and the command has failed. `warnings` are things to look at; the command has still succeeded.
- An issue has a `code` (stable), a `path` (a place in edit.json, `texts[1].box`) or a `target` (a file, a flag, a tool), a `message` (what is wrong, with the numbers), a `fix` (what to change) and sometimes `at` (a frame).
- `result.next` names the command to run next. Follow it when in doubt.
- Exit code: 0 ok · 1 the document or the media have errors · 2 the command was written wrongly · 3 a tool is missing or failed (run `viraleditor doctor`).

## The loop

1. `viraleditor init demo --example product-beats`: a working project, `demo/edit.json` with its media in `demo/assets/`.
2. Change `demo/edit.json`.
3. `viraleditor check demo --json`: about a second, no browser. Fix every issue by its `fix` and check again.
4. `viraleditor frames demo --at 28,92,234 --json`: PNG stills of those frames (`check` proposes the frames). Open them: is every text readable and where you want it?
5. `viraleditor render demo --sheet --json`: the video and a contact sheet, twelve frames in one picture, each with its second. Open the sheet. Read `issues` and `warnings`: they come from the render itself, read frame by frame.
6. Fix and go back to 3. The video is done when `render` answers `ok: true` and the sheet shows what you meant.

Everything the commands write lies in `demo/.viraleditor/`: `render.mp4`, `render.sheet.png`, `frames/frame-0028.png`.

## I want to …
| I want to … | Use |
|---|---|
| start from something that works | `viraleditor init <dir> --example <name>`; `viraleditor init --list` names the four examples |
| know whether the document is valid | `viraleditor check <dir>` |
| look at a frame without rendering | `viraleditor frames <dir> --at 12,48` |
| get the video | `viraleditor render <dir> --sheet` (`--out <file.mp4>`; `--quality draft\|looks`: `draft` is faster and rougher, `looks`, the default, is the one to deliver) |
| see a finished video in one picture | `viraleditor sheet <mp4>` |
| check a finished render once more | `viraleditor inspect <mp4> --timeline <dir>/.viraleditor/composition/timeline.json --edit <dir>` |
| get the frame and length of every spoken word, for captions, a card or a motion on a word | `viraleditor words <file> --script <script.txt>` (a text file of what is said); without `--script` it listens and finds the words |
| set installation Shorts hashtags (no scan; keeps other settings) | `viraleditor settings set-searches skincare skincareroutine makeupreview ugcads haircare beautytok glowup --data-dir <installation-dir> --json`; operator, after a produce run stopped with `submission-unknown` and the provider's task list has no task for that request (records who): `viraleditor settle-unknown <run id> --by <your name> --data-dir <installation-dir>` |
| know what a media file is: size, frames, sound | `viraleditor probe <file>` |
| use a clip that is not 30 fps or not the canvas size | `viraleditor normalize <in> <out> --canvas 720x1280` |
| know every field, its range and default | `viraleditor schema`, or [edit-format.md](../reference/edit-format.md) |
| know what a code means | `viraleditor codes` |
| know whether the tools are installed | `viraleditor doctor` |
| show a clip or a picture | a shot: `shots[]` with `media`, `at`, `for`; `from` chooses where in the clip it starts |
| change how one shot follows another | `shots[].in`: `cut`, `crossfade`, `push`, `whip`, `zoom`, `flash`, `dip` |
| make a picture move | `shots[].motion`: `push-in`, `pull-out`, `punch-in` |
| put words on the screen | `texts[]`: `box`, `style`, `copy` |
| show spoken words, word by word | `captions.words` |
| show a product photo over the footage | `cards[]` |
| put the talker into a corner over a picture | `shots[].windows`; a before and an after: `swaps` |
| add music, and lower it under a voice | `audio.music`, `audio.music.duck` |
| play the sound of a clip | `"sound": { "gain": 1 }` on its shot (without it a clip is silent) |
| play a sound effect | `audio.sounds[]` |
| have a text style of my own | `styles.<name>`, then `"style": "<name>"` on the text |
| count what a job of a template would ask from the paid services | `viraleditor plan <template.json>` (the pipeline's; a hand-written document needs none of it). It counts one image and one clip per shot that owns a clip: a shot that `continues` an earlier shot's clip is neither ([template-format.md](../reference/template-format.md) 2.8) |

## The edit document by example

This is `viraleditor/examples/product-beats/edit.json`, whole: a product montage of 9 seconds.

<!-- from: product-beats, whole -->
```json
{
  "version": 1,
  "language": "en",
  "canvas": { "width": 720, "height": 1280, "fps": 30 },
  "frames": 270,
  "media": {
    "pour": { "file": "assets/pour.mp4", "kind": "video" },
    "apply": { "file": "assets/apply.mp4", "kind": "video" },
    "glow": { "file": "assets/glow.mp4", "kind": "video" },
    "shelf": { "file": "assets/shelf.mp4", "kind": "video" },
    "product": { "file": "assets/product.png", "kind": "image" },
    "music": { "file": "assets/music.mp3", "kind": "audio" }
  },
  "shots": [
    { "id": "pour", "at": 0, "for": 60, "media": "pour", "motion": { "kind": "push-in" } },
    { "id": "apply", "at": 60, "for": 60, "media": "apply", "from": 15, "in": { "kind": "whip", "to": "left" }, "motion": { "kind": "punch-in", "at": 90 } },
    { "id": "glow", "at": 120, "for": 75, "media": "glow", "in": { "kind": "crossfade" }, "motion": { "kind": "pull-out" } },
    { "id": "shelf", "at": 195, "for": 75, "media": "shelf", "in": { "kind": "zoom" }, "motion": { "kind": "push-in", "to": 1.12 } }
  ],
  "texts": [
    { "id": "hook", "at": 0, "for": 54, "box": { "left": 9, "top": 15, "right": 91, "bottom": 27 }, "style": "hook", "copy": "The serum everyone keeps asking about" },
    { "id": "step", "at": 68, "for": 48, "box": { "left": 9, "top": 30, "right": 91, "bottom": 37 }, "style": "label", "copy": "Two drops, every night" },
    { "id": "proof", "at": 130, "for": 60, "box": { "left": 28, "top": 16, "right": 72, "bottom": 22 }, "style": "tag", "copy": "Day 14" },
    { "id": "offer", "at": 203, "for": 62, "box": { "left": 9, "top": 16, "right": 91, "bottom": 24 }, "style": "label", "copy": "Glow serum, 30 ml" }
  ],
  "cards": [
    { "id": "bottle", "at": 205, "for": 60, "media": "product", "box": { "left": 30, "top": 28, "right": 70, "bottom": 62 } }
  ],
  "audio": {
    "music": { "media": "music", "gain": 0.6, "fadeOut": 15 }
  }
}
```

Five rules carry most of it:

1. **Time is frames.** 30 frames are one second. `at` is the first frame of a thing and `for` the number of frames it lasts, both on the timeline of the whole video, never relative to a shot. `"at": 60, "for": 60` is the third second and the fourth.
2. **Shots tile the video.** The first starts at 0, each next one on the frame the one before ends (`at` + `for`), and `frames` is the end of the last. A transition (`in`) never changes `at`. Texts, cards and captions lie over the shots freely.
3. **A clip must be long enough.** A shot shows `for` frames of its clip from frame `from` (default 0). `crossfade`, `push` and `whip` keep the outgoing clip on screen for their own frames (8, 10, 8 by default), so that clip needs those too (a clip shorter than that is the error `media-short`). `cut`, `zoom`, `flash` and `dip` need none. `check` lists the frames of every file under `result.media`.
4. **A box is four edges in percent of the canvas.** `left` and `right` of its width, `top` and `bottom` of its height; `right` and `bottom` are edges, not sizes. The copy is laid out inside the box and shrunk until it fits; a copy that cannot fit is the error `text-too-long`.
5. **Everything is named.** `media` gives every file a key, and shots, cards and music name that key. An `id` is unique among shots, texts, cards and sounds. A field the format does not know is an error, not ignored.

### A talking video: the clip's sound, captions, a card on its words, music that goes down

From `viraleditor/examples/talking-captions/edit.json`:

<!-- from: talking-captions -->
```json
  "shots": [
    { "id": "claim", "at": 0, "for": 120, "media": "talk-one", "sound": { "gain": 1 } },
    { "id": "result", "at": 120, "for": 120, "media": "talk-two", "sound": { "gain": 1 }, "motion": { "kind": "punch-in", "at": 142 } }
  ],
  "captions": {
    "box": { "left": 9, "top": 50, "right": 85, "bottom": 63 },
    "words": [
      { "text": "Two", "at": 6, "for": 7 },
      { "text": "weeks", "at": 13, "for": 9 },
      { "text": "on", "at": 22, "for": 6 },
      { "text": "this", "at": 28, "for": 7 },
      { "text": "serum.", "at": 35, "for": 14 },
      …
    ]
  },
  "cards": [
    { "id": "bottle", "at": 28, "for": 34, "media": "product", "box": { "left": 56, "top": 16, "right": 92, "bottom": 44 } }
  ],
  "audio": {
    "music": { "media": "music", "gain": 0.5, "fadeOut": 15, "duck": { "to": 0.15, "under": "captions" } }
  }
```

- `captions.words` holds every spoken word with the frame it starts on and how long it is spoken. You cannot hear the sound, so `words` gives the times. Pass `--script` when you know what is said (a text file; `[marks]` and line breaks are not words): it places exactly those words on the sound, right to a few hundredths. Without it the transcriber finds the words, and after a pause it starts the next word up to a second early. `viraleditor words voice.mp4 --script script.txt --json` answered (shortened):

```json
{ "words": [
    { "text": "I", "start": 0.1201, "end": 0.1402, "frame": 4, "frames": 1, "score": 0.9987 },
    { "text": "tried", "start": 0.2603, "end": 0.4605, "frame": 8, "frames": 6, "score": 0.5042 },
    …
  ], "source": "aligner", "seconds": 1.3 }
```

  Copy `text`, `frame` (as `at`) and `frames` (as `for`). A word with score 0 is named in a warning (`word-unplaced`): its time is a guess; look at its frame. A word may not start before the one before it ends.
- The editor gathers the words into groups by itself: at most three words, a new group after a pause of 15 frames or after a word that ends in `.`, `!` or `?`. The word being spoken is yellow and a little larger. `captions.group` and `captions.active` change that; `"group": { "words": 1 }` shows one word at a time (see Limits for how `inspect` and `render` judge a group of one or two words).
- The card stands from frame 28, the frame "this" starts on, so the bottle appears as it is named. Punch-in on the word that matters ("never", frame 142) is the same idea for the picture.
- `duck` lowers the music to 0.15 while caption words are spoken and brings it back in the pauses. `"under": "sound"` ducks while a shot plays its own sound.
- After the render one pass brings the whole mix to −14 LUFS (`audio.master`). Set gains for the balance between the tracks, not for loudness.

### A before and an after: the talker in a window

From `viraleditor/examples/before-after/edit.json`:

<!-- from: before-after -->
```json
      "id": "talk", "at": 0, "for": 210, "media": "talk", "sound": { "gain": 1 },
      "windows": [
        { "at": 45, "for": 135, "corner": "top-right", "behind": "before", "swaps": [{ "at": 112, "behind": "after" }], "behindMotion": { "kind": "push-in" } }
      ]
```

A window is as high as it is wide (`width`, in percent of the canvas width, default 38), so it may be at most 50 wide under the default safe area (`both`, `reels`) and 60 under `tiktok` and `none`; a wider one is the error `window-range`, and its fix names the limit. From frame 45 the shot shrinks into the top right corner (10 frames) while the picture `before` fills the frame; on frame 112 the picture behind changes to `after` by a cut; the window returns over its last 10 frames and the shot fills the frame again at frame 180. The talker keeps talking throughout.

`viraleditor/examples/minimal/edit.json` is the least a document may hold: `version`, `language`, `canvas`, `frames`, one entry of `media`, one shot.

## What exists without being listed

**Text styles** (`"style"`): sizes are for a canvas 1080 wide and scale with it.

| Style | Looks | For | Comes and goes |
|---|---|---|---|
| `hook` | Inter 800, 72 px, white with a black outline and a soft shadow | the first line, the claim | pops in over 8 frames, fades out over 6 |
| `label` | Inter 600, 44 px, white with a black outline | a fact, a step, a name | fades 6 / 6 |
| `tag` | Inter 700, 40 px, white on a pink plate | a short mark: "Day 14", "New" | pops 6, fades 6 |
| `caption` | Montserrat 900, 84 px, capitals, white with a black outline | the captions | each group pops in over 5 |

A style of your own goes into `styles` with `font` (Inter or Montserrat), `weight`, `size` (px on this canvas), `align`, `fill`, `shadows`, and optionally `outline`, `plate`, `upper`. Give every text over footage an `outline` or a `plate`: that is what keeps it readable on a bright picture.

**Transitions** (`shots[].in`, on the incoming shot; `frames` changes the length): `cut` · `crossfade` 8 · `push` 10 and `whip` 8 (both need `"to"`: left, right, top or bottom; a whip is a push with blur) · `zoom` 8 · `flash` 6 (white) · `dip` 12 (to black and back).

**Motion** (`shots[].motion`): `push-in` grows from 1 to 1.08 over the whole shot, `pull-out` shrinks from 1.08 to 1, `punch-in` jumps to 1.2 on the frame `at` and stays. A scale lies between 1.01 and 1.5. `shots[].focus` (`[x, y]` in percent of the picture) is the point a zoom holds and a crop keeps.

**Enter and exit** (`enter`, `exit` on a text or a card): `none`, `fade`, `pop`, `slide` (needs `from` or `to`: a side), `blur`. An element needs at least one frame between its enter and its exit.

## The safe area

The platforms lay their own interface over the video. Picture the canvas as 100 wide and 100 high. A text, the captions and a card must lie inside the rectangle from 6 to 94 across and from 14 to 65 down. In the lower right of that rectangle stands the column of the platform's buttons: from 86 across to the edge, from 45 down. So a box above 45 may run from 6 to 94; a box that reaches below 45 must end at 86. That is why the captions of the example end at `"right": 85`.

`"safe": "tiktok"` at the top of the document makes the rectangle taller (8 to 78 down), `"safe": "none"` switches the check off, and `"safe": false` on one text, card or the captions lets that one leave the area. A box outside is the error `outside-safe-area`, and its fix gives the nearest box that fits.

## Reading an issue

The example with three faults (a hook far too long, a label box at `"right": 99`, a card that names a media key that is not there). `viraleditor check demo/faulty.json --json` answered with exit 1:

```json
  "issues": [
    {
      "code": "outside-safe-area",
      "path": "texts[1].box",
      "message": "texts[1].box is { left: 9, top: 30, right: 99, bottom: 37 } and leaves the rectangle (right 99 > 94); the safe area of \"safe\": \"both\" is the rectangle { left: 6, top: 14, right: 94, bottom: 65 } without the column of the platform's buttons (x 86 … 100, y 45 … 65), in percent of the canvas",
      "fix": "use { left: 6, top: 30, right: 94, bottom: 37 }, the nearest box that fits, or add \"safe\": false to texts[1] if the platform's buttons may cover it"
    },
    {
      "code": "media-unknown",
      "path": "cards[0].media",
      "message": "cards[0].media is \"bottle\", but \"media\" has no such key; it has: pour, apply, glow, shelf, product, music",
      "fix": "use one of those keys, or add \"bottle\" to \"media\" with its file and kind"
    },
    {
      "code": "text-too-long",
      "path": "texts[0].copy",
      "message": "texts[0].copy does not fit: at the smallest size allowed (29 px; the style's size is 48 px, \"shrink\" 0.6) it needs 3 lines, 2 are allowed",
      "fix": "raise texts[0].lines to 3, or shorten the copy, or lower texts[0].shrink (not below 0.5), or widen texts[0].box"
    }
  ],
```

- `path` is where to edit: `texts[1]` is the second entry of `texts` (counting from 0).
- `fix` is exact: it names the value to write. Apply it, or choose the other way it offers (here: a shorter hook is better than three small lines).
- One mistake can give several issues (a shot that starts two frames late moves every shot after it). Fix the first of a kind and check again.
- When the shape of the document is wrong (a missing field, an unknown one), only the shape is reported: `result.stage` is `"schema"`, and the rules are checked once the shape is right.
- `render` adds what only a finished video shows. Errors: `black-frames`, `frozen-frames`, `wrong-footage`, `text-missing`, `silent`, `clipping`, `output-mismatch`. Warnings: `low-contrast` (add an outline or a plate), `dark-footage`, `still-footage`, `too-quiet`, `too-loud`, `text-unverified`. A render with an error is kept and named in `result.file`, with `"failed": true`.

## Looking at your work

`viraleditor frames demo --at 28,92,234 --json` answered with one entry per frame under `result.frames`, the first of them `{ "frame": 28, "second": 0.933, "file": "/work/demo/.viraleditor/frames/frame-0028.png" }`.

`viraleditor render demo --sheet --json` answered with exit 0 (shortened: the facts that matter, three of the twelve tiles):

```json
  "result": {
    "file": "/work/demo/.viraleditor/render.mp4",
    "failed": false,
    "frames": 270,
    "seconds": 9,
    "sound": true,
    "renderSeconds": 6.08,
    "sheet": {
      "file": "/work/demo/.viraleditor/render.sheet.png",
      "tiles": [
        { "tile": 1, "row": 1, "column": 1, "second": 0.367, "frame": 11 },
        { "tile": 2, "row": 1, "column": 2, "second": 1.1, "frame": 33 },
        { "tile": 12, "row": 3, "column": 4, "second": 8.6, "frame": 258 }
      ]
    },
    "next": "Look at /work/demo/.viraleditor/render.sheet.png: tile n shows the second listed under sheet.tiles. Fix what you see or what the warnings name, and render again; otherwise the video is done."
```

(`/work` stands for the folder the commands were run in.)

- Open the stills before you render: a still shows the exact pixels of that frame, so small text can be read on it. Look at one frame inside every text, card and caption group (`check` lists such frames under `result.stills`).
- Open the sheet after you render: it shows the flow. Every tile carries its second in its corner. Is the hook there in the first tile? Does every shot show the clip you meant? Does a text sit on something it should not cover?
- In the media that `init` makes, the two white bars on a clip are its frame number (they move every frame) and the letters on a picture are its name. They are stand-ins: put your own files in their place.

## Your own media

Copy the files into `<project>/assets/` (names of letters, digits, `.`, `_`, `-`), give each a key in `media` with its `kind` (`video`, `image`, `audio`), and run `check`.

- `viraleditor probe <file>` says what a file is before you use it: frames, size, whether it has sound.
- A clip must run at 30 frames a second (`media-fps`, an error). Clips of another size, without a keyframe every second, with a variable frame rate or without colour tags give warnings (`media-size`, `media-keyframes`, `media-vfr`, `media-colour`). One command cures all five, and the fix of the issue prints it with your paths: `viraleditor normalize <in> <out> --canvas 720x1280`.
- A picture should have at least the pixels of the box it fills (`image-small`). A card shows its whole picture (`"fit": "contain"`); `"fit": "cover"` fills the box and crops.
- Music must be at least as long as the video, or carry `"loop": true`.
- A test clip that moves and passes `check` without a warning (`testsrc2` moves every frame; a `color` or slow `gradients` clip is flagged `still-footage` on purpose). ffmpeg writes all three colour tags only with the `setparams` filter; without it run `normalize` once and use the copy:
  `ffmpeg -f lavfi -i "testsrc2=size=720x1280:rate=30:duration=7" -vf "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709" -c:v libx264 -pix_fmt yuv420p -g 30 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -an assets/clip.mp4`
- A voice-over can be its own audio file: give it a key (`kind: "audio"`; `.aiff` and `.mp3` work) and play it as a sound, `"sounds": [{ "id": "voice", "media": "voice", "at": 60, "gain": 1 }]` under `audio`. `words <voice file> --script script.txt` gives its words; add `at` of the sound to every word's `frame` for `captions.words`. Music then ducks with `"under": "captions"` (or periods); `"under": "sound"` hears only a shot's own sound, not `audio.sounds`. A voice that belongs to a clip instead (a talker): put it into the clip and play the shot's sound with `"sound": { "gain": 1 }`:
  `ffmpeg -f lavfi -i "testsrc2=size=720x1280:rate=30:duration=4" -i voice.aiff -filter_complex "[1:a]apad,atrim=0:4[a]" -map 0:v -map "[a]" -c:v libx264 -pix_fmt yuv420p -g 30 -c:a aac -ar 48000 talk-raw.mp4`, then `viraleditor normalize talk-raw.mp4 assets/talk.mp4 --canvas 720x1280` (the sound is kept).
- For a delivery in full size write `"canvas": { "width": 1080, "height": 1920, "fps": 30 }`. Boxes are percent and the styles above scale by themselves; a `size` in a style of your own is px and does not.

## Habits the examples follow

- The hook is on screen from frame 0 and gone before the first cut; one thought, two lines at most.
- In the montage the picture changes every 2 to 2.5 seconds and every shot moves a little (`push-in`, `pull-out`).
- A loud transition (`whip`, `zoom`) is followed by a quiet one (`crossfade`, `cut`), and no text sits across a whip.
- A text other than the hook starts a few frames after its shot and ends a few frames before the next one.
- The product card comes on the frame the product is named. In the talking video it stands in the upper part, away from the captions.
- The captions sit between 50 and 63 down and end at 85 across, and no text shares their band.

## Limits

- Canvas 720×1280 or 1080×1920, 30 frames a second. At most 60 seconds; a shot at most 15.
- Text is Latin: Latin, Latin-1 and Latin Extended-A (Turkish, Polish, German, French …). Another script is the error `text-glyph`. Two fonts: Inter and Montserrat.
- No speed change, freeze, reverse or rotation; no curves of your own: motion is chosen from the kinds above.
- At most 24 elements with a blur (`whip` transitions, `blur` enters and exits).
- Captions without the source clips: `inspect` without `--edit` cannot look for the active colour, so a caption group of one or two words with a marked (active) word is the warning `text-unverified`, never an error and never silence. `render` passes the source clips and judges such a group by what lies over the footage; a group with two or more other words and too little text colour is `text-missing`.

The full list of fields is `viraleditor schema` ([edit-format.md](../reference/edit-format.md)); the full list of codes is `viraleditor codes`.
