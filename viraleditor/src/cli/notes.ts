// One line per field of the edit document, and the value each optional field has when it is left out. The fields
// themselves, their types and the ranges the schema checks come from edit/schema.ts (reference.ts walks it): a field of
// the schema without a line here stops `viraleditor schema`, and a line for a field that is gone fails reference.test.ts.
// A range that is a rule of edit/validate.ts (the schema only says "number") is said in the line.
import {
  ACTIVE_SCALE, CARD_RADIUS, DEFAULT_LEADING, ENTER, FPS, LIMITS, MASTER, MOTION, MUSIC, TRANSITION, WINDOW,
  captionDefaults, cardMotion, motionFrames, transitionFrames,
} from '../edit/presets.ts';
import type { Captions, Card } from '../edit/types.ts';

const [scaleMin, scaleMax] = LIMITS.scale;
const [gainMin, gainMax] = LIMITS.gain;
const scale = `${scaleMin} … ${scaleMax}`;
const gain = `${gainMin} … ${gainMax} (1 leaves it as it is)`;

export const SHAPE_NOTES = {
  Box: 'Where a text, the captions or a card may stand: four edges in percent of the canvas, each 0 … 100, left < right and top < bottom. { "left": 9, "top": 15, "right": 91, "bottom": 27 } is a band across the upper part.',
  Motion: 'A slow or sudden zoom on a picture. The scale is 1 when the picture just fills its place. A card and the picture behind a window take "push-in" and "pull-out" only.',
  Transition: 'How a shot replaces the one before it: written as "in" on the incoming shot. It never changes when the shot starts; "crossfade", "push" and "whip" show the outgoing clip for "frames" more frames, so that clip needs them.',
  Enter: 'How a text, a card or a caption group appears, over its first frames.',
  Exit: 'How a text or a card leaves, over its last frames.',
};

export const NOTES: Record<string, string> = {
  // ── the document ──
  version: 'The version of this format. Always 1.',
  language: 'The language of the copy, as a tag such as "en" or "tr": it decides upper-casing and line breaking.',
  canvas: 'The size and the rate of the video.',
  'canvas.width': 'Pixels across. 720 goes with 1280, 1080 with 1920.',
  'canvas.height': 'Pixels down.',
  'canvas.fps': 'Frames a second. Always 30.',
  frames: 'The length of the video in frames. It must equal the end of the last shot ("at" + "for").',
  background: 'The colour behind everything, where no picture covers the canvas. Opaque (no alpha).',
  safe: 'Which platform\'s safe area the texts, captions and cards must stay inside (see Safe areas). "none" switches the check off.',
  media: 'Every file the video uses, under a key the other fields refer to.',
  'media.<key>.file': 'The file, in the assets folder beside edit.json: "assets/clip.mp4". The name may not start with "." (no hidden file, not the folder, not its parent).',
  'media.<key>.kind': 'What the file is. A shot takes a video or an image, a card an image, the music and a sound an audio file.',
  styles: 'Text styles of your own. A key that is a preset name (hook, label, tag, caption) replaces that preset; a text in it then comes and goes like a style of your own (fade 6 in and out, no stagger), not like the preset.',
  shots: 'The pictures of the video, in time order. They tile it: each starts on the frame the one before it ends.',
  texts: 'Lines of text over the picture: hooks, labels, tags.',
  captions: 'The spoken words shown word by word, in groups, with the word being spoken marked.',
  cards: 'Pictures over the footage: a product photo, a screenshot.',
  audio: 'The music, sound effects and the loudness of the mix. The own sound of a clip is switched on at its shot ("sound").',

  // ── styles ──
  'styles.<name>.font': 'The typeface. Both cover Latin, Latin-1 and Latin Extended-A, nothing else.',
  'styles.<name>.weight': 'How bold, 100 … 900.',
  'styles.<name>.size': 'The size in px on this canvas, a whole number 8 … 400. A text that does not fit is shrunk down to "shrink" × this size.',
  'styles.<name>.align': 'How the lines sit in the box, left to right.',
  'styles.<name>.fill': 'The colour of the letters.',
  'styles.<name>.shadows': 'Shadow layers, each "<x>px <y>px <blur>px <colour>": "0px 4px 14px #00000080". An empty list for none.',
  'styles.<name>.upper': 'true: the copy is shown in capitals.',
  'styles.<name>.tracking': 'Space between letters in em, −0.05 … 0.3.',
  'styles.<name>.leading': 'The height of a line as a multiple of the size, 1 … 2.',
  'styles.<name>.outline': 'A line around every letter: what keeps a text readable on bright footage.',
  'styles.<name>.outline.width': 'Its width in em of the size, 0.02 … 0.12.',
  'styles.<name>.outline.colour': 'Its colour, far from the fill.',
  'styles.<name>.plate': 'A filled shape behind each line.',
  'styles.<name>.plate.colour': 'Its colour.',
  'styles.<name>.plate.radius': 'How round its corners are, in em, 0 … 1.',
  'styles.<name>.plate.padX': 'Room left and right of the line, in em, 0 … 1.',
  'styles.<name>.plate.padY': 'Room above and below the line, in em, 0 … 1.',

  // ── shots ──
  'shots[].id': 'Its name. Unique among shots, texts, cards and sounds.',
  'shots[].at': 'Its first frame: 0 for the first shot, otherwise "at" + "for" of the shot before.',
  'shots[].for': `How many frames it owns, at most ${LIMITS.shotSeconds * FPS}.`,
  'shots[].media': 'The key of the video or image it shows. A picture that is larger than the canvas is cropped around "focus".',
  'shots[].from': 'The frame of the clip it starts on. The clip needs "from" + "for" frames, and more when the next shot comes in over it.',
  'shots[].focus': 'The point of the picture a crop keeps and a motion zooms on, as [x, y] in percent of the picture.',
  'shots[].motion': 'A zoom on this shot.',
  'shots[].in': 'How this shot replaces the one before. Not allowed on the first shot.',
  'shots[].sound': 'Plays the clip\'s own sound. Left out, the clip is silent.',
  'shots[].sound.gain': `Its volume, ${gain}.`,
  'shots[].windows': 'Periods in which this shot shrinks into a small window in a corner while another picture fills the frame: a talker over a before / after picture. In ascending order, all in the same place.',
  'shots[].windows[].at': 'The frame on which the shot starts to shrink. A frame of the whole video, inside the shot.',
  'shots[].windows[].for': 'How long the window lasts, the shrink and the return included: at least 2 × "frames" + 1.',
  'shots[].windows[].corner': 'The corner of the safe area the window rests in.',
  'shots[].windows[].width': 'The width of the window in percent of the canvas; its height follows the canvas. At most 50 under the default safe area (both, reels), 60 under tiktok and none: a window is as high as it is wide and must fit the height of the safe area; a wider one is refused with window-range.',
  'shots[].windows[].radius': 'How round its corners are, in percent of the canvas width.',
  'shots[].windows[].frames': 'How many frames the shrink takes, and the return.',
  'shots[].windows[].behind': 'The key of the picture (image or video) that fills the frame meanwhile.',
  'shots[].windows[].swaps': 'Changes of the picture behind, by a cut, while the window rests: a before, then an after. In ascending order.',
  'shots[].windows[].swaps[].at': 'The frame of the change: after the shrink, before the return.',
  'shots[].windows[].swaps[].behind': 'The key of the picture shown from that frame.',
  'shots[].windows[].behindMotion': 'A slow zoom on the picture behind ("push-in" or "pull-out").',

  // ── texts ──
  'texts[].id': 'Its name. Unique among shots, texts, cards and sounds.',
  'texts[].at': 'The first frame it is on screen (its enter starts here).',
  'texts[].for': 'How many frames it is on screen, enter and exit included. It needs at least one frame between them.',
  'texts[].box': 'Where it may stand. The copy is laid out inside, and shrunk until it fits.',
  'texts[].style': 'A preset (hook, label, tag, caption) or a key of "styles".',
  'texts[].copy': 'The words. "\\n" forces a line break. Latin letters only.',
  'texts[].lines': 'The most lines it may take.',
  'texts[].shrink': 'The smallest size it may be shrunk to, as a share of the style\'s size. A copy that still does not fit is the error text-too-long.',
  'texts[].valign': 'Where the lines sit in the box, top to bottom.',
  'texts[].enter': 'How it appears.',
  'texts[].exit': 'How it leaves.',
  'texts[].stagger': 'Frames between the enter of one line and the next.',
  'texts[].safe': 'false: it may leave the safe area.',

  // ── captions ──
  'captions.box': 'Where the groups stand. One line of the style must fit its height, and the longest word its width.',
  'captions.style': 'The style of the words.',
  'captions.words': 'The words as they are spoken, in order, none overlapping the next.',
  'captions.words[].text': 'One word, without spaces. Its punctuation stays on it; ".", "!" or "?" at its end closes the group.',
  'captions.words[].at': 'The frame on which the word is first spoken.',
  'captions.words[].for': 'How many frames it is spoken.',
  'captions.group': 'How the words are gathered into the groups shown together.',
  'captions.group.words': 'The most words in a group.',
  'captions.group.lines': 'The most lines of a group.',
  'captions.group.hold': 'A group stays this many frames after its last word, unless the next group begins sooner.',
  'captions.group.pause': 'A gap of this many frames between two words starts a new group.',
  'captions.active': 'How the word being spoken is marked.',
  'captions.active{none}': 'The word being spoken is not marked.',
  'captions.active{colour}': 'The word takes a colour and grows a little.',
  'captions.active{colour}.colour': 'The colour of the word while it is spoken.',
  'captions.active{colour}.scale': 'How large the word is while it is spoken.',
  'captions.active{pill}': 'A filled shape behind the word.',
  'captions.active{pill}.colour': 'The colour of the shape.',
  'captions.active{pill}.text': 'The colour of the word on the shape. Left out, the word keeps the fill of its style.',
  'captions.enter': 'How each group appears.',
  'captions.safe': 'false: the captions may leave the safe area.',

  // ── cards ──
  'cards[].id': 'Its name. Unique among shots, texts, cards and sounds.',
  'cards[].at': 'The first frame it is on screen.',
  'cards[].for': 'How many frames it is on screen, enter and exit included.',
  'cards[].media': 'The key of the image it shows.',
  'cards[].box': 'Where it stands.',
  'cards[].fit': '"contain": the whole picture, as large as the box allows, centred (a product photo is never cropped). "cover": the box is filled and the picture cropped.',
  'cards[].radius': 'How round its corners are, in percent of the canvas width.',
  'cards[].enter': 'How it appears.',
  'cards[].exit': 'How it leaves.',
  'cards[].motion': 'A slow zoom on the picture ("push-in" or "pull-out").',
  'cards[].safe': 'false: it may leave the safe area (a picture over the whole frame has the box 0, 0, 100, 100).',

  // ── audio ──
  'audio.music': 'One music file under the whole video.',
  'audio.music.media': 'The key of the audio file. It must be at least as long as the video, unless "loop" is true.',
  'audio.music.gain': `Its volume, ${gain}. About 0.5 under a voice.`,
  'audio.music.from': 'The frame of the file the music starts on.',
  'audio.music.loop': `true: the file is repeated until the video ends (it needs at least ${LIMITS.loopFrames} frames).`,
  'audio.music.fadeIn': 'Frames over which the music comes up at the start.',
  'audio.music.fadeOut': 'Frames over which the music goes down at the end.',
  'audio.music.duck': 'Lowers the music while something else should be heard.',
  'audio.music.duck.to': 'The volume of the music while it is ducked: from 0 to its own gain.',
  'audio.music.duck.ramp': 'Frames the music takes to go down and to come back.',
  'audio.music.duck.under': '"sound": while a shot plays its own sound. "captions": while caption words are spoken. Or the periods themselves.',
  'audio.music.duck.under[].at': 'The first frame of a period.',
  'audio.music.duck.under[].for': 'How many frames it lasts.',
  'audio.sounds': 'Sound effects, each played once.',
  'audio.sounds[].id': 'Its name. Unique among shots, texts, cards and sounds.',
  'audio.sounds[].media': 'The key of the audio file.',
  'audio.sounds[].at': 'The frame on which it starts.',
  'audio.sounds[].for': 'How many frames of it are played.',
  'audio.sounds[].from': 'The frame of the file it starts on.',
  'audio.sounds[].gain': `Its volume, ${gain}.`,
  'audio.master': 'After the render one pass brings the whole mix to this loudness, by gain only. false leaves the mix as rendered.',
  'audio.master.lufs': 'The loudness of the mix in LUFS, −40 … −5. −14 is what the platforms play at.',
  'audio.master.peak': 'The highest peak the pass may reach, in dBTP, −20 … 0.',

  // ── Box ──
  'Box.left': 'The left edge, in percent of the canvas width.',
  'Box.top': 'The top edge, in percent of the canvas height.',
  'Box.right': 'The right edge, in percent of the canvas width. An edge, not a width.',
  'Box.bottom': 'The bottom edge, in percent of the canvas height. An edge, not a height.',

  // ── Motion ──
  'Motion{push-in}': 'Grows slowly from 1 to "to" over the whole time on screen.',
  'Motion{push-in}.to': `The scale it ends at, ${scale}.`,
  'Motion{push-in}.ease': 'The curve of the move (see Easings).',
  'Motion{pull-out}': 'Shrinks slowly from "from" to 1 over the whole time on screen.',
  'Motion{pull-out}.from': `The scale it starts at, ${scale}.`,
  'Motion{pull-out}.ease': 'The curve of the move (see Easings).',
  'Motion{punch-in}': 'Jumps from 1 to "to" on a frame and stays there: an accent on a word or a beat. Shots only.',
  'Motion{punch-in}.at': 'The frame of the jump: a frame of the whole video, inside the shot.',
  'Motion{punch-in}.to': `The scale it jumps to, ${scale}.`,
  'Motion{punch-in}.frames': 'How many frames the jump takes.',

  // ── Transition ──
  'Transition{cut}': 'The next picture on the next frame. What a shot without "in" has.',
  'Transition{crossfade}': 'The incoming shot fades in over the outgoing one.',
  'Transition{crossfade}.frames': 'How many frames it takes; the outgoing clip needs that many more.',
  'Transition{push}': 'The incoming shot pushes the outgoing one off the canvas.',
  'Transition{push}.to': 'The side the pictures travel to.',
  'Transition{push}.frames': 'How many frames it takes; the outgoing clip needs that many more.',
  'Transition{whip}': 'A push with motion blur: fast and loud.',
  'Transition{whip}.to': 'The side the pictures travel to.',
  'Transition{whip}.frames': 'How many frames it takes; the outgoing clip needs that many more.',
  'Transition{zoom}': 'The outgoing shot zooms in, the incoming one settles from a zoom. Half before the cut, half after; no extra frames of the clip.',
  'Transition{zoom}.frames': 'How many frames it takes, around the cut.',
  'Transition{zoom}.scale': `How far it zooms, ${scale}.`,
  'Transition{flash}': 'A flash of colour over the cut.',
  'Transition{flash}.frames': 'How many frames it takes, around the cut.',
  'Transition{flash}.colour': 'The colour of the flash.',
  'Transition{dip}': 'Down to a colour and back up: a pause between two parts.',
  'Transition{dip}.frames': 'How many frames it takes, around the cut.',
  'Transition{dip}.colour': 'The colour it dips to.',

  // ── Enter ──
  'Enter{none}': 'It is there on its first frame.',
  'Enter{fade}': 'It fades in.',
  'Enter{fade}.frames': 'How many frames it takes.',
  'Enter{pop}': 'It grows from small with a little overshoot.',
  'Enter{pop}.frames': 'How many frames it takes.',
  'Enter{pop}.from': 'The scale it starts at.',
  'Enter{slide}': 'It slides in while it fades in.',
  'Enter{slide}.from': 'The side it comes from.',
  'Enter{slide}.frames': 'How many frames it takes.',
  'Enter{slide}.distance': 'How far it travels, in percent of the canvas height.',
  'Enter{blur}': 'It comes into focus while it fades in.',
  'Enter{blur}.frames': 'How many frames it takes.',
  'Enter{blur}.radius': 'How blurred it starts, in percent of the canvas width.',

  // ── Exit ──
  'Exit{none}': 'It is gone on the frame after its last one.',
  'Exit{fade}': 'It fades out.',
  'Exit{fade}.frames': 'How many frames it takes.',
  'Exit{pop}': 'It shrinks while it fades out.',
  'Exit{pop}.frames': 'How many frames it takes.',
  'Exit{pop}.to': 'The scale it ends at.',
  'Exit{slide}': 'It slides away while it fades out.',
  'Exit{slide}.to': 'The side it leaves to.',
  'Exit{slide}.frames': 'How many frames it takes.',
  'Exit{slide}.distance': 'How far it travels, in percent of the canvas height.',
  'Exit{blur}': 'It goes out of focus while it fades out.',
  'Exit{blur}.frames': 'How many frames it takes.',
  'Exit{blur}.radius': 'How blurred it ends, in percent of the canvas width.',
};

const text = (value: unknown): string => JSON.stringify(value).replaceAll('":', '": ').replaceAll(',"', ', "').replaceAll('{', '{ ').replaceAll('}', ' }');
const captions = captionDefaults({} as Captions);
const card = cardMotion({} as Card);
const frames = (kind: 'fade' | 'pop' | 'slide' | 'blur'): string => String(motionFrames({ kind } as Parameters<typeof motionFrames>[0]));
const effect = (kind: 'crossfade' | 'push' | 'whip' | 'zoom' | 'flash' | 'dip'): string => String(transitionFrames({ kind } as Parameters<typeof transitionFrames>[0]));

/** What an optional field is when it is left out, as the reference shows it. A field that is not here has no stand-in ("none"). */
export const DEFAULTS: Record<string, string> = {
  // literals of compose/ (it reads `?? value` where it uses the field)
  background: '"#000000"', safe: '"both"',
  'shots[].from': '0', 'shots[].focus': '[50, 50]', 'shots[].in': '{ "kind": "cut" }',
  'texts[].lines': 'the lines of the copy when it has "\\n", else 2', 'texts[].shrink': '0.6', 'texts[].valign': '"middle"',
  'texts[].enter': 'the style\'s (see Text styles); "fade" 6 for a style of your own', 'texts[].exit': 'the style\'s; "fade" 6 for a style of your own', 'texts[].stagger': 'the style\'s (2 for hook, else 0)',
  'cards[].fit': '"contain"',
  'audio.music.from': '0', 'audio.music.loop': 'false', 'audio.sounds[].from': '0', 'audio.sounds[].for': 'to the end of the file',
  'styles.<name>.upper': 'false', 'styles.<name>.tracking': '0',
  'Motion{push-in}.ease': '"linear"', 'Motion{pull-out}.ease': '"linear"',
  // edit/presets.ts
  'styles.<name>.leading': String(DEFAULT_LEADING),
  'shots[].windows[].width': String(WINDOW.width), 'shots[].windows[].radius': String(WINDOW.radius), 'shots[].windows[].frames': String(WINDOW.frames),
  'captions.style': text(captions.style), 'captions.group.words': String(captions.words), 'captions.group.lines': String(captions.lines),
  'captions.group.hold': String(captions.hold), 'captions.group.pause': String(captions.pause),
  'captions.active': text(captions.active), 'captions.active{colour}.scale': String(ACTIVE_SCALE), 'captions.enter': text(captions.enter),
  'cards[].radius': String(CARD_RADIUS), 'cards[].enter': text(card.enter), 'cards[].exit': text(card.exit),
  'audio.music.fadeIn': String(MUSIC.fadeIn), 'audio.music.fadeOut': String(MUSIC.fadeOut), 'audio.music.duck.ramp': String(MUSIC.ramp),
  'audio.master': text(MASTER), 'audio.master.peak': String(MASTER.peak),
  'Motion{push-in}.to': String(MOTION.pushTo), 'Motion{pull-out}.from': String(MOTION.pullFrom), 'Motion{punch-in}.to': String(MOTION.punchTo), 'Motion{punch-in}.frames': String(MOTION.punchFrames),
  'Transition{crossfade}.frames': effect('crossfade'), 'Transition{push}.frames': effect('push'), 'Transition{whip}.frames': effect('whip'),
  'Transition{zoom}.frames': effect('zoom'), 'Transition{zoom}.scale': String(TRANSITION.zoomScale),
  'Transition{flash}.frames': effect('flash'), 'Transition{flash}.colour': text(TRANSITION.flashColour),
  'Transition{dip}.frames': effect('dip'), 'Transition{dip}.colour': text(TRANSITION.dipColour),
  'Enter{fade}.frames': frames('fade'), 'Enter{pop}.frames': frames('pop'), 'Enter{pop}.from': String(ENTER.popFrom),
  'Enter{slide}.frames': frames('slide'), 'Enter{slide}.distance': String(ENTER.slideDistance), 'Enter{blur}.frames': frames('blur'), 'Enter{blur}.radius': String(ENTER.blurRadius),
  'Exit{fade}.frames': frames('fade'), 'Exit{pop}.frames': frames('pop'), 'Exit{pop}.to': String(ENTER.popTo),
  'Exit{slide}.frames': frames('slide'), 'Exit{slide}.distance': String(ENTER.slideDistance), 'Exit{blur}.frames': frames('blur'), 'Exit{blur}.radius': String(ENTER.blurRadius),
};
