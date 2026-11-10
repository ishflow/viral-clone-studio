// The table of commands. Everything the command line knows of a command comes from its row: the usage text, the
// argument parser, the suggestion for a mistyped flag. A new command is a file in commands/ and one more entry here.
import { check } from './commands/check.ts';
import { codes } from './commands/codes.ts';
import { doctor } from './commands/doctor.ts';
import { frames } from './commands/frames.ts';
import { init } from './commands/init.ts';
import { inspect } from './commands/inspect.ts';
import { normalize } from './commands/normalize.ts';
import { plan } from './commands/plan.ts';
import { probe } from './commands/probe.ts';
import { render } from './commands/render.ts';
import { schema } from './commands/schema.ts';
import { sheet } from './commands/sheet.ts';
import { settings, settingsArgs } from './commands/settings.ts';
import { settleUnknownCommand } from './commands/settle-unknown.ts';
import { words } from './commands/words.ts';
import type { Context } from './context.ts';
import { run } from './framework.ts';
import type { Command, Ran } from './framework.ts';
import { explain } from './translate.ts';
import { VERSION } from './version.ts';

export const COMMANDS: Command<Context>[] = [doctor, init, check, frames, render, sheet, inspect, probe, normalize, schema, codes, plan, words, settings, settleUnknownCommand];

/** Runs one command line. `argv`: the words after the program name. Never throws. */
export function cli(argv: string[], context: Context): Promise<Ran> {
  return run(settingsArgs(argv), COMMANDS, context, { log: context.log, explain, version: VERSION });
}
