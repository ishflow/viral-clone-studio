// The lengths and the counts a template may ask for.

/** A shot may be at most this long, and a video this long: the editor refuses more. */
export const SHOT_SECONDS_MAX = 15;
export const VIDEO_SECONDS_MAX = 60;
/** A customer's video may be this long when the customer picks the part of it to use (`range`): that part is at most VIDEO_SECONDS_MAX, and at least RANGE_SECONDS_MIN. */
export const SOURCE_SECONDS_MAX = 300;
export const RANGE_SECONDS_MIN = 3;
/** A talking clip may come back a little longer than asked, so a segment asks for less than the editor's limits. */
export const SEGMENT_SECONDS_MAX = 14;
export const SPEECH_SECONDS_MAX = 58;
/** A transition between two talking clips takes at most this many frames (the editor allows half of the shorter clip). */
export const SPEECH_TRANSITION_FRAMES_MAX = 30;

/** The first frame of a beats shot is made from at most this many generated stills. */
export const SHOT_STILLS_MAX = 2;
/** The pictures one image request is made from, at most: the provider's limit (adapters/routes.ts refuses more). */
export const MAX_IMAGE_REFERENCES = 14;

/** The seconds a clip is asked for and billed: whole seconds, at least 4. */
export const billedSeconds = (clipSeconds: number): number => Math.max(4, Math.ceil(clipSeconds));
