// timeline.json: everything a test needs to check a render by frame, without reading the HTML (design §7).
// Frozen contract: compose writes it, the renderer, the quality checks and the tests read it.
import type { Ease, Frame, Frames } from './types.ts';

export interface Rect { x: number; y: number; width: number; height: number }       // integer pixels
export interface Rest { at: Frame; for: Frames }                                    // frames on which the element stands still at full opacity

export interface Timeline {
  fps: number; frames: number; width: number; height: number;
  shots: { id: string; element: string; media: string; kind: 'video' | 'image'; at: Frame; for: Frames; tail: Frames; from: Frame }[];
  //   on screen on frames at … at+for+tail−1; output frame f shows source frame  from + (f − at)
  transitions: { kind: string; from: string; to: string; cut: Frame; at: Frame; for: Frames; overlap: boolean; colour: string | null }[];   // colour: of a flash or a dip ('#rrggbb'), else null
  //   cut = the incoming shot's at; at / for = the frames on which the effect is visible
  windows: { shot: string; behind: string; at: Frame; for: Frames; frames: Frames; rect: Rect; radius: number;
             pictures: { behind: string; element: string; at: Frame; for: Frames }[] }[];   // pictures: what fills the frame behind the window, in order (more than one when the window has swaps)
  texts: { id: string; line: number; element: string; copy: string; at: Frame; for: Frames; rect: Rect; size: number; colour: string; rest: Rest }[];   // colour: the fill, '#rrggbb'
  //   captions[].rect is the box the group is centred in, not the drawn element: the drawn lines (lines.length x line height) are smaller and centred inside it
  captions: { group: number; element: string; at: Frame; for: Frames; rect: Rect; size: number; colour: string; lines: string[];
              words: { index: number; text: string; at: Frame; for: Frames }[]; rest: Rest }[];   // word.at / for = the frames on which it is the active word
  //   cards[]: for a card with a `motion`, `element` is the image (the zoom rows) and the enter / exit rows sit on `<element>-box`, the wrapper around it
  cards: { id: string; element: string; media: string; at: Frame; for: Frames; rect: Rect; rest: Rest }[];
  audio: { element: string; media: string; at: Frame; for: Frames; from: Frame; gain: [Frame, number][] }[];   // points on the timeline, linear in between
  // several rows may name one element and property (a window's in and out, the two rows of a flash): the value on a frame is that of the last row that has started
  animations: { element: string; property: 'opacity' | 'x' | 'y' | 'scale' | 'blur' | 'window' | 'active';
                at: Frame; for: Frames; from: number; to: number; ease: Ease | 'step'; hold: 'before' | 'after' | 'both' | 'none' }[];
  master: { lufs: number; peak: number } | null;                                     // the loudness pass the renderer applies after the render; null: none
  checkAt: Frame[];                                                                  // one frame inside each element's rest that lies outside every transition's effect frames and every other element's enter and exit (an element without such a frame gives none); the renderer passes frame / fps to check --at
}
