// data-track-index for every timed element. Two elements on one index never overlap in time (lint: duplicate_audio_track),
// and an index carries at most three (HyperFrames 0.8.120 warns timeline_track_too_dense above three elements that are
// neither <video> nor <audio>; the limit is kept for those too, so one rule covers every element).
import type { Frame, Frames } from '../edit/types.ts';

export const PER_TRACK = 3;

/** Design §5.3: neighbouring shots alternate between two indexes; every six shots the next pair of indexes begins. */
export function shotTrack(index: number): number {
  return (index % 2) + 2 * Math.floor(index / (2 * PER_TRACK));
}
/** The first index that no shot uses. */
export function tracksAfterShots(shots: number): number {
  return 2 * Math.max(1, Math.ceil(shots / (2 * PER_TRACK)));
}

export interface Tracks { take(at: Frame, length: Frames, apart?: boolean): number }

/**
 * Hands out indexes from `first` on: the lowest one that is free during the frames asked for and not yet full.
 * `apart` (sound): not even next to another element of that index. Lint adds start and duration as seconds, and
 * 6.4 + 3.2 is a hair more than 9.6: two passes of music back to back on one index were reported as overlapping.
 */
export function createTracks(first: number): Tracks {
  const spans: [Frame, Frame][][] = [];
  return {
    take(at, length, apart = false) {
      const end = at + length;
      const free = ([from, to]: [Frame, Frame]) => (apart ? at > to || end < from : at >= to || end <= from);
      let index = spans.findIndex((track) => track.length < PER_TRACK && track.every(free));
      if (index < 0) index = spans.push([]) - 1;
      spans[index]!.push([at, end]);
      return first + index;
    },
  };
}
