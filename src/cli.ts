#!/usr/bin/env node
import { Command, Option } from 'commander';
import { logger } from './util/logger.js';
import { runCommand } from './commands/run.js';
import { initCommand } from './commands/init.js';
import { installBrowserCommand } from './commands/installBrowser.js';
import { validateCommand } from './commands/validate.js';
import { doctorCommand } from './commands/doctor.js';
import { printVoCommand } from './commands/printVo.js';
import { approveVoCommand } from './commands/approveVo.js';
import { rerunSegmentCommand } from './commands/rerunSegment.js';
import { captureAuthCommand } from './commands/captureAuth.js';
import { traceCommand } from './commands/trace.js';
import { previewCommand } from './commands/preview.js';
import { understandCommand } from './commands/understand.js';
import { instrumentCommand } from './commands/instrument.js';
import { recordActionsCommand } from './commands/recordActions.js';
import { notImplemented } from './commands/notImplemented.js';
import { STAGE_NAMES, type StageName } from './pipeline/types.js';

const program = new Command();

program
  .name('showrunner')
  .description('Automated product demo recording & production tool')
  .version('1.1.4')
  .option('--json', 'emit structured JSON logs to stdout')
  .option('--log-level <level>', 'log level (debug|info|warn|error)')
  .hook('preAction', (thisCmd) => {
    const opts = thisCmd.opts<{ json?: boolean; logLevel?: string }>();
    if (opts.json) logger.setJson(true);
    if (opts.logLevel) logger.setLevel(opts.logLevel as 'debug' | 'info' | 'warn' | 'error');
  })
  .action(async () => {
    // Bare `showrunner` with no subcommand: print a context-aware welcome
    // instead of falling through to `--help`.
    await printWelcome();
  });

const stageChoices = [...STAGE_NAMES];

program
  .command('run')
  .description('Run the full Showrunner pipeline')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .addOption(
    new Option('--stages <stages>', 'comma-separated subset of stages to run').argParser((v) =>
      parseStages(v),
    ),
  )
  .addOption(
    new Option('--force <stages>', 'comma-separated stages whose artifacts to regenerate').argParser(
      (v) => parseStages(v),
    ),
  )
  .option('--no-interactive', 'disable interactive prompts (agent mode)')
  .option('--resume', 'resume a previously-failed run from the last successful stage')
  .option('--dry-run', 'generate scripts without recording, synthesizing, or muxing')
  .option('--estimate', 'print API cost estimate and exit')
  .option('--output-path <path>', 'override output_path from config')
  .option('--watch', 'run the recording stage in headed mode (overrides config.recording.headless)')
  .option('--skip-doctor', 'skip the implicit preflight doctor checks')
  .option(
    '--resolution <preset>',
    'override resolution for this run: low (854x480), standard (720p), high (1080p), extreme (4K)',
  )
  .action(runCommand);

program
  .command('init')
  .description('Scaffold a new Showrunner project (interactive by default; use --yes to skip prompts)')
  .option('--name <name>', 'project name', 'showrunner-demo')
  .option('--url <url>', 'target URL of the product to demo', 'http://localhost:3000')
  .option('--dir <dir>', 'parent directory in which to create the project', process.cwd())
  .option('--force', 'overwrite an existing directory', false)
  .option('--yes', 'skip interactive prompts and use defaults / passed flags', false)
  .option(
    '--llm-provider <name>',
    'LLM provider for comprehension + script + instrument (anthropic | openai | agent_bridge)',
    'anthropic',
  )
  .option(
    '--tts-provider <name>',
    'TTS provider for voiceover (elevenlabs | openai | custom)',
    'elevenlabs',
  )
  .option(
    '--resolution <preset>',
    'scaffold resolution: low (854x480) | standard (720p) | high (1080p) | extreme (4K)',
    'standard',
  )
  .action(initCommand);

program
  .command('install-browser')
  .description('Install the Playwright browser binary (chromium by default) — wraps playwright-core install')
  .option('--browser <name>', 'browser to install: chromium | firefox | webkit', 'chromium')
  .action(installBrowserCommand);

program
  .command('doctor')
  .description('Run preflight checks on the current config + environment')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .option('--json', 'emit results as JSON instead of human-readable rows')
  .action(doctorCommand);

program
  .command('validate')
  .description('Validate a demo.yaml config file')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .option('--strict', 'exit nonzero on any warning (e.g. missing provider env var)')
  .action(validateCommand);

program
  .command('understand')
  .description('Build product_model.json from documents or interactive Q&A')
  .option('-c, --config <path>', 'path to demo.yaml')
  .option('--interactive', 'use interactive Q&A mode')
  .option('--output <path>', 'output path for product_model.json')
  .action(understandCommand);

program
  .command('instrument')
  .description('Suggest data-testid attributes for a codebase')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .requiredOption('--output <path>', 'unified diff output path')
  .option('--glob <pattern>', 'override comprehension.sources with an ad-hoc glob (relative to configDir)')
  .action(instrumentCommand);

program
  .command('record-actions')
  .description('Author manifest actions by demonstrating them in a live browser')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .option('--segment <id>', 'replace actions for an existing segment id')
  .option('--output <path>', 'manifest output path (default ./scripts/manifest.json)')
  .action(recordActionsCommand);

program
  .command('preview')
  .description('Preview the generated Playwright script in UI Mode')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .action(previewCommand);

program
  .command('trace')
  .description('Open the Playwright Trace Viewer for a recording')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .option('--segment <id>', 'open trace for one segment')
  .option('--all', 'open traces for all segments from the last run')
  .action(traceCommand);

program
  .command('rerun-segment')
  .description('Re-record a single segment (runs reset_script first)')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .requiredOption('--segment <id>', 'segment to re-run')
  .action(rerunSegmentCommand);

program
  .command('print-vo')
  .description('Print the generated VO script for review')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .action(printVoCommand);

program
  .command('capture-auth')
  .description('Capture an auth session interactively (run once during setup)')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .option('--output-cookies <path>', 'storageState output path', './auth/session.json')
  .action(captureAuthCommand);

program
  .command('approve-vo')
  .description('Approve edited VO script and resume the pipeline')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .action(approveVoCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(message);
  process.exit(1);
});

async function printWelcome(): Promise<void> {
  const { access } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const demoYaml = resolve(process.cwd(), 'demo.yaml');
  let inProject = false;
  try {
    await access(demoYaml);
    inProject = true;
  } catch {
    // not in a Showrunner project root
  }

  const browserMissing = await isChromiumMissing();

  const lines: string[] = ['', `Showrunner v1.1.4`, ''];

  // Surface one state at a time. Higher-priority states short-circuit lower ones.
  if (browserMissing) {
    lines.push(`Showrunner records using Chromium. You haven't installed it yet.`);
    lines.push(``);
    lines.push(`  showrunner install-browser`);
    lines.push(``);
    lines.push(`(~150 MB, one-off. Re-run \`showrunner\` after it finishes for the next step.)`);
  } else if (inProject) {
    lines.push(`This is a Showrunner project (found demo.yaml).`);
    lines.push(``);
    lines.push(`  showrunner doctor -c demo.yaml     # check everything is wired correctly`);
    lines.push(`  showrunner run -c demo.yaml        # then run the full pipeline`);
    lines.push(``);
    lines.push(`Full command list: \`showrunner --help\``);
  } else {
    lines.push(`No Showrunner project in this directory. To create one:`);
    lines.push(``);
    lines.push(`  showrunner init`);
    lines.push(``);
    lines.push(`\`init\` scaffolds the project and prints the next 4 commands tailored to your provider choice.`);
  }

  lines.push('');
  process.stdout.write(lines.join('\n'));
}

async function isChromiumMissing(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright-core');
    const exec = chromium.executablePath();
    const { stat } = await import('node:fs/promises');
    await stat(exec);
    return false;
  } catch {
    return true;
  }
}

function parseStages(value: string): StageName[] {
  const requested = value.split(',').map((s) => s.trim());
  const invalid = requested.filter((s) => !stageChoices.includes(s as StageName));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown stage(s): ${invalid.join(', ')}. Valid stages: ${stageChoices.join(', ')}`,
    );
  }
  return requested as StageName[];
}
