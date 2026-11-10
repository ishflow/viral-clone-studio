import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RenderError } from '../ports.ts';
import { DELIVERY_BPP, HARDWARE_ENCODER, cliEncodeArgs, containerFacts, finalPassArgs, gainFilter, hardwareEncoderFault, megabits } from './encode.ts';

const TALL = { width: 1080, height: 1920, fps: 30 };
const SMALL = { width: 720, height: 1280, fps: 30 };

/** A stub tool that logs its arguments beside itself, prints `stdout` and `stderr`, and exits with `exit`. */
function tool(exit: number, output: { stdout?: string; stderr?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 've-encode-'));
  const bin = join(dir, 'tool');
  writeFileSync(join(dir, 'stdout'), output.stdout ?? '');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${bin}.args"\ncat "${join(dir, 'stdout')}"\n${output.stderr === undefined ? '' : `echo '${output.stderr}' >&2\n`}exit ${exit}\n`);
  chmodSync(bin, 0o755);
  return bin;
}
const argsOf = (bin: string): string[] => readFileSync(`${bin}.args`, 'utf8').trim().split('\n');

describe('bitrate of the delivered picture', () => {
  it('is whole megabits from the picture size and rate, never under 1', () => {
    expect(megabits(TALL, 1)).toBe(62);
    expect(megabits(SMALL, 1)).toBe(28);
    expect(megabits({ width: 16, height: 16, fps: 1 }, 1)).toBe(1);
  });
  it('is 18 Mbit/s at 1080×1920×30 and 8 at 720×1280×30', () => {
    expect(megabits(TALL, DELIVERY_BPP)).toBe(18);
    expect(megabits(SMALL, DELIVERY_BPP)).toBe(8);
  });
});

describe('cliEncodeArgs', () => {
  it('adds nothing on the cli path', () => {
    expect(cliEncodeArgs('cli', TALL)).toEqual([]);
  });
  it('asks the CLI for its hardware encoder at the delivery bitrate', () => {
    expect(cliEncodeArgs('hardware', TALL)).toEqual(['--gpu', '--video-bitrate', '18M']);
    expect(cliEncodeArgs('hardware', SMALL)).toEqual(['--gpu', '--video-bitrate', '8M']);
  });
});

describe('finalPassArgs', () => {
  const args = (gain: number | null) => finalPassArgs({ from: '/w/in.mp4', to: '/w/out.mp4', gain });
  const after = (list: string[], flag: string) => list[list.indexOf(flag) + 1];
  it('one input, the first picture stream, the sound only when there is one, the output last', () => {
    const a = args(3);
    expect(a.slice(0, 10)).toEqual(['-y', '-v', 'error', '-nostdin', '-i', '/w/in.mp4', '-map', '0:v:0', '-map', '0:a:0?']);
    expect(a.at(-1)).toBe('/w/out.mp4');
    expect(a.filter((x) => x === '-i')).toHaveLength(1);
  });
  it('copies the picture and completes its colour tags: BT.709 primaries, transfer and matrix', () => {
    const a = args(null);
    expect(after(a, '-c:v')).toBe('copy');
    expect(after(a, '-bsf:v')).toBe('h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1');
  });
  it('applies the gain in the same pass: volume only, AAC at 48 kHz', () => {
    const a = args(-4.25);
    expect(after(a, '-af')).toBe('volume=-4.25dB');
    expect(a.slice(a.indexOf('-c:a'), a.indexOf('-c:a') + 6)).toEqual(['-c:a', 'aac', '-ar', '48000', '-b:a', '192k']);
    expect(after(args(1.23456), '-af')).toBe('volume=1.235dB');
  });
  it('a limit adds the peak limiter after the volume, at that ceiling, without a level change of its own', () => {
    const a = finalPassArgs({ from: '/w/in.mp4', to: '/w/out.mp4', gain: 10, limit: -2.5 });
    expect(after(a, '-af')).toBe('volume=10dB,aresample=192000,alimiter=limit=0.7499:level=0,aresample=48000');
    expect(gainFilter({ gain: 3, limit: null })).toBe('volume=3dB');
  });
  it('copies the sound when there is no gain', () => {
    const a = args(null);
    expect(after(a, '-c:a')).toBe('copy');
    expect(a).not.toContain('-af');
  });
});

describe('hardwareEncoderFault', () => {
  it('is null when a one-frame encode with the hardware encoder works; the software stand-in is not allowed', async () => {
    const bin = tool(0);
    expect(await hardwareEncoderFault(bin, 10_000)).toBeNull();
    const tried = argsOf(bin);
    expect(tried.slice(tried.indexOf('-c:v'), tried.indexOf('-c:v') + 2)).toEqual(['-c:v', HARDWARE_ENCODER]);
    expect(tried).not.toContain('-allow_sw');
  });
  it('says why when the encoder fails, with the last line ffmpeg printed', async () => {
    const fault = await hardwareEncoderFault(tool(234, { stderr: 'Error while opening encoder' }), 10_000);
    expect(fault).toMatch(/h264_videotoolbox does not work/);
    expect(fault).toMatch(/exit 234/);
    expect(fault).toMatch(/Error while opening encoder/);
  });
  it('says so when ffmpeg cannot start', async () => {
    expect(await hardwareEncoderFault('/no/such/ffmpeg', 10_000)).toMatch(/could not be tried/);
  });
});

describe('containerFacts', () => {
  const REAL = '{"programs":[],"stream_groups":[],"streams":[{"codec_type":"video","width":1080,"height":1920,"r_frame_rate":"30/1","nb_frames":"900","side_data_list":[{}]},{"codec_type":"audio","r_frame_rate":"0/0","nb_frames":"1408"}],"format":{"duration":"30.016000"}}';
  it('reads what ffprobe prints for a rendered file, without asking it to decode', async () => {
    const bin = tool(0, { stdout: REAL });
    expect(await containerFacts(bin, '/w/out.mp4', 10_000)).toEqual({ width: 1080, height: 1920, fps: 30, frames: 900, seconds: 30.016, audio: true });
    expect(argsOf(bin)).not.toContain('-count_frames');
    expect(argsOf(bin).at(-1)).toBe('/w/out.mp4');
  });
  it('a file without sound, and a rational rate', async () => {
    const bin = tool(0, { stdout: '{"streams":[{"codec_type":"video","width":720,"height":1280,"r_frame_rate":"30000/1001","nb_frames":"60"}],"format":{"duration":"2.002"}}' });
    const facts = await containerFacts(bin, '/w/out.mp4', 10_000);
    expect(facts).toMatchObject({ width: 720, height: 1280, frames: 60, seconds: 2.002, audio: false });
    expect(facts.fps).toBeCloseTo(29.97, 2);
  });
  it('is a RenderError when ffprobe fails, prints no JSON, finds no picture or cannot start', async () => {
    await expect(containerFacts(tool(1, { stderr: 'moov atom not found' }), '/w/x.mp4', 10_000)).rejects.toThrow(/moov atom not found/);
    await expect(containerFacts(tool(0, { stdout: 'not json' }), '/w/x.mp4', 10_000)).rejects.toBeInstanceOf(RenderError);
    await expect(containerFacts(tool(0, { stdout: '{"streams":[{"codec_type":"audio"}],"format":{}}' }), '/w/x.mp4', 10_000)).rejects.toBeInstanceOf(RenderError);
    await expect(containerFacts('/no/such/ffprobe', '/w/x.mp4', 10_000)).rejects.toBeInstanceOf(RenderError);
  });
});
