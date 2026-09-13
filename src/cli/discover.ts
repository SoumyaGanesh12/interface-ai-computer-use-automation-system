#!/usr/bin/env -S npx tsx
/**
 * Runnable entry point for `npm run discover`. Wires a real Gemini-backed ModelClient and
 * a real headed Chromium Surface into the discovery loop against the fixture app. The
 * login sequence is a fixed preflight (the model never sees the login page) -- specific
 * to this fixture, not something src/agent knows about generically.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { loadModelConfig } from '../config/model';
import { createOpenAiCompatibleClient } from '../model/openai-compatible-client';
import { createPlaywrightWebSurface } from '../surface/playwright-surface';
import { discover, type PreflightStep } from '../agent/discover';
import { compileArtifact } from '../recorder/compile';
import { reportCompiledArtifact } from './report-compiled';
import { generateRunId } from '../evidence/run-id';
import { RunLease } from '../session/lease';
import { ConsoleOperatorChannel } from '../session/operator-channel';
import { watchForHumanTakeover } from './human-takeover';
import type { Allowlist } from '../policy/allowlist';
import type { TraceFile } from '../agent/trace';

function buildPreflight(baseUrl: string): PreflightStep[] {
  return [
    { intent: 'open the login page', action: { kind: 'navigate', url: `${baseUrl}/login` } },
    {
      intent: 'enter the operator username',
      action: {
        kind: 'type',
        target: {
          recordedTier: 1,
          candidates: [{ tier: 1, confidence: 0.95, note: 'Real <label for> on this field.', locator: { strategy: 'roleAndName', role: 'textbox', name: 'Username' } }],
        },
        text: 'svc.operator',
      },
    },
    {
      intent: 'enter the operator password',
      action: {
        kind: 'typeCredential',
        target: {
          recordedTier: 2,
          candidates: [{ tier: 2, confidence: 0.8, note: "No label -- only the adjacent 'Password' cell.", locator: { strategy: 'labelProximity', labelText: 'Password', direction: 'right', role: 'textbox' } }],
        },
        credentialRef: 'FIXTURE_OPERATOR_PASSWORD',
      },
    },
    {
      intent: 'submit the login form',
      action: {
        kind: 'click',
        target: {
          recordedTier: 1,
          candidates: [{ tier: 1, confidence: 0.95, note: 'A real <button>.', locator: { strategy: 'roleAndName', role: 'button', name: 'Log In' } }],
        },
      },
    },
  ];
}

const program = new Command();
program
  .name('discover')
  .description('Run a goal-driven, LLM-backed discovery session against the fixture app.')
  .requiredOption('--goal <text>', 'the task to accomplish, in plain language')
  .option('--base-url <url>', 'fixture base URL', 'http://localhost:4400')
  .option('--headless', 'run Chromium headless instead of headed', false)
  .option('--allow-irreversible', 'dispatch irreversible actions automatically instead of escalating to a human', false)
  .option('--max-steps <n>', 'maximum model-driven steps before giving up', (v) => Number(v))
  .option('--escalation-timeout-ms <n>', 'how long to wait for a human before an escalated step times out', (v) => Number(v))
  .option('--record', 'on success, immediately compile the run into a draft artifact -- no separate record step', false)
  .option('--capability-id <id>', 'required with --record: the compiled capability\'s id')
  .option('--capability-name <name>', 'the compiled capability\'s display name (defaults to --goal)')
  .option('--capability-description <text>', 'the compiled capability\'s description (defaults to --goal)')
  .option('--semver <version>', 'capability version', '1.0.0')
  .option('--app <app>', 'the surface.app value', 'member-services-console')
  .option('--app-version <version>', 'the surface.appVersion value', '1.0.0')
  .option('--variant <variant>', 'the surface.variant value', 'base')
  .option('--overwrite', 'with --record, overwrite an existing artifact at the output path instead of refusing', false)
  .parse(process.argv);

const opts = program.opts<{
  goal: string;
  baseUrl: string;
  headless: boolean;
  allowIrreversible: boolean;
  maxSteps?: number;
  escalationTimeoutMs?: number;
  record: boolean;
  capabilityId?: string;
  capabilityName?: string;
  capabilityDescription?: string;
  semver: string;
  app: string;
  appVersion: string;
  variant: string;
  overwrite: boolean;
}>();

if (opts.record && !opts.capabilityId) {
  console.error('--record requires --capability-id');
  process.exit(1);
}

async function main(): Promise<void> {
  const modelConfig = loadModelConfig();
  const model = createOpenAiCompatibleClient(modelConfig);

  const policy: Allowlist = {
    allowedOrigins: [new URL(opts.baseUrl).origin],
    allowedActions: ['navigate', 'click', 'type', 'typeCredential', 'select', 'read'],
  };

  const runId = generateRunId('discovery');
  const surface = await createPlaywrightWebSurface({ runId, policy, headless: opts.headless });
  const lease = new RunLease();
  const operatorChannel = new ConsoleOperatorChannel();

  console.log(`run: ${runId}`);
  console.log(`goal: ${opts.goal}`);

  let running = true;
  const takeoverWatcher = watchForHumanTakeover(lease, () => running);

  try {
    const result = await discover({
      goal: opts.goal,
      target: opts.baseUrl,
      runId,
      modelId: modelConfig.modelId,
      surface,
      model,
      policy,
      lease,
      operatorChannel,
      preflight: buildPreflight(opts.baseUrl),
      allowIrreversible: opts.allowIrreversible,
      maxSteps: opts.maxSteps,
      escalationTimeoutMs: opts.escalationTimeoutMs,
      maxTokensPerRun: modelConfig.maxTokensPerRun,
      onStep: (step) => {
        const status = step.result === 'ok' ? 'ok' : `failed (${step.detail})`;
        console.log(`  [${step.stepIndex + 1}] ${step.source}: ${step.intent} -> ${status}`);
      },
    });

    console.log(`\nstatus: ${result.status}`);
    if (result.outputs) console.log(`outputs: ${JSON.stringify(result.outputs)}`);
    if (result.reason) console.log(`reason: ${result.reason}`);
    console.log(`total tokens: ${result.totalTokens}`);
    console.log(`trace: ${result.tracePath}`);
    console.log(`evidence: evidence/${runId}/`);

    if (opts.record) {
      if (result.status !== 'done') {
        console.log('\nrecord: skipped -- only a run that completes with status "done" can be compiled');
      } else {
        console.log('\ncompiling into a draft artifact...');
        const trace = JSON.parse(readFileSync(result.tracePath, 'utf-8')) as TraceFile;
        const compiled = await compileArtifact(trace, {
          surface,
          capability: { id: opts.capabilityId!, name: opts.capabilityName ?? opts.goal, semver: opts.semver, description: opts.capabilityDescription ?? opts.goal },
          app: opts.app,
          appVersion: opts.appVersion,
          variant: opts.variant,
        });
        if (!compiled.ok) {
          console.error(`record failed: ${compiled.reason}`);
        } else {
          const outPath = path.join('artifacts', `${opts.capabilityId}@${opts.semver}.json`);
          mkdirSync(path.dirname(outPath), { recursive: true });
          if (existsSync(outPath) && !opts.overwrite) {
            console.error(`refusing to overwrite an existing artifact: ${outPath} (pass --overwrite to replace it)`);
          } else {
            writeFileSync(outPath, JSON.stringify(compiled.artifact, null, 2) + '\n', 'utf-8');
            reportCompiledArtifact(compiled.artifact, outPath);
          }
        }
      }
    }

    process.exitCode = result.status === 'done' ? 0 : 1;
  } finally {
    running = false;
    await takeoverWatcher;
    await surface.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
