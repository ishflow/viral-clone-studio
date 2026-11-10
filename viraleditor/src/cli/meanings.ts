// What the codes of the document, of the media and of a render mean, for the `codes` command. The checks in edit/,
// compose/, fit/ and quality/ word every issue themselves, with the numbers of the case; this table is the short general
// form of each. codes.test.ts reads those sources: a code they give without a row here fails it, and so does a row
// whose code they no longer give, or a severity that differs.

export interface Meaning {
  severity: 'error' | 'warning';     // an error fails the command (exit 1); a warning is reported and the command goes on
  meaning: string;
  fix: string;                       // the general cure; the issue's own fix names the place and the numbers
}

/** The edit document: its shape (edit/schema.ts), its rules (edit/validate.ts) and the text that must fit (compose/, fit/). Found by `check`, before anything renders. */
export const DOCUMENT_CODES = {
  schema: { severity: 'error', meaning: 'A field is missing, of the wrong type, not a whole number where one is needed, outside its range, or unknown.', fix: 'Correct the field at the path named; unknown fields are errors, not ignored. `viraleditor schema` lists every field.' },
  'too-many': { severity: 'error', meaning: 'A list of the document is longer than its limit (shots, texts, cards, caption words, media, sounds, windows).', fix: 'Remove entries, or split the video into several documents. `viraleditor schema` gives the limit of every list.' },
  'more-issues': { severity: 'error', meaning: 'More issues were found than a list holds (100); the last entry counts the ones not listed.', fix: 'Correct the issues listed and check again: the others are listed then.' },
  'canvas-unsupported': { severity: 'error', meaning: 'The canvas is not 720×1280 or 1080×1920 at 30 fps.', fix: 'Use one of the two canvases.' },
  'too-long': { severity: 'error', meaning: 'The video is longer than 60 seconds (1800 frames).', fix: 'Remove or shorten shots and set "frames" to the end of the last one.' },
  'id-duplicate': { severity: 'error', meaning: 'Two shots, texts, cards or sounds share an id, or an id is a name the editor gives to its own elements.', fix: 'Rename one of them.' },
  'media-unknown': { severity: 'error', meaning: 'An element names a media key that "media" does not have.', fix: 'Use a key of "media", or add the key with its file and kind.' },
  'media-kind': { severity: 'error', meaning: 'A media file is of the wrong kind for its use: a shot on a sound file, a card on a video, music on a picture, the own sound of a clip that has none.', fix: 'Point the element at a file of the kind it needs, or remove the field.' },
  'media-file': { severity: 'error', meaning: 'A media file name is not "assets/<name>" with letters, digits, ".", "_" and "-" only.', fix: 'Put the file into the assets folder of the project and name it with those characters.' },
  'media-facts': { severity: 'error', meaning: 'The editor has no frame count (or size) of a media file: the file could not be read.', fix: 'Run `viraleditor probe <file>` on it; make a damaged file again.' },
  'media-size-unknown': { severity: 'error', meaning: 'A card shows its whole picture (fit "contain"), but the pixel size of the picture is not known.', fix: 'Use a picture the editor can read, or set "fit": "cover" on the card.' },
  'shots-gap': { severity: 'error', meaning: 'The shots do not tile the video: a shot does not start where the one before ends, the first does not start at 0, or the last does not end at "frames".', fix: 'Set "at" (or "frames") to the frame the message gives; a transition never changes "at".' },
  'shot-too-long': { severity: 'error', meaning: 'A shot is longer than 15 seconds.', fix: 'Split it in two shots with a cut.' },
  'clip-short': { severity: 'error', meaning: 'A shot, a window or a sound needs more frames of its file than the file has ("from" + "for" + the frames the next transition holds it).', fix: 'Lower "from" or "for", use a longer file, or give the next shot a transition without an overlap (cut, zoom, flash, dip).' },
  'transition-first': { severity: 'error', meaning: 'The first shot has a transition, and no shot comes before it.', fix: 'Remove "in" from shots[0].' },
  'transition-too-long': { severity: 'error', meaning: 'A transition takes more than half of the shot it leaves or the shot it enters.', fix: 'Lower its "frames" to the number the message gives.' },
  'motion-range': { severity: 'error', meaning: 'A scale of a motion or of a zoom is outside 1.01 … 1.5, a punch-in lies outside its shot, or a punch-in is used where only push-in and pull-out are possible.', fix: 'Use a value inside the range the message gives.' },
  'window-range': { severity: 'error', meaning: 'A window leaves its shot, is too short to shrink and return, overlaps another, differs in place from the first window of its shot, or a swap lies outside its rest.', fix: 'Move or lengthen the window as the message says.' },
  'box-out-of-range': { severity: 'error', meaning: 'A box has a value outside 0 … 100, its left is not under its right (or top under bottom), or it is smaller than 16 px or than one line of its style.', fix: 'Write the box as edges in percent of the canvas: left < right, top < bottom.' },
  'outside-safe-area': { severity: 'error', meaning: 'A text, the captions or a card leaves the safe area, or enters the column of the platform\'s buttons at its lower right.', fix: 'Use the nearest box that fits (the fix gives it), or add "safe": false to the element.' },
  'time-range': { severity: 'error', meaning: 'A text, card, sound, caption word or fade ends after the end of the video.', fix: 'Lower its "at" or "for".' },
  'animation-too-long': { severity: 'error', meaning: 'The enter and the exit of an element leave no frame on which it stands still.', fix: 'Shorten the enter or the exit, or lengthen the element.' },
  'style-unknown': { severity: 'error', meaning: 'A style name is neither a preset (hook, label, tag, caption) nor a key of "styles".', fix: 'Use one of the names the message lists, or define the style in "styles".' },
  'style-value': { severity: 'error', meaning: 'A value of a style is outside its pattern or range: a colour, a shadow, the weight, the size, the outline, the plate.', fix: 'Write the value as the message shows.' },
  'text-empty': { severity: 'error', meaning: 'A text or a caption word has nothing to show.', fix: 'Write the words, or remove the element.' },
  'text-glyph': { severity: 'error', meaning: 'The copy has a character the fonts do not cover (only Latin, Latin-1 and Latin Extended-A are).', fix: 'Remove or replace the characters the message names.' },
  'text-too-long': { severity: 'error', meaning: 'The copy does not fit its box on the lines allowed, even at the smallest size ("shrink" × the style size).', fix: 'Shorten the copy, enlarge the box, raise "lines" or lower "shrink" (0.5 at least).' },
  'caption-word-too-long': { severity: 'error', meaning: 'One caption word is wider than the caption box at the size of its style.', fix: 'Widen captions.box, or use a style with a smaller size.' },
  'words-order': { severity: 'error', meaning: 'Caption words overlap in time or are not in ascending order.', fix: 'Give every word an "at" at or after the end of the word before it.' },
  'card-duplicate': { severity: 'error', meaning: 'Two cards show the same media on the same frames.', fix: 'Remove one, or change its frames.' },
  'sound-duplicate': { severity: 'error', meaning: 'Two sounds play the same file from the same frame for the same length.', fix: 'Remove one, or change its frames.' },
  'gain-range': { severity: 'error', meaning: 'A gain is outside 0 … 2, the ducked gain is above the gain of the music, or a loudness target is outside its range.', fix: 'Use a value inside the range the message gives.' },
  'music-short': { severity: 'error', meaning: 'The music is shorter than the video and is not looped, or too short to loop.', fix: 'Use a longer file, or set "loop": true on audio.music.' },
  'duck-too-dense': { severity: 'error', meaning: 'The ducking would need more volume points than one sound element holds (512).', fix: 'Use fewer ducking ranges, a longer "ramp", or "under": "sound".' },
  'blur-too-many': { severity: 'error', meaning: 'More than 24 elements would carry a blur (whip transitions, blur enters and exits); the renderer then captures black frames.', fix: 'Replace some "whip" by "push" and some "blur" by "fade" or "slide".' },
  'unfilled:<placeholder>': { severity: 'error', meaning: 'A copy still holds a {placeholder} of a template.', fix: 'Replace the placeholder with the final words.' },
} as const satisfies Record<string, Meaning>;

/** The media files of the document (quality/inputs.ts). Found by `check`. */
export const MEDIA_CODES = {
  'media-missing': { severity: 'error', meaning: 'A file that "media" names is not there.', fix: 'Put the file into the assets folder, or point media.<key>.file at a file that exists.' },
  'media-corrupt': { severity: 'error', meaning: 'A media file cannot be read, or holds something else than its "kind" says.', fix: 'Make the file again, or give it the kind it really is.' },
  'media-fps': { severity: 'error', meaning: 'A video does not run at 30 frames a second: its frames would play at the wrong time.', fix: 'Run `viraleditor normalize <in> <out> --canvas <WxH>` and point the media entry at the copy.' },
  'media-short': { severity: 'error', meaning: 'A shot needs more frames of its clip than the clip has.', fix: 'Use a longer file, or lower "from" or "for" of the shot.' },
  'media-size': { severity: 'warning', meaning: 'A video is not of the canvas size: it is scaled in the browser, and the crop may cut the subject off.', fix: 'Run `viraleditor normalize <in> <out> --canvas <WxH>` and point the media entry at the copy.' },
  'media-keyframes': { severity: 'warning', meaning: 'A video has less than one keyframe a second: a frame may not be found exactly.', fix: 'Run `viraleditor normalize <in> <out> --canvas <WxH>` and point the media entry at the copy.' },
  'media-vfr': { severity: 'warning', meaning: 'A video has a variable frame rate: its frames do not all last the same, so a frame number is not a time and a shot may show another picture than the one at its "from".', fix: 'Run `viraleditor normalize <in> <out> --canvas <WxH>` and point the media entry at the copy.' },
  'media-colour': { severity: 'warning', meaning: 'A video carries no BT.709 colour tags: its colours may shift in the render.', fix: 'Run `viraleditor normalize <in> <out> --canvas <WxH>` and point the media entry at the copy.' },
  'media-black-edge': { severity: 'warning', meaning: 'The part of a clip that a shot uses begins or ends with black frames, or is black throughout.', fix: 'Change "from" or "for" of the shot so that the black frames are not shown, or use another clip.' },
  'image-small': { severity: 'warning', meaning: 'A picture has fewer pixels than the box it fills: it is blown up and looks soft.', fix: 'Use a larger picture, or give the element a smaller box.' },
  'audio-silent': { severity: 'warning', meaning: 'A sound file is silent.', fix: 'Use another file.' },
} as const satisfies Record<string, Meaning>;

/** A finished render, read frame by frame against its timeline (quality/output.ts). Found by `render` and `inspect`. */
export const RENDER_CODES = {
  'output-mismatch': { severity: 'error', meaning: 'The render cannot be read, or its size, rate, frame count or sound differ from what the document describes.', fix: 'Render again; if it stays, run `viraleditor check <edit.json> --deep`.' },
  'black-frames': { severity: 'error', meaning: 'The render is black on frames where the document has no dip to black.', fix: 'Look at the clip of the shot named: skip its black frames with "from", or use another clip.' },
  'frozen-frames': { severity: 'error', meaning: 'The picture does not change while a video shot should be playing.', fix: 'Set "from" to a part of the clip that moves, shorten the shot, or use another clip.' },
  'wrong-footage': { severity: 'error', meaning: 'A shot does not show the frames of its clip that the document asks for: another file, a clip that ran out, or a skip.', fix: 'Run `viraleditor probe <file>` on the clip: it needs "from" + "for" frames at 30 fps. Shorten the shot or use the right file.' },
  'text-missing': { severity: 'error', meaning: 'A text, caption or card is not visible where and when the document puts it: it did not render, or it has the colour of the footage under it.', fix: 'Add an outline or a plate to the style, or pick another fill; otherwise run `viraleditor check <edit.json> --deep`.' },
  silent: { severity: 'error', meaning: 'The render is silent although the document has sound.', fix: 'Check the gains in "audio" (0 mutes), and that the sound files are not silent.' },
  clipping: { severity: 'error', meaning: 'The sound peaks above the limit and clips.', fix: 'Lower the gain of the loudest track and keep audio.master on.' },
  'dark-footage': { severity: 'warning', meaning: 'The clip of a shot is itself black on frames the shot shows; the render shows what the clip holds.', fix: 'Skip those frames with "from", or use another clip. Ignore it when the black is meant.' },
  'still-footage': { severity: 'warning', meaning: 'The clip of a shot itself does not move on frames the shot shows.', fix: 'Use another part of the clip or another clip; a picture that is meant to stand still is an image shot.' },
  'text-unverified': { severity: 'warning', meaning: 'The check could not tell a text from the footage under it: the footage has the colour of the text.', fix: 'Look at that frame (`viraleditor frames`); if the text is hard to read, add an outline or a plate to its style.' },
  'low-contrast': { severity: 'warning', meaning: 'A text is hard to read: its colour is too close to the footage around its letters.', fix: 'Add an outline or a plate to its style, or pick a colour further from the footage.' },
  'too-quiet': { severity: 'warning', meaning: 'The sound of the render is quieter than its loudness target.', fix: 'Raise the gains in "audio" and keep audio.master on.' },
  'too-loud': { severity: 'warning', meaning: 'The sound of the render is louder than its loudness target.', fix: 'Lower the gains in "audio" and keep audio.master on.' },
} as const satisfies Record<string, Meaning>;
