// A fill that stands in for a customer's, so that a template can be composed before anybody has adapted it.
// Pure. Every placeholder becomes its own name (`{product_1}` → "product 1"): a text keeps the length its pattern shows.
import { clipShots } from '../template/clips.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { imageOf, placeholdersIn } from '../template/values.ts';

const filled = (pattern: string): string =>
  placeholdersIn(pattern).reduce((text, name) => text.replaceAll(`{${name}}`, name.replaceAll('_', ' ')), pattern);

/** The pictures a template shows or builds on: with all of them given, no card and no window is left out of the check. */
function picturesOf(template: TemplateJson): string[] {
  return [
    ...(template.presenter?.references ?? []),
    ...(template.stills ?? []).flatMap((still) => still.references),
    ...(template.cards ?? []).map((card) => card.image),
    ...(template.windows ?? []).map((window) => window.behind),
  ];
}

export function sampleFill(template: TemplateJson): FillJson {
  const photographs = new Map<number, number>();              // product → the highest photograph the template names
  for (const picture of picturesOf(template)) {
    const image = imageOf(picture);
    if (image.kind === 'product') photographs.set(image.product, Math.max(photographs.get(image.product) ?? 1, image.photograph));
  }
  const speech = template.mode === 'speech';
  const fill: FillJson = {
    language: 'en',
    products: Array.from({ length: template.products.max }, (_, p) => ({
      name: `Sample product ${p + 1}`,
      images: Array.from({ length: photographs.get(p + 1) ?? 1 }, (_, i) => `uploads/sample/product-${p + 1}-${i + 1}.png`),
    })),
    texts: Object.fromEntries(template.texts.map((text) => [text.id, filled(text.copy)])),
    shots: Object.fromEntries(clipShots(template).map((shot) => [shot.id, {                // a shot that continues a clip has no prompts
      ...(shot.still_prompt === undefined ? {} : { still_prompt: filled(shot.still_prompt) }),
      motion_prompt: filled(shot.motion_prompt),
    }])),
    music: { prompt: filled(template.audio.music.prompt) },
  };
  const stills = template.stills === undefined ? {} : { stills: Object.fromEntries(template.stills.map((still) => [still.id, { prompt: filled(still.prompt) }])) };
  if (!speech) return { ...fill, ...stills };
  return {
    ...fill,
    script: Object.fromEntries((template.script?.segments ?? []).map((segment) => [segment.id, filled(segment.lines)])),
    ...(template.presenter === undefined ? {} : { presenter: { still_prompt: filled(template.presenter.still_prompt) } }),
    ...stills,
  };
}
