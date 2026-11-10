#!/usr/bin/env node
// viraleditor <command> [arguments] [--json]: the answer on stdout, progress on stderr, the exit code of the table in codes.ts.
// Nothing is imported statically: when a module cannot load (a syntax error, a missing dependency) the program still
// answers as it always does, with the issue `internal` and exit 3, never with a stack trace alone.
const argv = process.argv.slice(2);
let answered = false;

/** The answer when the program cannot load, or dies outside a command. The stack goes to stderr. */
function broken(error: unknown): void {
  if (answered) return;
  answered = true;
  const first = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).split('\n')[0]!.slice(0, 400);
  process.stderr.write(`${error instanceof Error ? error.stack ?? first : first}\n`);
  const command = argv.find((word) => !word.startsWith('-')) ?? '';
  const found = {
    code: 'internal', target: 'viraleditor',
    message: `viraleditor could not start or stopped unexpectedly: ${first}`,
    fix: `Run \`viraleditor doctor\`; if it fails the same way, the installation is broken: ${first}. Run \`pnpm install\` in the viraleditor folder; if a source file is named, that file is at fault.`,
  };
  const answer = { ok: false, command, issues: [found], warnings: [], result: null };
  const text = argv.includes('--json') ? JSON.stringify(answer, null, 2)
    : `FAILED ${command || 'viraleditor'} (exit 3): 1 error, 0 warnings\nerror internal at viraleditor: ${found.message}\n  fix: ${found.fix}`;
  process.stdout.write(`${text}\n`, () => process.exit(3));
}
process.on('uncaughtException', broken);
process.on('unhandledRejection', broken);

try {
  const [{ cli }, { realContext }] = await Promise.all([import('./commands.ts'), import('./context.ts')]);
  const ran = await cli(argv, realContext());
  answered = true;
  process.stdout.write(ran.stdout, () => process.exit(ran.exit));
} catch (error) {
  broken(error);
}
