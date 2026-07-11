#!/usr/bin/env node

const pkg = require('../package.json');
const {
  LIFECYCLE_COMMANDS,
  resolveScope,
  runLifecycle
} = require('../lib/dverity/install/lifecycle');

const HELP = `Usage: dverity <command> (--global | --project <absolute-path>)

Commands:
${LIFECYCLE_COMMANDS.map((command) => `  ${command}`).join('\n')}

Options:
  --global
  --project <absolute-path>
  --help
  --version`;

function output(stream, message, status = 0) {
  stream.write(`${message}\n`);
  return status;
}

function withoutArguments(action) {
  return (args) => args.length === 0
    ? action()
    : output(process.stderr, 'This command accepts no arguments', 2);
}

function execute(command, args) {
  try {
    const result = runLifecycle(command, resolveScope(args));
    return output(process.stdout, result.message);
  } catch (error) {
    return output(process.stderr, error.message, 2);
  }
}

const HANDLERS = Object.fromEntries(LIFECYCLE_COMMANDS.map((command) => [
  command,
  (args) => execute(command, args)
]));
HANDLERS.help = withoutArguments(() => output(process.stdout, HELP));
HANDLERS['--help'] = HANDLERS.help;
HANDLERS.version = withoutArguments(() => output(process.stdout, pkg.version));
HANDLERS['--version'] = HANDLERS.version;

function main(args = process.argv.slice(2)) {
  const [command = '--help', ...rest] = args;
  const handler = HANDLERS[command];
  return handler
    ? handler(rest)
    : output(process.stderr, `Unknown command: ${command}`, 3);
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
