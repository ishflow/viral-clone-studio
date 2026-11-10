import { describe, expect, it } from 'vitest';
import { PER_TRACK, createTracks, shotTrack, tracksAfterShots } from './tracks.ts';

describe('track indexes', () => {
  it('alternates neighbouring shots between two indexes, three shots on each, then takes the next two', () => {
    expect(Array.from({ length: 14 }, (_, i) => shotTrack(i))).toEqual([0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 4, 5]);
    expect([1, 6, 7, 12, 13].map(tracksAfterShots)).toEqual([2, 2, 4, 4, 6]);
  });

  it('gives the lowest index that is free during the frames asked for', () => {
    const tracks = createTracks(4);
    expect(tracks.take(0, 30)).toBe(4);
    expect(tracks.take(10, 30)).toBe(5);          // overlaps the first
    expect(tracks.take(30, 10)).toBe(4);          // starts where the first ends
    expect(tracks.take(40, 10)).toBe(4);
    expect(tracks.take(50, 10)).toBe(5);          // index 4 is full
  });

  it('keeps sound elements apart: two that follow each other without a gap get two indexes', () => {
    const tracks = createTracks(9);
    expect([tracks.take(0, 96, true), tracks.take(96, 96, true), tracks.take(192, 96, true), tracks.take(288, 72, true)]).toEqual([9, 10, 9, 10]);
    expect(tracks.take(400, 10, true)).toBe(9);
  });

  it('never puts more than three elements on one index', () => {
    const tracks = createTracks(0);
    const taken = Array.from({ length: 20 }, (_, i) => tracks.take(i * 10, 10));
    for (const index of new Set(taken)) expect(taken.filter((t) => t === index).length).toBeLessThanOrEqual(PER_TRACK);
    expect(Math.max(...taken)).toBe(6);
  });
});
