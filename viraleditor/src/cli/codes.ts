// The codes the command line gives by itself (the codes of the document, of the media and of a render come from
// edit/, compose/ and quality/). One table: the issues are built from it, the exit code is read from it, and the
// `codes` command lists it.

export interface CodeInfo {
  exit: 1 | 2 | 3;     // 1: the document or the media · 2: the command was written wrongly · 3: a tool is missing or failed
  meaning: string;
  fix: string;         // what to do, when the place that found it has nothing more exact to say
  severity?: 'warning'; // a warning does not fail its command; absent: an error
}

export const CLI_CODES = {
  // ── the command as it was written ──
  'command-missing': { exit: 2, meaning: 'No command was given.', fix: 'Name a command: `viraleditor --help` lists them.' },
  'unknown-command': { exit: 2, meaning: 'The command does not exist.', fix: 'Use one of the commands `viraleditor --help` lists.' },
  'unknown-flag': { exit: 2, meaning: 'The command has no such flag.', fix: 'Use one of the flags `viraleditor <command> --help` lists.' },
  'flag-value': { exit: 2, meaning: 'A flag has no value, a value of the wrong kind or one outside its range.', fix: 'Give the flag a value of the kind `viraleditor <command> --help` names.' },
  'flag-missing': { exit: 2, meaning: 'A flag the command needs was not given.', fix: 'Add the flag; `viraleditor <command> --help` shows it.' },
  'argument-missing': { exit: 2, meaning: 'An argument the command needs was not given.', fix: 'Add the argument; `viraleditor <command> --help` shows it.' },
  'argument-value': { exit: 2, meaning: 'An argument is not what the command takes: a folder where a file belongs, a file in a folder that is not there.', fix: 'Give the argument as `viraleditor <command> --help` describes it.' },
  'folder-in-use': { exit: 2, meaning: 'The folder given to `init` already holds a project: an edit.json or an assets folder.', fix: 'Give a folder that is empty or not there yet; `init` never overwrites.' },
  'argument-extra': { exit: 2, meaning: 'More arguments were given than the command takes.', fix: 'Remove the extra argument; a path with spaces needs quotes.' },

  // ── the files handed to a command ──
  'file-missing': { exit: 1, meaning: 'A file named on the command line does not exist.', fix: 'Give the path of a file that exists; the message names the one that is not there.' },
  'not-an-edit': { exit: 1, meaning: 'The file given as the edit document is something else: a timeline.json, a template, a media file, an empty file, a folder without edit.json.', fix: 'Pass the edit document (edit.json) or the project folder that holds it.' },
  'json-invalid': { exit: 1, meaning: 'A file is not JSON.', fix: 'Correct the JSON at the place named (a missing or trailing comma, a missing quote or bracket).' },
  'timeline-invalid': { exit: 1, meaning: 'The file is JSON but not a timeline.json of this editor.', fix: 'Pass the timeline.json that `viraleditor check --deep` or `viraleditor render` wrote: <project>/.viraleditor/composition/timeline.json.' },
  'template-invalid': { exit: 1, meaning: 'The file is JSON but not a template (template.json) the editor reads.', fix: 'Correct the fields named; docs/reference/template-format.md describes a template.' },
  'frame-range': { exit: 1, meaning: 'A frame number lies outside the video.', fix: 'Use frame numbers from 0 to frames − 1 of the document.' },
  'media-unreadable': { exit: 1, meaning: 'The file is not a media file that ffprobe can read.', fix: 'Give a video, image or sound file; make a damaged file again.' },
  'media-silent': { exit: 1, meaning: 'The media file has no sound, so there are no spoken words to find.', fix: 'Give the file the voice is on: a video with its own sound, or a sound file.' },
  'script-empty': { exit: 1, meaning: 'The script file has no word in it (only marks, blanks or nothing).', fix: 'Write the spoken words into the file, or leave --script away to take the words the transcriber hears.' },
  'script-invalid': { exit: 1, meaning: 'The script file has a mark that is not written as [name] ... [/name], or a word the captions cannot show.', fix: 'Correct the mark or the word the message names; a mark name is lower-case letters, digits and hyphens.' },
  'layout-overflow': { exit: 1, meaning: 'In the browser a text or a picture leaves its box or the canvas on a frame where it stands still.', fix: 'Shorten the copy, enlarge the box or lower the size of the element named.' },

  'language-unsupported': { exit: 2, meaning: 'The aligner has no model for the language given.', fix: 'Use --language en, or leave --script away: the transcriber takes other languages, with less exact times.' },
  'word-unplaced': { exit: 1, severity: 'warning', meaning: 'The aligner could not place a word of the script on the sound; its time is shared out from the words beside it.', fix: 'Check the word at its frame with `viraleditor frames`; correct its spelling in the script if it is not what is said.' },

  // ── the tools ──
  'tool-missing': { exit: 3, meaning: 'A tool the editor needs is not installed, or is another version than the one it reads. `doctor` gives a missing aligner as a warning with this code: only `words --script` needs it.', fix: 'Run `viraleditor doctor`: it names what is missing and how to get it.' },
  'aligner-missing': { exit: 3, meaning: 'The local aligner (tools/align) is not set up, so a script cannot be placed on the sound.', fix: 'Run tools/align/setup.sh in the viraleditor folder (offline), then `viraleditor doctor`; or leave --script away to use the transcriber.' },
  'tool-failed': { exit: 3, meaning: 'ffmpeg, ffprobe or the HyperFrames CLI did not start, did not finish in time or failed.', fix: 'Run `viraleditor doctor`; if everything is ready, run the command again (the machine may be busy).' },
  'render-failed': { exit: 3, meaning: 'The render did not produce a video.', fix: 'Run `viraleditor doctor`; if everything is ready, run `viraleditor check <edit.json> --deep` and then the render again.' },
  'stills-failed': { exit: 3, meaning: 'The stills were not written.', fix: 'Run `viraleditor doctor`; if everything is ready, run `viraleditor check <edit.json> --deep` and then the command again.' },
  'composition-fault': { exit: 3, meaning: 'The check of the renderer refuses the composition the editor wrote from a valid document: a fault of the editor, not of the document.', fix: 'Remove or simplify the element named to get on, and report the issue with the composition folder.' },
  internal: { exit: 3, meaning: 'The command line failed in a way it does not know: a fault of the editor, not of the document.', fix: 'Run the command again; if it fails the same way, report the command and this message. `viraleditor doctor` tells whether the tools are ready.' },
} as const satisfies Record<string, CodeInfo>;

export type CliCode = keyof typeof CLI_CODES;

/** The exit code an issue stands for: the table's for a code of the command line, 1 for every code of the document, the media or a render. */
export function exitOf(code: string): 1 | 2 | 3 {
  return Object.hasOwn(CLI_CODES, code) ? CLI_CODES[code as CliCode].exit : 1;
}
