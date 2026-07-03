#!/usr/bin/env node
import { Command, Option } from 'commander';
import { logger } from './util/logger.js';
import { runCommand } from './commands/run.js';
import { initCommand } from './commands/init.js';
import { installBrowserCommand } from './commands/installBrowser.js';
import { setTargetCommand } from './commands/setTarget.js';
import { validateCommand } from './commands/validate.js';
import { doctorCommand } from './commands/doctor.js';
import { printVoCommand } from './commands/printVo.js';
import { approveVoCommand } from './commands/approveVo.js';
import { rerunSegmentCommand } from './commands/rerunSegment.js';
import { captureAuthCommand } from './commands/captureAuth.js';
import { traceCommand } from './commands/trace.js';
import { previewCommand } from './commands/preview.js';
import { studioCommand } from './commands/studio.js';
import { understandCommand } from './commands/understand.js';
import { instrumentCommand } from './commands/instrument.js';
import { recordActionsCommand } from './commands/recordActions.js';
import { produceCommand } from './commands/produce.js';
import { authorPlanCommand, type AuthorPlanCommandOpts } from './commands/authorPlan.js';
import { notImplemented } from './commands/notImplemented.js';
import { STAGE_NAMES, type StageName } from './pipeline/types.js';

const program = new Command();

program
  .name('showrunner')
  .description('Automated product demo recording & production tool')
  .version('1.1.8')
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
  .command('set-target')
  .description("Update demo.yaml's recording.target_url and re-probe it")
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .requiredOption('--url <url>', 'new target URL (e.g. http://localhost:5173)')
  .option('--force', 'skip the reachability probe and update the URL anyway', false)
  .action(setTargetCommand);

program
  .command('install-browser')
  .description('Install the Playwright browser binary (chromium by default) — wraps playwright-core install')
  .option('--browser <name>', 'browser to install: chromium | firefox | webkit', 'chromium')
  .action(installBrowserCommand);

program
  .command('doctor')
  .description(
    'Run preflight checks. Without -c: system-prereq pass only (ffmpeg / ffprobe / chromium). With -c: full pass including provider keys, target URL, scripts.',
  )
  .option('-c, --config <path>', 'path to demo.yaml — switches doctor into full-pass mode')
  .option('--json', 'emit results as JSON instead of human-readable rows')
  .option(
    '--fix',
    'on each fixable FAIL, prompt to run a remediation (e.g. install missing ffmpeg / chromium) and re-check',
  )
  .action(doctorCommand);

program
  .command('validate')
  .description('Validate a demo.yaml config file')
  .requiredOption('-c, --config <path>', 'path to demo.yaml')
  .option('--strict', 'exit nonzero on any warning (e.g. missing provider env var)')
  .action(validateCommand);

program
  .command('understand')
  .description('Build product_model.json from documents, interactive Q&A, or agent-driven repo exploration')
  .option('-c, --config <path>', 'path to demo.yaml')
  .option('--interactive', 'use interactive Q&A mode (5 prompts, no LLM)')
  .option(
    '--agent',
    'delegate to the local `claude` CLI: it explores the project with its read tools and synthesizes the product model. Closes the type=codebase gap in demo.yaml sources.',
  )
  .option(
    '--project-dir <path>',
    'directory the --agent run should explore. Overrides project.codebase_root from demo.yaml. Defaults to configDir/.. when -c is given, or cwd otherwise.',
  )
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
  .command('studio')
  .description('Launch the Showrunner Studio (web testbench)')
  .option('--port <port>', 'preferred port', '4321')
  .action(studioCommand);

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

program
  .command('produce')
  .description(
    'MAIViS Orchestrator harness: run capture+VO+mux from a single spec.json and emit one `realized` JSON (mp4 + intrinsic_duration + word markers) to <out>/realized.json and stdout',
  )
  .argument('<spec>', 'path to the produce spec.json (target + voice + capture manifest)')
  .requiredOption('--out <dir>', 'work directory for this run; realized.json is written here')
  .action((spec: string, opts: { out: string }) => produceCommand(spec, opts));

program
  .command('author-plan')
  .description(
    'Explore a live target and author a grounded capture plan (manifest + selector inventory) as JSON. ' +
      'Non-zero exit + { error } JSON on a failed inspection — never a partial/guessed plan.',
  )
  .option('--intent <path>', 'path to a JSON file matching AuthorPlanInput (target_url, instructions, duration_s, ...)')
  .option('--target-url <url>', 'target URL to explore (overrides --intent)')
  .option('--instructions <text>', 'freeform authoring guidance (overrides --intent)')
  .option('--duration-s <seconds>', 'target capture duration in seconds (overrides --intent)')
  .option(
    '--out <path>',
    'write the AuthorPlanResult (or error) JSON here; default stdout/stderr. ' +
      'Machine callers should use --out: with the global --json log mode, log lines also go to stdout and can interleave with the plan JSON.',
  )
  .action((opts: AuthorPlanCommandOpts) => authorPlanCommand(opts));

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

  const missing = await detectMissingPrereqs();
  const anyMissing = missing.ffmpeg || missing.ffprobe || missing.chromium;

  const lines: string[] = ['', `Showrunner v1.1.8`, ''];

  // First-time setup short-circuits everything else — without these tools,
  // doctor/init/run can't do anything useful.
  if (anyMissing) {
    lines.push(`First-time setup. Showrunner needs these system tools:`);
    lines.push(``);
    if (missing.ffmpeg || missing.ffprobe) {
      const which =
        missing.ffmpeg && missing.ffprobe
          ? 'ffmpeg / ffprobe'
          : missing.ffmpeg
            ? 'ffmpeg'
            : 'ffprobe';
      lines.push(`  ${which} — install via your OS package manager:`);
      lines.push(`    Linux (apt):    sudo apt install ffmpeg`);
      lines.push(`    Linux (pacman): sudo pacman -S ffmpeg`);
      lines.push(`    Linux (dnf):    sudo dnf install ffmpeg`);
      lines.push(`    macOS:          brew install ffmpeg`);
      lines.push(`    Windows:        winget install Gyan.FFmpeg`);
      lines.push(``);
    }
    if (missing.chromium) {
      lines.push(`  chromium recording browser — install via:`);
      lines.push(`    showrunner install-browser`);
      lines.push(``);
    }
    lines.push(`Re-run \`showrunner\` once those are in place.`);
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
    lines.push(`  cd <your-product's-root-directory>   # the dir with package.json / etc.`);
    lines.push(`  showrunner init                       # then run init from THERE`);
    lines.push(``);
    lines.push(`\`init\` scaffolds inside cwd, so cwd must be your product. The wizard will`);
    lines.push(`confirm the path before doing anything destructive.`);
  }

  lines.push('');
  process.stdout.write(lines.join('\n'));
}

interface MissingPrereqs {
  ffmpeg: boolean;
  ffprobe: boolean;
  chromium: boolean;
}

async function detectMissingPrereqs(): Promise<MissingPrereqs> {
  const [ffmpegOk, ffprobeOk, chromiumOk] = await Promise.all([
    binaryOnPath('ffmpeg'),
    binaryOnPath('ffprobe'),
    chromiumInstalled(),
  ]);
  return {
    ffmpeg: !ffmpegOk,
    ffprobe: !ffprobeOk,
    chromium: !chromiumOk,
  };
}

async function binaryOnPath(name: string): Promise<boolean> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const useShell = process.platform === 'win32';
    const child = spawn(name, ['-version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: useShell,
    });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.on('error', () => finish(false));
    child.on('exit', (code) => finish(code === 0));
    setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
        finish(false);
      }
    }, 3000);
  });
}

async function chromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright-core');
    const exec = chromium.executablePath();
    const { stat } = await import('node:fs/promises');
    await stat(exec);
    return true;
  } catch {
    return false;
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
