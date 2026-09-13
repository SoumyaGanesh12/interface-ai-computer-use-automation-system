#!/usr/bin/env -S npx tsx
/**
 * Runnable entry point for `npm run discover`. Wires a real Gemini-backed ModelClient and
 * a real headed Chromium Surface into the discovery loop against the fixture app. The
 * login sequence is a fixed preflight (the model never sees the login page) -- specific
 * to this fixture, not something src/agent knows about generically.
 */
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { loadModelConfig } from '../config/model';
import { createOpenAiCompatibleClient } from '../model/openai-compatible-client';
import { createPlaywrightWebSurface } from '../surface/playwright-surface';
import { discover, type PreflightStep } from '../agent/discover';
import { generateRunId } from '../evidence/run-id';
import { RunLease } from '../session/lease';
import { ConsoleOperatorChannel } from '../session/operator-channel';
import type { Allowlist } from '../policy/allowlist';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The console's side of a real human takeover: once the lease reports
 * PAUSED_PENDING_HUMAN, this prompts on stdin and blocks until the operator at the
 * keyboard presses Enter -- at which point it claims and releases the lease itself,
 * exactly as a real operator console would after a person finishes acting in the open
 * browser window. Runs concurrently with discover(), polling rather than blocking it,
 * since the escalation notification (ConsoleOperatorChannel) must not itself wait on
 * this -- it only announces the request.
 */
async function watchForHumanTakeover(lease: RunLease, isRunning: () => boolean): Promise<void> {
  let prompted = false;
  while (isRunning()) {
    if (lease.state === 'PAUSED_PENDING_HUMAN' && !prompted) {
      prompted = true;
      const intervention = lease.getIntervention();
      console.log(`\n>>> A human is needed: ${intervention?.reason}`);
      console.log('>>> Complete the action yourself in the open browser window, then press Enter here to resume automation.');

      // Cancels the prompt the moment the lease resolves on its own (the escalation
      // window elapsing), so a slow or absent human never leaves this hanging forever.
      const abortPrompt = new AbortController();
      const stopWatchingForAbort = (async () => {
        while (lease.state === 'PAUSED_PENDING_HUMAN' && isRunning()) await delay(150);
        abortPrompt.abort();
      })();

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        await rl.question('Press Enter once done (or wait for the escalation timeout) > ', { signal: abortPrompt.signal });
        if (lease.state === 'PAUSED_PENDING_HUMAN') {
          lease.takeControl();
          lease.releaseControl();
        }
      } catch {
        // the lease resolved on its own before Enter was pressed -- nothing to do
      } finally {
        rl.close();
        await stopWatchingForAbort;
      }
    }
    if (lease.state === 'AUTOMATION') prompted = false;
    if (lease.state === 'ABORTED') return;
    await delay(150);
  }
}

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
  .parse(process.argv);

const opts = program.opts<{
  goal: string;
  baseUrl: string;
  headless: boolean;
  allowIrreversible: boolean;
  maxSteps?: number;
  escalationTimeoutMs?: number;
}>();

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
    });

    console.log(`\nstatus: ${result.status}`);
    if (result.outputs) console.log(`outputs: ${JSON.stringify(result.outputs)}`);
    if (result.reason) console.log(`reason: ${result.reason}`);
    console.log(`total tokens: ${result.totalTokens}`);
    console.log(`trace: ${result.tracePath}`);
    console.log(`evidence: evidence/${runId}/`);

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
