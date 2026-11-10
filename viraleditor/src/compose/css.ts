// The stylesheet of a composition (design §5.1, §5.2, §5.4): fonts, the fixed layout rules, the motion stylesheet,
// and one class per (style, final size).
import { lineHeightOf } from '../edit/presets.ts';
import type { TextStyle } from '../edit/types.ts';

/**
 * The motion stylesheet, verbatim from the spike (design §5.2). Nothing animates opacity / translate / scale / filter /
 * transform directly: keyframes drive registered custom properties and the element's static style reads them (R3).
 */
export const MOTION_CSS = `
      @property --ve-o { syntax: "<number>"; inherits: false; initial-value: 1; }
      @property --ve-x { syntax: "<length-percentage>"; inherits: false; initial-value: 0px; }
      @property --ve-y { syntax: "<length-percentage>"; inherits: false; initial-value: 0px; }
      @property --ve-s { syntax: "<number>"; inherits: false; initial-value: 1; }
      @property --ve-b { syntax: "<length>"; inherits: false; initial-value: 0px; }
      @property --ve-wx { syntax: "<length>"; inherits: false; initial-value: 0px; }
      @property --ve-wy { syntax: "<length>"; inherits: false; initial-value: 0px; }
      @property --ve-ws { syntax: "<number>"; inherits: false; initial-value: 1; }
      @property --ve-wr { syntax: "<length>"; inherits: false; initial-value: 0px; }
      .ve-m { opacity: var(--ve-o); translate: var(--ve-x) var(--ve-y); scale: var(--ve-s); }
      .ve-mb { filter: blur(var(--ve-b)); }
      .ve-win { transform-origin: 0 0; transform: translate(var(--ve-wx), var(--ve-wy)) scale(var(--ve-ws)); border-radius: var(--ve-wr); }
      @keyframes ve-fade-in { from { --ve-o: 0; } to { --ve-o: 1; } }
      @keyframes ve-fade-out { from { --ve-o: 1; } to { --ve-o: 0; } }
      @keyframes ve-move-in { from { --ve-x: var(--ve-in-x); --ve-y: var(--ve-in-y); } to { --ve-x: 0px; --ve-y: 0px; } }
      @keyframes ve-move-out { from { --ve-x: 0px; --ve-y: 0px; } to { --ve-x: var(--ve-out-x); --ve-y: var(--ve-out-y); } }
      @keyframes ve-scale-in { from { --ve-s: var(--ve-in-s); } to { --ve-s: 1; } }
      @keyframes ve-scale-out { from { --ve-s: 1; } to { --ve-s: var(--ve-out-s); } }
      @keyframes ve-blur-in { from { --ve-b: var(--ve-in-b); } to { --ve-b: 0px; } }
      @keyframes ve-blur-out { from { --ve-b: 0px; } to { --ve-b: var(--ve-out-b); } }
      @keyframes ve-scale { from { --ve-s: var(--ve-s0); } to { --ve-s: var(--ve-s1); } }
      @keyframes ve-flash { 0% { --ve-o: 0; } 50% { --ve-o: 1; } 100% { --ve-o: 0; } }
      @keyframes ve-window-in { from { --ve-wx: 0px; --ve-wy: 0px; --ve-ws: 1; --ve-wr: 0px; } to { --ve-wx: var(--ve-win-x); --ve-wy: var(--ve-win-y); --ve-ws: var(--ve-win-s); --ve-wr: var(--ve-win-r); } }
      @keyframes ve-window-out { from { --ve-wx: var(--ve-win-x); --ve-wy: var(--ve-win-y); --ve-ws: var(--ve-win-s); --ve-wr: var(--ve-win-r); } to { --ve-wx: 0px; --ve-wy: 0px; --ve-ws: 1; --ve-wr: 0px; } }
      @keyframes ve-word-colour { from, to { color: var(--ve-active); } }
      @keyframes ve-word-pill { from, to { background-color: var(--ve-pill); } }
      @keyframes ve-word-pop { 0% { --ve-s: 1; } 25% { --ve-s: var(--ve-pop-s); } 100% { --ve-s: var(--ve-hold-s); } }`;

const FONT_RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
} as const;
export type Font = TextStyle['font'];
/** The two files of a font inside the composition folder (R9: `latin` alone lets İ ş ğ fall back silently). */
export function fontFiles(font: Font): string[] {
  return Object.keys(FONT_RANGES).map((subset) => `assets/fonts/${font.toLowerCase()}-${subset}-wght-normal.woff2`);
}
function fontFaces(font: Font): string[] {
  return Object.values(FONT_RANGES).map((range, i) =>
    `@font-face { font-family: "${font}"; src: url("${fontFiles(font)[i]}") format("woff2"); font-weight: 100 900; font-style: normal; font-display: block; unicode-range: ${range}; }`);
}

/** Outline as a ring of hard shadows: n copies on a circle of radius r px, n = clamp(⌈2πr / 1.5⌉, 8, 32) (R7). */
export function ring(r: number, colour: string): string[] {
  const n = Math.min(32, Math.max(8, Math.ceil((2 * Math.PI * r) / 1.5)));
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n;
    return `${(r * Math.cos(angle)).toFixed(2)}px ${(r * Math.sin(angle)).toFixed(2)}px 0 ${colour}`;
  });
}

export interface StyleClass { name: string; style: TextStyle; size: number; lineHeight: number; vars: string[] }

/** `st-hook-65`: the class of a style at the size the fit chose. `key` is a preset name or an id-checked key of Edit.styles. */
export function styleClass(key: string, style: TextStyle, size: number): StyleClass {
  return { name: `st-${key}-${size}`, style, size, lineHeight: lineHeightOf(style, size), vars: [] };
}

function classRules(cls: StyleClass): string[] {
  const { style, size } = cls;
  const shadows = [...(style.outline ? ring(style.outline.width * size, style.outline.colour) : []), ...style.shadows];
  const declarations = [
    `font-family: "${style.font}", sans-serif`, `font-weight: ${style.weight}`, `font-size: ${size}px`, `line-height: ${cls.lineHeight}px`, `color: ${style.fill}`,
    ...(style.tracking ? [`letter-spacing: ${style.tracking}em`] : []),
    ...(shadows.length ? [`text-shadow: ${shadows.join(', ')}`] : []),
    ...cls.vars,
  ];
  const plate = style.plate;
  return [
    `.${cls.name} { ${declarations.join('; ')}; }`,
    ...(plate ? [`.${cls.name} .ve-plate { background: ${plate.colour}; border-radius: ${Math.round(plate.radius * size)}px; padding: ${Math.ceil(plate.padY * size)}px ${Math.ceil(plate.padX * size)}px; }`] : []),
  ];
}

/** The whole text of the <style> element. */
export function stylesheet(canvas: { width: number; height: number }, background: string, classes: StyleClass[]): string {
  const { width: W, height: H } = canvas;
  const fonts = [...new Set(classes.map((cls) => cls.style.font))].sort();
  const rules = [
    ...fonts.flatMap(fontFaces),
    // Every animation stands still at 0 until the runtime seeks it (FINDING 1, C1c). A running one advances on the wall
    // clock while the page loads; a short one with fill none or backwards that ends before HyperFrames 0.8.120 first lists
    // the page's animations is never sought (document.getAnimations() leaves it out), and the inline-delay fallback then
    // holds it at the time it reached: a one-frame caption word stays unlit, an enter stays at rest.
    '#root, #root * { animation-play-state: paused !important; }',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    `html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${background}; }`,
    `#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${background}; }`,
    `.ve-layer { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }`,
    `.ve-shot { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; }`,
    '.ve-shot > video, .ve-shot > img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }',
    `.ve-fx { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }`,
    '.ve-line { position: absolute; display: flex; align-items: center; white-space: nowrap; }',
    '.ve-al-left { justify-content: flex-start; }',
    '.ve-al-center { justify-content: center; }',
    '.ve-al-right { justify-content: flex-end; }',
    '.ve-plate { display: block; }',
    '.ve-card { position: absolute; object-fit: cover; }',
    '.ve-card-box { position: absolute; overflow: hidden; }',
    '.ve-card-box > img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }',
    '.ve-cap { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; }',
    '.ve-cl-left { align-items: flex-start; }',
    '.ve-cl-right { align-items: flex-end; }',
    '.ve-cap-line { display: block; white-space: nowrap; }',
    '.ve-w { display: inline-block; padding: 0 0.14em; border-radius: 0.25em; }',
  ];
  const classRulesText = [...classes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).flatMap(classRules);
  return `${rules.map((rule) => `      ${rule}`).join('\n')}${MOTION_CSS}\n${classRulesText.map((rule) => `      ${rule}`).join('\n')}`;
}
