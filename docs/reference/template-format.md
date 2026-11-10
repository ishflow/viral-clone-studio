# The template and the fill

For the model that writes a `template.json` (the structure of one viral video) or a `fill.json` (one customer's adaptation of a template). The schemas are `viraleditor/src/template/schema.ts` (`Template`, `Fill`) and its rules `rules.ts`; `resolve(template, fill, media)` in `viraleditor/src/resolve/` turns the two into the edit document the editor renders. The four examples at the end are checked by `viraleditor/src/resolve/doc.test.ts`.

**A template describes, a fill decides.** The template holds the structure: shots, timing, where texts sit, what each prompt asks for. Every text in it is a *pattern* and may hold `{placeholders}`. The fill holds the final words for one customer: the copy on screen, the lines spoken, the prompts sent. A fill holds no placeholder.

**Only the fill is shown.** The video shows `fill.texts` and, as captions, the words of `fill.script`. Nothing else you write reaches the video: not a prompt, not the template's `copy`, not `source_copy`. The site shows `title`, `description`, `tags`, `category` and each shot's `action`: write those for a person, and never put a prompt, a rival's brand name or the reference's wording in them.

**Both files are strict.** An unknown key is an error, not ignored. A value that fails its pattern is an error.

## 1. Values

| Value | Rule |
|---|---|
| id (shot, text, card, still, segment, style name) | a lower-case letter, then at most 23 lower-case letters, digits or `-`: `s1`, `tag-before` |
| mark name | the same rule |
| frames (`at`, `for`, `frames`) | whole numbers; the canvas runs at 30 frames per second |
| box | `{ "left", "top", "right", "bottom" }` in percent of the canvas, 0 … 100. `right` and `bottom` are edges, not insets: `left < right`, `top < bottom` |
| colour | `#rgb`, `#rrggbb` or `#rrggbbaa` |
| shadow | `"<x>px <y>px <blur>px #colour"`, for example `"0px 2px 8px #000000B3"` |
| copy (on screen) | 1 … 200 characters; `\n` forces a line break |
| prompt | 1 … 2000 characters |
| lines (one script segment) | 1 … 1500 characters, a word at most 60 |
| placeholder | `{name}`, the name of letters, digits, `_`, `.`, `:` and `-`: `{product}`, `{product_1}`. Allowed in a template's `copy`, prompts and `lines`; an error anywhere in a fill (`{Product}` and `{1}` too) |
| picture | `"product:N"` (the first photograph of the customer's product N, 1 … 5), `"product:N.M"` (its photograph M, 2 … 5) or `"still:<id>"` (a still of `stills`) |

**Which products a picture may name.** A customer gives between `products.min` and `products.max` products, each with one photograph or more.
- What a **paid request** is made from (a shot's `products`, a still's `references`, the presenter's `references`) names only products 1 … `products.min`: every customer has those. When it names a photograph `N.M` the customer did not give, the product's first photograph is used instead.
- A **card or a window** may name any product up to `products.max` and any photograph. When the customer did not give that product or that photograph, the card or window is left out of the video, and the customer is told so before paying. So never hang something essential on one.

No text may hold a control character (a line break is allowed in a copy, a prompt, the lines and the description, nowhere else) or a character that overrides the writing direction.

At most: 30 shots, 30 texts, 8 script segments, 6 stills (4 references each), 2 stills per shot, 12 cards, 6 windows, 12 tags, 5 images per product.

## 2. The template

### 2.1 Fields of both modes

| Field | Meaning |
|---|---|
| `id` | letters, digits, `-`, `_`; at most 64. Also a folder name |
| `source` | `{ "kind": "topads" \| "shorts" \| "link" \| "upload" \| "seed", "url": an http(s) address or "", "metrics": { "views", "likes", "ctr_band" } }` |
| `title`, `description`, `category`, `tags` | shown on the site |
| `mode` | `"beats"` (no speech; every shot and text has its frames) or `"speech"` (a presenter talks; time comes from the speech) |
| `canvas` | `{ "width": 720, "height": 1280, "fps": 30 }` or `{ "width": 1080, "height": 1920, "fps": 30 }`. Sizes in `styles` are pixels on this canvas |
| `products` | `{ "min", "max" }`: how many products of the customer the template takes, 1 … 5 |
| `people` | `"none"`, `"hands"` or `"face"` |
| `shots` | in time order; see 2.2 |
| `texts` | see 2.3 |
| `styles` | style name → text style; see 2.4 |
| `audio.music` | `{ "prompt", "gain" }` (gain 0 … 2), optional `"fadeOut"` (frames; the editor's default is 12) and `"duck"` (`{ "to", "ramp"?, "under" }`: the music goes down to `to`, which is at most `gain`, under `"sound"`, under `"captions"`, or in beats under a list of `{ "at", "for" }`). In a speech template the music goes down under the voice without being asked: to its `gain`, and to 0.15 when the gain is higher. Give `duck` to choose another level |
| `safe` | optional: `"both"` (the default: clear of the buttons of TikTok and Reels: left 6, top 14, right 94, bottom 65), `"tiktok"` (left 6, top 8, right 94, bottom 78), `"reels"` (as `both`), `"none"` (the whole canvas). Under every one but `none` the column of the buttons (x 86 … 100, from y 45 down to the rectangle's bottom) is cut out of the rectangle. A text, a card or the caption box outside this area is refused by the editor |

### 2.2 A shot

One shot is one generated clip. In beats a shot may instead show a later part of the clip of an earlier shot (`continues`, 2.8).

| Field | Meaning |
|---|---|
| `id` | |
| `products` | the customer's products seen in the shot: `["all"]`, `["1"]`, `["1", "2"]` or `[]`, numbers up to `products.min`. In beats their photographs are reference images of the shot's still (after the pictures of its `stills`, 2.7). A talking clip takes no photographs of its own: it starts from the presenter still, which has its own `references` |
| `motion_prompt` | beats: what moves in the clip made from the shot's still. speech: how the presenter performs the segment. Not on a shot that continues a clip (2.8) |
| `clip_seconds` | the clip length to ask for. It is asked and billed as whole seconds, at least 4. Not on a shot that continues a clip (2.8) |
| `action` | one short sentence for the site: what a viewer sees in the shot |
| `in` | optional: how the shot replaces the one before it (3.1). Not on the first shot |
| `motion` | optional: a slow zoom or a punch-in on the shot (3.2) |
| **beats only:** `at`, `for` | the frames the shot owns. The first shot starts at 0 and every shot starts where the one before it ends. At most 15 s per shot and 60 s in all |
| **beats only:** `still_prompt` | the first frame of the shot, a generated image. Say where the product sits and which part of the picture stays empty for the text |
| **beats only:** `stills` | optional: the ids of the stills the first frame is made from (2.7): at most 2, none twice |
| **beats only:** `continues` | optional: the id of an earlier shot whose clip this shot shows a later part of (2.8) |
| **speech only:** `segment` | the script segment spoken in the shot: shot 1 speaks segment 1, shot 2 segment 2, and so on. No `at`, `for`, `still_prompt` or `stills`: every talking clip starts from the one presenter still and is as long as it comes back |

In beats a clip must fit its shots: the `for` of the shot, and of every shot that continues its clip (2.8), plus the frames the next shot's `crossfade`, `push` or `whip` takes, is at most `clip_seconds` (as billed) × 30. In speech a clip asks for at most 14 s and all clips together for at most 58 s.

### 2.3 A text

| Field | Meaning |
|---|---|
| `id`, `box`, `style` | `style` is a key of `styles` or a preset of the editor (`hook`, `label`, `tag`, `caption`) |
| `copy` | the pattern the fill adapts, with placeholders: `"the best {quality}\n{category} combo"` |
| `source_copy` | the reference's own text at this place, or `""`. The adapting model never reads it and it is never shown; it is kept only so that a fill whose copy repeats it can be refused. Write `copy` in other words than the reference's |
| `lines` | optional: the most lines the copy may take, 1 … 4 (default: the lines of the copy when it has `\n`, else 2). The editor shrinks the text down to 60 % of the style's size to fit the box on these lines and refuses it beyond |
| `enter`, `exit` | optional (3.3) |
| **beats only:** `at`, `for` | the frames the text is on screen |
| **speech only:** `mark` | the text is on screen while the words of this mark are spoken |

### 2.4 A style

`{ "font": "Inter" | "Montserrat", "weight": 100 … 900, "size": px, "align": "left" | "center" | "right", "fill": colour, "shadows": [shadow, …] }`, and optionally `"upper": true`, `"tracking"` (em, −0.05 … 0.3), `"leading"` (line height as a multiple of the size, 1 … 2), `"outline": { "width": 0.02 … 0.12 em, "colour" }`, `"plate": { "colour", "radius", "padX", "padY" }` (a filled shape behind each line; em). White text over footage needs an outline or a plate to be read.

### 2.5 Speech only

| Field | Meaning |
|---|---|
| `script.segments` | `[{ "id", "lines", "seconds" }]` in speaking order, one talking clip each. `lines`: what the presenter says, with marks (2.6). `seconds`: about how long it takes |
| `presenter` | `{ "still_prompt", "references", "voice": { "voice_id", "sample_text" } }`: the one picture of the presenter that every clip starts from, the customer's photographs it is made from (`["product:1"]`, at most 4, or `[]`), and the voice. Say in the prompt where she stands and which parts of the frame stay empty for texts, cards and the window |
| `stills` | optional: `[{ "id", "prompt", "references" }]`, pictures to generate (evidence: a before, an after, a detail). `references`: pictures the image is made from (`"product:1"`, or `"still:<id>"` of a still listed before it: so an "after" keeps the framing of its "before"). Each still is one paid image per variant, so a still that no card, no window and no other still uses is refused. A beats template has stills of another use (2.7) |
| `cards` | optional: `[{ "id", "mark", "image", "box" }]`: a picture over the footage while its mark is spoken. The whole picture is shown inside the box, never cropped. Optional `radius` (percent of the width), `enter`, `exit`, `motion` (a slow zoom), `safe: false`. A full-frame picture is a card with the box `0, 0, 100, 100`, `"radius": 0` and `"safe": false`: it fills the frame and is cropped to it |
| `windows` | optional: `[{ "mark", "corner", "behind" }]`: while the mark is spoken the presenter shrinks to a small window in a corner of the safe area (`"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`) and the picture `behind` fills the frame. Optional `width` (percent of the canvas width, 20 … 50, default 38: the window is as high as it is wide and the default safe area is 51 % high, so the editor refuses more than 50 under `both` / `reels`; a template takes the same cap whatever its `safe`, an edit document under `tiktok` or `none` may go to 60), `radius` (0 … 8), `frames` (to shrink and to return, default 10), `behindMotion` (a slow zoom). Windows on marks that follow each other (fewer than 30 frames apart) become one window whose picture changes on the first word of the later mark: write a before and an after as two windows on two marks, one after the other |
| `captions` | optional: `{ "box" }`: word-by-word captions of the script. Optional `style` (default the preset `caption`), `group` (`{ "words": 1 … 4, "lines": 1 \| 2, "hold", "pause" }`), `active` (the word being spoken: `{ "kind": "colour", "colour", "scale"? }`, `{ "kind": "pill", "colour", "text"? }` or `{ "kind": "none" }`), `enter` |

Window rules: two windows never share a word; the windows of one segment have the same `corner`, `width` and `radius`; the shot of a segment with a window neither comes in nor leaves by a `zoom`.

### 2.6 The script and its marks

A mark names a run of words: `[name]…[/name]`. Texts, cards and windows refer to marks; nothing in a speech template names a frame.

```
[promise]I tried it for two weeks.[/promise] [before]So this was day one.[/before] [after]And this is today.[/after]
```

- A mark opens and closes inside one segment, holds at least one word, and its name is used once in the whole script.
- Marks may nest and may cross. Several elements may use the same mark.
- Brackets are only for marks: `[laughs]` is an error.
- The fill's script must keep every mark of the template in the same segment, around the words that take the place of the template's. It may add marks of its own.

How a mark becomes frames: from the first frame of its first word to the frame on which the next word of the segment begins (after the segment's last word: the cut), but at most 12 frames after the mark's own last word ends. On a mark too short for an element's animations the element fades in and out in at most 3 frames instead; a window on a short mark shrinks and returns faster, and under 3 frames it is left out. In a joined window (marks fewer than 30 frames apart) a change of picture that would fall on the window's last frame (a final one-frame mark) is moved one frame earlier, onto the last resting frame, instead of being dropped; the last frame stays reserved for the return.

### 2.7 Beats: a person or a place that returns

Every first frame of a beats video is generated on its own: somebody who is only described again in each shot comes out as another person each time. So a beats template may have `stills` too (and none of the other fields of 2.5):

| Field | Meaning |
|---|---|
| `stills` | optional: `[{ "id", "prompt", "references" }]`: a person or a place that is seen in two or more shots, described once. For a person: a plain picture of that person alone, front-facing, from the waist up, even light, neutral background, in the clothes of the video. In words only (apparent age range, build, hair, skin tone, clothes), never a name. `references` as in 2.5, for a person `[]`. The id of a still is not the id of a shot |
| `shots[].stills` | the ids of the stills the shot's first frame is made from. Their pictures are generated first and are the first reference images of the shot's still, in the order the shot names them, before the photographs of its `products`. The shot's `still_prompt` then says what is taken from the picture (`"The woman of the reference picture: same face, hair and clothes."`) and describes only what is new in the shot |

One still for one person. Each still is one paid image per variant, so a still that no shot and no other still uses is refused. A still is made from its prompt (and its `references`) alone: no frame of the reference video is ever sent to the image generator.

### 2.8 Beats: shots that continue one clip

The provider bills every clip at 4 s or more, and the shots of a reference are often shorter. Consecutive shots that show the same scene from the same camera position (the same place, the same framing, the same person) can be cut out of one clip: fewer images and clips are paid for, and the person is the same by construction.

| Field | Meaning |
|---|---|
| `shots[].continues` | the id of the shot that owns the clip (the first of them). The shot shows a later part of that clip: it has no image, no clip and no prompts of its own |

The first shot is written as usual: its `motion_prompt` describes the whole movement, from its own first frame to the last frame of the last shot that continues it, and its `clip_seconds` covers the frames of all of them. Each shot that continues it:

- names a shot that exists and stands earlier, and that does not continue another shot itself (one level: every part names the shot that owns the clip);
- follows the owner or another part of the same clip: every shot between the owner and it continues the same owner;
- has none of `still_prompt`, `motion_prompt`, `clip_seconds` and `stills`, and `products: []`;
- comes in by a cut, or has no `in`;
- keeps its own `at`, `for`, `action` and, optionally, `motion`.

A speech shot never continues a clip.

Where each part lies in the clip: for a clip of N frames (the clip as it came back, normalised to 30 fps) and parts of f1 … fk frames in order (each part's `for`, the last one's with the frames the next shot's `crossfade`, `push` or `whip` takes), part 1 starts on frame 0, part k ends on frame N, and the N − Σf frames no part shows are split into the k − 1 gaps between the parts as evenly as whole frames allow (the earlier gaps take the frames left over). The owner keeps `from` 0; a part's `from` in the edit document is where it starts. Example: a 150-frame clip and parts of 39, 48 and 38 frames: 25 frames are unused, the gaps are 13 and 12, the parts start on 0, 52 and 112. The beats example of 6.1 has one shot that continues a clip (`s2`).

## 3. Motion (all optional; the same names as in the edit document)

### 3.1 `shots[].in`

`{ "kind": "cut" }` (the default) · `{ "kind": "crossfade", "frames"? }` (8) · `{ "kind": "push", "to": side, "frames"? }` (10) · `{ "kind": "whip", "to": side, "frames"? }` (8) · `{ "kind": "zoom", "frames"?, "scale"? }` (8, 1.3) · `{ "kind": "flash", "frames"?, "colour"? }` (6, white) · `{ "kind": "dip", "frames"?, "colour"? }` (12, black). `side`: `"left"`, `"right"`, `"top"`, `"bottom"`. A transition never moves a cut: the shot still starts on its `at`.

Between talking clips only `cut`, `zoom`, `flash` and `dip` are possible (the others need frames after the segment's last one), with at most 30 frames.

### 3.2 `shots[].motion`

`{ "kind": "push-in", "to"?, "ease"? }` (scale 1 → 1.08 over the whole shot) · `{ "kind": "pull-out", "from"? }` (1.08 → 1) · `{ "kind": "punch-in", "at": frame, "to"?, "frames"? }` (beats only; `at` lies inside the shot). Scales are 1.01 … 1.5.

### 3.3 `enter` and `exit` of texts and cards

`{ "kind": "none" }` · `{ "kind": "fade", "frames"? }` (6) · `{ "kind": "pop", "frames"?, "from"? }` (8; exit: `"to"`) · `{ "kind": "slide", "from": side, "frames"?, "distance"? }` (8; exit: `"to": side`) · `{ "kind": "blur", "frames"?, "radius"? }` (8). Without them the editor's defaults apply (a text in a style of the template: fade 6 in and out; a card: pop 8 in and out). The enter and the exit together must be shorter than the element is on screen.

## 4. The fill

| Field | Meaning |
|---|---|
| `language` | of the copy and the speech: `"en"`, `"tr"`, `"pt-BR"` |
| `products` | `[{ "name", "images" }]`, in the customer's order, as many as the template's `products` allows. `images`: paths under `uploads/`, the first one is `product:N` |
| `texts` | text id → the copy on screen, for every text of the template. At most 200 characters, and short enough for the box: the template's `copy` shows the length that fits. Your own words: a copy that repeats the text's `source_copy` is refused |
| `shots` | shot id → `{ "motion_prompt" }`, in beats also `"still_prompt"`, for every shot of the template that owns a clip, and none for a shot that continues one (2.8): the template's patterns with every placeholder replaced by this customer's product |
| `music` | `{ "prompt" }` |
| **speech only:** `script` | segment id → the lines, for every segment, with every mark of the template |
| **speech only:** `presenter` | `{ "still_prompt" }` |
| `stills` | still id → `{ "prompt" }`, for every still of the template (speech, and a beats template with stills) |

`checkFill(template, fill)` answers `{ errors, notes }` before anything is paid. An **error** stops the run: a text, a shot, a segment or a still of the template has no entry (`fill-missing`); the fill has an entry for an id the template does not have, for a shot that continues a clip, or a field of the other format (`fill-unknown`); a placeholder is left (`unfilled:<name>`); a copy repeats the reference's text (`copy-is-source`); the script lost a mark (`mark-lost`) or its marks cannot be read (`mark-unbalanced`, `mark-empty`, `mark-duplicate`); two windows' marks share a word (`window-overlap`); the number of products does not fit (`product-count`). A **note** (`left-out`, with the card's id or the window's mark and the picture) says what this customer will not see because a product or a photograph was not given.

## 5. What a run pays for

`paidFor(template, variants)`, per variant:

| | images | clips | clip seconds | music | voice |
|---|---|---|---|---|---|
| beats | one per shot that owns a clip + one per entry of `stills` | one per shot that owns a clip | Σ max(4, ⌈`clip_seconds`⌉) over those shots | 1 | 0 |
| speech | 1 (the presenter still) + one per entry of `stills` | one per shot | Σ max(4, ⌈`clip_seconds`⌉) | 1 | 1 |

## 6. Examples

### 6.1 Beats: a template and its fill

```json
{
  "id": "two-step-01",
  "source": { "kind": "link", "url": "https://example.com/watch/1", "metrics": { "views": 1200000, "likes": 90000, "ctr_band": "" } },
  "title": "Two-step routine",
  "description": "The same woman holds up two products, one after the other, each under its name; she brings the first one closer to the camera in the same take. Music only.",
  "category": "skincare",
  "tags": ["no-talking", "face"],
  "mode": "beats",
  "canvas": { "width": 720, "height": 1280, "fps": 30 },
  "products": { "min": 2, "max": 2 },
  "people": "face",
  "shots": [
    {
      "id": "s1", "at": 0, "for": 60, "products": ["1"], "stills": ["woman"],
      "still_prompt": "A phone photograph in a bright bathroom. The woman of the reference picture: same face, hair and clothes. She stands in the lower two thirds of the picture and holds {product_1} upright next to her cheek, its label to the camera. The top quarter is empty wall. Soft daylight, vertical 9:16, no text.",
      "motion_prompt": "A short handheld clip that starts on this exact picture. She tilts her head once and smiles, then brings the product closer to the lens and holds it there; the product and its label stay sharp and unchanged. One take, no text.",
      "clip_seconds": 4,
      "action": "A woman holds up the first product",
      "motion": { "kind": "push-in", "to": 1.06 }
    },
    { "id": "s2", "at": 60, "for": 45, "products": [], "continues": "s1", "action": "She brings it closer to the camera" },
    {
      "id": "s3", "at": 105, "for": 75, "products": ["2"], "stills": ["woman"],
      "still_prompt": "A phone photograph in a bright bathroom. The woman of the reference picture: same face, hair and clothes. She stands in the lower two thirds of the picture and holds {product_2} upright next to her cheek, its label to the camera. The top quarter is empty wall. Soft daylight, vertical 9:16, no text.",
      "motion_prompt": "A short handheld clip that starts on this exact picture. She tilts her head once and smiles; the product and its label stay sharp and unchanged. One take, no text.",
      "clip_seconds": 4,
      "action": "She holds up the second product",
      "in": { "kind": "crossfade", "frames": 8 }
    }
  ],
  "texts": [
    {
      "id": "step-1", "at": 0, "for": 105,
      "box": { "left": 14, "top": 15, "right": 86, "bottom": 22 },
      "style": "line",
      "copy": "step one: {product_1}",
      "source_copy": "step one: Rivalbrand gel cleanser",
      "enter": { "kind": "pop", "frames": 8 },
      "exit": { "kind": "fade", "frames": 5 }
    },
    {
      "id": "step-2", "at": 105, "for": 75,
      "box": { "left": 14, "top": 15, "right": 86, "bottom": 22 },
      "style": "line",
      "copy": "step two: {product_2}",
      "source_copy": "step two: Rivalbrand night cream"
    }
  ],
  "styles": {
    "line": { "font": "Inter", "weight": 700, "size": 30, "align": "center", "fill": "#FFFFFF", "shadows": ["0px 2px 8px #00000080"], "outline": { "width": 0.06, "colour": "#000000" } }
  },
  "audio": { "music": { "prompt": "Instrumental only. Calm lo-fi beat at 90 beats per minute, soft keys, there from the first second. No vocals.", "gain": 0.8 } },
  "stills": [
    { "id": "woman", "prompt": "A plain photograph of one woman alone, front-facing, from the waist up: late twenties to early thirties, slim build, dark brown hair to the shoulders, light olive skin, a loose white cotton shirt. Even light, neutral grey background, vertical 9:16, no text.", "references": [] }
  ]
}
```

```json
{
  "language": "en",
  "products": [
    { "name": "Dewdrop Gel Cleanser", "images": ["uploads/u42/cleanser.png"] },
    { "name": "Dewdrop Night Cream", "images": ["uploads/u42/cream.png"] }
  ],
  "texts": { "step-1": "step one: dewdrop gel cleanser", "step-2": "step two: dewdrop night cream" },
  "shots": {
    "s1": {
      "still_prompt": "A phone photograph in a bright bathroom. The woman of the reference picture: same face, hair and clothes. She stands in the lower two thirds of the picture and holds the clear pump bottle of the product photograph upright next to her cheek, its label to the camera. The top quarter is empty wall. Soft daylight, vertical 9:16, no text.",
      "motion_prompt": "A short handheld clip that starts on this exact picture. She tilts her head once and smiles, then brings the bottle closer to the lens and holds it there; the bottle and its label stay sharp and unchanged. One take, no text."
    },
    "s3": {
      "still_prompt": "A phone photograph in a bright bathroom. The woman of the reference picture: same face, hair and clothes. She stands in the lower two thirds of the picture and holds the white jar of the product photograph upright next to her cheek, its label to the camera. The top quarter is empty wall. Soft daylight, vertical 9:16, no text.",
      "motion_prompt": "A short handheld clip that starts on this exact picture. She tilts her head once and smiles; the jar and its label stay sharp and unchanged. One take, no text."
    }
  },
  "music": { "prompt": "Instrumental only. Calm lo-fi beat at 90 beats per minute, soft keys, there from the first second. No vocals." },
  "stills": {
    "woman": { "prompt": "A plain photograph of one woman alone, front-facing, from the waist up: late twenties to early thirties, slim build, dark brown hair to the shoulders, light olive skin, a loose white cotton shirt. Even light, neutral grey background, vertical 9:16, no text." }
  }
}
```

### 6.2 Speech: a template and its fill

```json
{
  "id": "day-one-today-01",
  "source": { "kind": "link", "url": "https://example.com/watch/2", "metrics": { "views": 3400000, "likes": 210000, "ctr_band": "" } },
  "title": "Day one against today",
  "description": "A presenter shows a before and an after picture while she talks in a small window, then names the product.",
  "category": "skincare",
  "tags": ["talking", "before-after", "captions"],
  "mode": "speech",
  "canvas": { "width": 720, "height": 1280, "fps": 30 },
  "products": { "min": 1, "max": 1 },
  "people": "face",
  "shots": [
    { "id": "s1", "segment": "proof", "products": ["1"], "motion_prompt": "She is a little proud of her result. A small shrug at the before, wide eyes at the after; {product} stays by her cheek.", "clip_seconds": 8, "action": "She shows a before and an after" },
    { "id": "s2", "segment": "name", "products": ["1"], "motion_prompt": "Warm and matter-of-fact. She moves {product} up to the lens, then back, and ends on a smile.", "clip_seconds": 5, "action": "She names the product", "in": { "kind": "dip", "frames": 8 }, "motion": { "kind": "push-in", "to": 1.05 } }
  ],
  "texts": [
    { "id": "hook", "mark": "promise", "box": { "left": 14, "top": 14, "right": 86, "bottom": 24 }, "style": "title", "copy": "{period} of {product_kind}", "source_copy": "2 weeks of Rivalbrand serum", "lines": 2, "enter": { "kind": "pop", "frames": 8 } },
    { "id": "tag-before", "mark": "before", "box": { "left": 6, "top": 15, "right": 50, "bottom": 22 }, "style": "tag", "copy": "{before_label}", "source_copy": "", "lines": 1 },
    { "id": "tag-after", "mark": "after", "box": { "left": 6, "top": 15, "right": 50, "bottom": 22 }, "style": "tag", "copy": "{after_label}", "source_copy": "", "lines": 1 }
  ],
  "styles": {
    "title": { "font": "Montserrat", "weight": 900, "size": 44, "align": "center", "fill": "#FFFFFF", "shadows": ["0px 2px 8px #000000B3"], "outline": { "width": 0.05, "colour": "#000000" } }
  },
  "audio": { "music": { "prompt": "Instrumental only. Light bedroom pop under a speaking voice, steady from the first second. No vocals.", "gain": 0.1, "fadeOut": 20 } },
  "script": {
    "segments": [
      { "id": "proof", "lines": "[promise]I used {product_kind} for {period}.[/promise] [before]So this was {before_spoken}.[/before] [after]And this is {after_spoken}. I am so happy.[/after]", "seconds": 8 },
      { "id": "name", "lines": "It is [pack]the {product} from {brand}.[/pack] Try it.", "seconds": 5 }
    ]
  },
  "presenter": {
    "still_prompt": "One frame of a phone selfie video, vertical 9:16: a woman in her twenties in a bright bathroom stands a little left of the middle and holds {product} next to her cheek, label to the camera. Her eyes are at two fifths of the frame height; the wall above her head and the right quarter of the frame are empty. Soft window light, no text.",
    "references": ["product:1"],
    "voice": { "voice_id": "voice-id-from-the-provider", "sample_text": "Okay, so I have to tell you about something I have been testing." }
  },
  "stills": [
    { "id": "skin-before", "prompt": "A macro photograph for a before picture: {before_subject}, in the left half of the frame; the right side shows only plain skin. Soft even light, vertical 9:16, no text.", "references": [] },
    { "id": "skin-after", "prompt": "The photograph of the reference image again, same framing and light. One thing has changed: {after_change}. Vertical 9:16, no text.", "references": ["still:skin-before"] }
  ],
  "cards": [
    { "id": "pack", "mark": "pack", "image": "product:1", "box": { "left": 62, "top": 27, "right": 86, "bottom": 50 } }
  ],
  "windows": [
    { "mark": "before", "corner": "top-right", "width": 30, "behind": "still:skin-before", "behindMotion": { "kind": "push-in", "to": 1.06 } },
    { "mark": "after", "corner": "top-right", "width": 30, "behind": "still:skin-after", "behindMotion": { "kind": "push-in", "to": 1.06 } }
  ],
  "captions": { "box": { "left": 14, "top": 51, "right": 86, "bottom": 64 }, "active": { "kind": "pill", "colour": "#B76E79" } }
}
```

```json
{
  "language": "en",
  "products": [{ "name": "Dewdrop Barrier Serum", "images": ["uploads/u42/serum.png"] }],
  "texts": { "hook": "2 weeks of barrier serum", "tag-before": "DAY 1", "tag-after": "DAY 14" },
  "shots": {
    "s1": { "motion_prompt": "She is a little proud of her result. A small shrug on \"day one\", wide eyes on \"day fourteen\"; the small glass bottle stays by her cheek." },
    "s2": { "motion_prompt": "Warm and matter-of-fact. On \"Barrier Serum\" she moves the small glass bottle up to the lens, then back, and ends on a smile." }
  },
  "music": { "prompt": "Instrumental only. Light bedroom pop under a speaking voice, steady from the first second. No vocals." },
  "script": {
    "proof": "[promise]I used a barrier serum for two weeks.[/promise] [before]So this was day one.[/before] [after]And this is day fourteen. I am so happy.[/after]",
    "name": "It is [pack]the Barrier Serum from Dewdrop.[/pack] Try it."
  },
  "presenter": {
    "still_prompt": "One frame of a phone selfie video, vertical 9:16: a woman in her twenties in a bright bathroom stands a little left of the middle and holds the small glass dropper bottle of the reference image next to her cheek, label to the camera. Her eyes are at two fifths of the frame height; the wall above her head and the right quarter of the frame are empty. Soft window light, no text."
  },
  "stills": {
    "skin-before": { "prompt": "A macro photograph for a before picture: a woman's cheek with dry, flaky, slightly red skin, in the left half of the frame; the right side shows only plain skin. Soft even light, vertical 9:16, no text." },
    "skin-after": { "prompt": "The photograph of the reference image again, same framing and light. One thing has changed: the skin is smooth, even and hydrated. Vertical 9:16, no text." }
  }
}
```
