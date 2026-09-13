#!/usr/bin/env -S npx tsx
/**
 * Runnable entry point: the agent-facing catalog. `describe` lists what's callable and
 * with what inputs; `invoke` calls one by id. A thin wrapper -- all the actual logic
 * lives in src/registry/catalog.ts, which is what an agent would import directly rather
 * than shelling out to this.
 */
import { Command } from 'commander';
import { listCapabilities, invokeCapability } from '../registry/catalog';
import { createPlaywrightWebSurface } from '../surface/playwright-surface';
import { generateRunId } from '../evidence/run-id';
import { RunLease } from '../session/lease';
import { ConsoleOperatorChannel } from '../session/operator-channel';
import { watchForHumanTakeover } from './human-takeover';

const program = new Command();
program.name('catalog').description('List and invoke capabilities from artifacts/.');

program
  .command('describe')
  .description('List every valid capability found under artifacts/.')
  .option('--dir <path>', 'artifacts directory', 'artifacts')
  .action((opts: { dir: string }) => {
    const capabilities = listCapabilities(opts.dir);
    if (capabilities.length === 0) {
      console.log(`no capabilities found under ${opts.dir}`);
      return;
    }
    console.log(JSON.stringify(capabilities, null, 2));
  });

program
  .command('invoke')
  .description('Look up a capability by id and replay it.')
  .requiredOption('--id <id>', 'the capability id to invoke')
  .option('--input <key=value>', 'a capability input, repeatable', (v: string, prev: string[]) => [...prev, v], [] as string[])
  .option('--dir <path>', 'artifacts directory', 'artifacts')
  .option('--headless', 'run Chromium headless instead of headed', false)
  .option('--allow-draft', 'run a capability whose approval.state is not "approved" (refused by default)', false)
  .action(async (opts: { id: string; input: string[]; dir: string; headless: boolean; allowDraft: boolean }) => {
    const inputs: Record<string, string> = {};
    for (const pair of opts.input) {
      const eq = pair.indexOf('=');
      if (eq < 0) throw new Error(`--input must be key=value, got "${pair}"`);
      inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
    }

    const surface = await createPlaywrightWebSurface({
      runId: 'catalog-cli',
      // A permissive default: the actual gate is the artifact's own declared policy,
      // enforced inside Surface.act regardless of what's configured here.
      policy: { allowedOrigins: [], allowedActions: [] },
      headless: opts.headless,
    });
    const lease = new RunLease();
    const runId = generateRunId(opts.id);

    let running = true;
    const takeoverWatcher = watchForHumanTakeover(lease, () => running);

    try {
      const invoked = await invokeCapability(opts.id, inputs, {
        surface,
        runId,
        lease,
        operatorChannel: new ConsoleOperatorChannel(),
        allowDraft: opts.allowDraft,
      }, opts.dir);

      if (!invoked.ok) {
        console.error(invoked.reason);
        process.exitCode = 1;
        return;
      }

      const result = invoked.result;
      console.log(`run: ${runId}`);
      console.log(`status: ${result.status}`);
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
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
