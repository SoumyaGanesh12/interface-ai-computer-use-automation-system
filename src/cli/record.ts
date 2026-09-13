#!/usr/bin/env -S npx tsx
/**
 * Runnable entry point: compiles a discovery trace into a draft capability artifact and
 * writes it to disk. A thin wrapper -- all the actual compiling happens in
 * src/recorder/compile.ts; this only reads the CLI's own inputs and writes the result.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { compileArtifact } from '../recorder/compile';
import { createPlaywrightWebSurface } from '../surface/playwright-surface';
import { reportCompiledArtifact } from './report-compiled';
import type { Allowlist } from '../policy/allowlist';
import type { TraceFile } from '../agent/trace';

const program = new Command();
program
  .name('record')
  .description('Compile a discovery trace into a draft capability artifact.')
  .requiredOption('--trace <path>', 'path to a traces/<runId>.json file')
  .requiredOption('--capability-id <id>', 'the compiled capability\'s id')
  .requiredOption('--name <name>', 'the compiled capability\'s display name')
  .requiredOption('--description <text>', 'the compiled capability\'s description')
  .option('--semver <version>', 'capability version', '1.0.0')
  .option('--app <app>', 'the surface.app value', 'member-services-console')
  .option('--app-version <version>', 'the surface.appVersion value', '1.0.0')
  .option('--variant <variant>', 'the surface.variant value', 'base')
  .option('--base-url <url>', 'fixture base URL', 'http://localhost:4400')
  .option('--headless', 'run Chromium headless instead of headed', false)
  .option('--out <path>', 'override the output path (default: artifacts/<capability-id>@<semver>.json)')
  .option('--overwrite', 'overwrite an existing artifact at the output path instead of refusing', false)
  .parse(process.argv);

const opts = program.opts<{
  trace: string;
  capabilityId: string;
  name: string;
  description: string;
  semver: string;
  app: string;
  appVersion: string;
  variant: string;
  baseUrl: string;
  headless: boolean;
  out?: string;
  overwrite: boolean;
}>();

async function main(): Promise<void> {
  const trace = JSON.parse(readFileSync(opts.trace, 'utf-8')) as TraceFile;

  const policy: Allowlist = {
    allowedOrigins: [new URL(opts.baseUrl).origin],
    allowedActions: ['navigate', 'click', 'type', 'typeCredential', 'select', 'read'],
  };
  const surface = await createPlaywrightWebSurface({ runId: `record-${Date.now()}`, policy, headless: opts.headless });

  console.log(`compiling: ${opts.trace}`);

  try {
    const result = await compileArtifact(trace, {
      surface,
      capability: { id: opts.capabilityId, name: opts.name, semver: opts.semver, description: opts.description },
      app: opts.app,
      appVersion: opts.appVersion,
      variant: opts.variant,
    });

    if (!result.ok) {
      console.error(`compile failed: ${result.reason}`);
      process.exitCode = 1;
      return;
    }

    const outPath = opts.out ?? path.join('artifacts', `${opts.capabilityId}@${opts.semver}.json`);
    mkdirSync(path.dirname(outPath), { recursive: true });
    if (existsSync(outPath) && !opts.overwrite) {
      console.error(`refusing to overwrite an existing artifact: ${outPath} (pass --overwrite to replace it)`);
      process.exitCode = 1;
      return;
    }
    writeFileSync(outPath, JSON.stringify(result.artifact, null, 2) + '\n', 'utf-8');
    reportCompiledArtifact(result.artifact, outPath);
  } finally {
    await surface.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
