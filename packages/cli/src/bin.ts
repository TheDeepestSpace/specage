#!/usr/bin/env node
import { CliError, parseArgs } from './util.js';
import {
  cmdCallback,
  cmdCursor,
  cmdDiff,
  cmdHash,
  cmdLint,
  cmdOutbox,
  cmdParse,
  cmdQuestion,
  cmdRender,
  cmdState,
} from './commands.js';

const HELP = `specage <command>

  parse <file> [--json]
  lint <file> [--state <dir>] [--json]
  hash <file> [--json]
  diff --from <ref|file|empty|dispatch/latest> --to <ref|file> [--spec-file <name>] [--project <name>] [--json]
  state validate <dir> | state commit -m <msg> [--dir <checkout>]
  question anchor <removed-id> --from <ref|file> --to <ref|file>   (prints {node,node_hash?}; node '' = top-level)
  cursor [--tag <dispatch tag>] [--project <name>]
  outbox fire (--range <a>..<b> | --unfired --cwd <trail checkout>) --repo <o/r> --intern <o/r> --project <p> --data-repo <o/r> [--specage-repo <o/r>] [--dry-run]
  callback --status <s> --context <json> [--pr <n>] [--issue <n>] [--state-dir <trail checkout>] [--intern <o/r> --specage-repo <o/r> --data-repo <o/r>] [--dry-run]
  render --spec <file> --state <dir> --out <dir>

exit codes: 0 ok, 1 lint/validation errors, 2 usage, 3 git/GitHub error`;

async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (!cmd || a.flags.help || cmd === 'help') {
    console.log(HELP);
    return cmd ? 0 : 2;
  }
  switch (cmd) {
    case 'parse':
      return cmdParse(a);
    case 'lint':
      return cmdLint(a);
    case 'hash':
      return cmdHash(a);
    case 'diff':
      return cmdDiff(a);
    case 'state':
      return cmdState(a);
    case 'question':
      return cmdQuestion(a);
    case 'cursor':
      return cmdCursor(a);
    case 'outbox':
      return cmdOutbox(a);
    case 'callback':
      return cmdCallback(a);
    case 'render':
      return cmdRender(a);
    default:
      throw new CliError(`unknown command "${cmd}"`);
  }
}

main().then(
  (c) => process.exit(c),
  (e) => {
    if (e instanceof CliError) {
      console.error(`specage: ${e.message}`);
      process.exit(e.code);
    }
    console.error(e);
    process.exit(3);
  },
);
