/** The protocols ffmpeg and ffprobe may open for a file we did not make (SEC2 I4): a local file and a pipe, never a network address or a playlist's remote parts. */
export const PROTOCOLS = 'file,pipe';

/**
 * `args` of one ffmpeg or ffprobe call with the whitelist in front of every input. ffmpeg takes it as an input option, so it stands
 * before each `-i`; ffprobe's file is positional, so it stands at the start.
 */
export function onlyLocalInputs(tool: 'ffmpeg' | 'ffprobe', args: string[]): string[] {
  if (tool === 'ffprobe') return ['-protocol_whitelist', PROTOCOLS, ...args];
  return args.flatMap((arg) => (arg === '-i' ? ['-protocol_whitelist', PROTOCOLS, arg] : [arg]));
}
