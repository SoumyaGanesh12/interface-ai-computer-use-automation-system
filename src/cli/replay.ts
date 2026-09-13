#!/usr/bin/env -S npx tsx
/**
 * Runnable entry point: runs a capability artifact with no model anywhere in the loop.
 * A thin wrapper -- all the actual replay logic lives in src/replay/executor.ts.
 */
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { validateArtifact } from '../catalog/validate';
import { replay } from '../replay/executor';
import { createPlaywrightWebSurface } from '../surface/playwright-surface';
import { generateRunId } from '../evidence/run-id';
import { RunLease } from '../session/lease';
import { ConsoleOperatorChannel } from '../session/operator-channel';
import { watchForHumanTakeover } from './human-takeover';

const program = new Command();
program
  .name('replay')
  .description('Run a capability artifact deterministically, with no model in the loop.')
  .requiredOption('--artifact <path>', 'path to an artifacts/<id>@<semver>.json file')
  .option('--input <key=value>', 'a capability input, repeatable', (v: string, prev: string[]) => [...prev, v], [] as string[])
  .option('--headless', 'run Chromium headless instead of headed', false)
  .option('--escalation-timeout-ms <n>', 'how long to wait for a human before an escalated step times out', (v) => Number(v))
  .option('--allow-draft', 'run a capability whose approval.state is not "approved" (refused by default)', false)
  .parse(process.argv);

const opts = program.opts<{
  artifact: string;
  input: string[];
  headless: boolean;
  escalationTimeoutMs?: number;
  allowDraft: boolean;
}>();

function parseInputs(pairs: string[]): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new Error(`--input must be key=value, got "${pair}"`);
    inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return inputs;
}

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(opts.artifact, 'utf-8'));
  const validated = validateArtifact(raw);
  if (!validated.ok) {
    console.error(`artifact failed validation: ${validated.reason}`);
    process.exitCode = 1;
    return;
  }
  const artifact = validated.artifact;

  const surface = await createPlaywrightWebSurface({ runId: 'replay-cli', policy: artifact.policy, headless: opts.headless });
  const lease = new RunLease();
  const runId = generateRunId(artifact.capability.id);

  console.log(`run: ${runId}`);
  console.log(`capability: ${artifact.capability.id}@${artifact.capability.semver} (${artifact.approval.state})`);
  console.log(`declared outputs: ${artifact.outputs.length ? artifact.outputs.map((o) => o.name).join(', ') : 'none'}`);

  let running = true;
  const takeoverWatcher = watchForHumanTakeover(lease, () => running);

  try {
    const result = await replay(artifact, parseInputs(opts.input), {
      surface,
      runId,
      lease,
      operatorChannel: new ConsoleOperatorChannel(),
      escalationTimeoutMs: opts.escalationTimeoutMs,
      allowDraft: opts.allowDraft,
    });

    console.log(`\nstatus: ${result.status}`);
    if (result.outputs) console.log(`outputs: ${JSON.stringify(result.outputs)}`);
    if (result.outcome) console.log(`outcome: ${result.outcome.code} -- ${result.outcome.message}`);
    if (result.failure) console.log(`failure: ${result.failure.kind} -- ${result.failure.observed}`);
    console.log(`evidence: evidence/${runId}/`);

    process.exitCode = result.status === 'success' ? 0 : 1;
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
