/** One thing wrong with a media file going into a montage, or with a rendered video. */
export interface QualityIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;                  // what is wrong, with the numbers
  fix: string;                      // what to do, written for an AI agent that has only this message
  at: number | null;                // a frame of the video, when the problem sits at one
  target: string | null;            // a media key, an element id or a file
}
