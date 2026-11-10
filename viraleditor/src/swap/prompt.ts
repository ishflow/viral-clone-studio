// The words a person-swap provider that takes a prompt is asked with: replace only the people, and keep everything else. Pure.
import type { Outfit, SwapPerson } from '../ports.ts';

const OUTFIT: Record<Outfit, string> = {
  keep: 'Outfit: keep the clothes of the person in the video.',
  photo: 'Outfit: the person wears the clothes of the photograph.',
};

/** One line per person that has a hint, numbered by the place of the person in `people` (the photograph's number). */
function imageLines(people: readonly SwapPerson[]): string[] {
  return people.flatMap((person, at) => (person.hint.trim() === '' ? [] : [`Image ${at + 1} = ${person.hint.trim()}`]));
}

export function swapPrompt(people: readonly SwapPerson[], options: { outfit?: Outfit } = {}): string {
  const who = people.length === 1 ? 'the person' : `the ${people.length} people`;
  return [
    `Replace ONLY ${who} in the video with ${people.length === 1 ? 'the person' : 'the people'} of the photograph${people.length === 1 ? '' : 's'}, and change nothing else.`,
    ...imageLines(people),
    'Keep the identity of the new person: the face, the hair, the skin tone and the body of the photograph.',
    ...(options.outfit === undefined ? [] : [OUTFIT[options.outfit]]),
    'Keep the background, every object and the lighting outside the person exactly the same.',
    'Keep the motion, the timing, the pose and the lip movement exactly the same.',
    'Keep the camera, its framing and its movement exactly the same.',
    'Avoid: a second copy of the person, a changed background, flicker, a face that changes between frames, extra limbs, text or logos that are not in the video.',
  ].join('\n');
}
