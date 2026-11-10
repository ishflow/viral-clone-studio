/** The store admits 100 MiB of video; the rest of the body is the form's own framing. (Kept out of the route file: Next only allows its own exports there.) */
export const MAX_VIDEO_BODY_BYTES = 100 * 1024 * 1024 + 1024 * 1024;
