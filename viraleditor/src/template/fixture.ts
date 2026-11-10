const style = () => ({ font: 'Inter', weight: 700, size: 48, align: 'center', fill: '#fff', shadows: [] as string[] });

/** The smallest beats template: one shot, one text. */
export const beatsTemplate = () => ({
  id: 't1',
  source: { kind: 'seed', url: 'https://example.com/v', metrics: { views: 1000, likes: 50, ctr_band: 'high' } },
  title: 'Serum drop', description: 'One bottle, one line.', category: 'beauty', tags: ['serum'],
  mode: 'beats',
  canvas: { width: 1080, height: 1920, fps: 30 },
  products: { min: 1, max: 1 },
  people: 'none',
  shots: [{ id: 's1', at: 0, for: 90, products: ['1'], still_prompt: 'a bottle', motion_prompt: 'slow push', clip_seconds: 3, action: 'The bottle stands on a shelf' }],
  texts: [{ id: 'x1', at: 0, for: 90, box: { left: 10, top: 20, right: 80, bottom: 40 }, style: 'main', copy: 'Hi {product}', source_copy: 'Hi' }],
  styles: { main: style() },
  audio: { music: { prompt: 'soft beat', gain: 0.5 } },
});

/** The smallest speech template: two segments, a text and a card on marks, one still behind a window, captions. */
export const speechTemplate = () => ({
  id: 't2',
  source: { kind: 'seed', url: '', metrics: { views: 0, likes: 0, ctr_band: '' } },
  title: 'Two weeks later', description: 'A presenter shows a before and an after.', category: 'beauty', tags: ['talking'],
  mode: 'speech',
  canvas: { width: 720, height: 1280, fps: 30 },
  products: { min: 1, max: 2 },
  people: 'face',
  shots: [
    { id: 's1', segment: 'open', products: ['1'], motion_prompt: 'she leans in', clip_seconds: 6, action: 'She promises a result' },
    { id: 's2', segment: 'close', products: ['1'], motion_prompt: 'she nods', clip_seconds: 5, action: 'She names the product' },
  ],
  texts: [{ id: 'x1', mark: 'hook', box: { left: 14, top: 14, right: 86, bottom: 24 }, style: 'main', copy: 'I tried {product}', source_copy: 'I tried Rivalbrand' }],
  styles: { main: style() },
  audio: { music: { prompt: 'soft beat', gain: 0.1 } },
  script: { segments: [
    { id: 'open', lines: '[hook]I tried {product} for two weeks.[/hook] [proof]Look at this.[/proof]', seconds: 6 },
    { id: 'close', lines: 'It is [name]the {product}.[/name]', seconds: 5 },
  ] },
  presenter: { still_prompt: 'a woman holds {product}', references: ['product:1'], voice: { voice_id: 'voice-1', sample_text: 'Hello there.' } },
  stills: [{ id: 'skin', prompt: 'a close picture of skin', references: [] }],
  cards: [{ id: 'c1', mark: 'name', image: 'product:1', box: { left: 60, top: 27, right: 86, bottom: 50 } }],
  windows: [{ mark: 'proof', corner: 'top-right', behind: 'still:skin' }],
  captions: { box: { left: 14, top: 51, right: 86, bottom: 64 } },
});

export const speechFill = () => ({
  language: 'en',
  products: [{ name: 'Glow Serum', images: ['uploads/u1/serum.png'] }],
  texts: { x1: 'I tried Glow Serum' },
  shots: { s1: { motion_prompt: 'she leans in' }, s2: { motion_prompt: 'she nods' } },
  music: { prompt: 'soft beat' },
  script: { open: '[hook]I tried Glow Serum for two weeks.[/hook] [proof]Look at this.[/proof]', close: 'It is [name]the Glow Serum.[/name]' },
  presenter: { still_prompt: 'a woman holds a small glass bottle' },
  stills: { skin: { prompt: 'a close picture of skin' } },
});

export const beatsFill = () => ({
  language: 'en',
  products: [{ name: 'Glow Serum', images: ['uploads/u1/serum.png'] }],
  texts: { x1: 'Hi Glow Serum' },
  shots: { s1: { still_prompt: 'a glass bottle on a shelf', motion_prompt: 'slow push' } },
  music: { prompt: 'soft beat' },
});

/** The beats template with five shots of 30 frames, where s2 and s3 continue the clip of s1: three shots own a clip (s1, s4, s5). */
export const continuingTemplate = () => {
  const owns = (id: string, at: number) => ({ id, at, for: 30, products: ['1'], still_prompt: `the first frame of ${id}`, motion_prompt: `what moves in ${id}`, clip_seconds: 4, action: `Shot ${id}` });
  const part = (id: string, at: number) => ({ id, at, for: 30, products: [] as string[], continues: 's1', action: `Shot ${id}` });
  return { ...beatsTemplate(), shots: [owns('s1', 0), part('s2', 30), part('s3', 60), owns('s4', 90), owns('s5', 120)] };
};

/** Its fill: prompts for the three shots that own a clip, none for s2 and s3. */
export const continuingFill = () => ({
  ...beatsFill(),
  shots: Object.fromEntries(['s1', 's4', 's5'].map((id) => [id, { still_prompt: `a glass bottle, ${id}`, motion_prompt: `slow push, ${id}` }])),
});
