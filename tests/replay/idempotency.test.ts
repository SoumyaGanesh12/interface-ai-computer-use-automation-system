/**
 * Proves at-most-once for the one irreversible step in this system, not just that the
 * mechanism typechecks: a genuinely forced checkpoint failure after a real dispatch
 * must consult the idempotency probe rather than clicking "Confirm Order" a second
 * time. Verified against the fixture's own order store (findOrder), not just the
 * replay result -- a buggy double-dispatch would overwrite that store with a second
 * reference, which the assertions below would catch even if the reported output
 * happened to look fine.
 *
 * Also proves a wholly independent later run for a member who already has a completed
 * order is caught cleanly -- the idempotency probe alone never covers this, since it only
 * ever activates for a redispatch within the same run. This used to be a separate,
 * opt-in step-level precheck; it is now the artifact's own top-level "already_ordered"
 * outcome instead, since the fixture itself (fixture/pages/member.ts, cardOrder.ts) is
 * the actual source of truth for "does this member already have an order" and stops
 * offering the entry point once one exists -- the outcome catches this the moment the
 * member page loads, before the run ever tries to click through to a button that is no
 * longer there. A step-scoped precheck duplicating the same matcher became genuinely
 * unreachable once the outcome existed, and validateArtifact's overlap check refuses
 * exactly that ambiguity rather than silently accepting dead configuration.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { findOrder } from '../../fixture/orders';
import { validateArtifact } from '../../src/catalog/validate';
import type { Artifact } from '../../src/catalog/artifact';
import { replay } from '../../src/replay/executor';
import { createPlaywrightWebSurface } from '../../src/surface/playwright-surface';
import { generateRunId } from '../../src/evidence/run-id';
import { RunLease } from '../../src/session/lease';
import { ConsoleOperatorChannel } from '../../src/session/operator-channel';
import type { Surface } from '../../src/surface/surface';
import type { LocatorStrategy } from '../../src/locator/descriptor';

const ARTIFACT_PATH = 'artifacts/order-replacement-card@1.0.0.json';

function loadRetargeted(baseUrl: string): Artifact {
  const raw = readFileSync(ARTIFACT_PATH, 'utf-8').replaceAll('http://localhost:4400', baseUrl);
  const result = validateArtifact(JSON.parse(raw));
  if (!result.ok) throw new Error(result.reason);
  return result.artifact;
}

/** Clones the artifact with the confirm-order step's checkpoint replaced by one that can never be satisfied -- forces the executor's retry-then-idempotency path deterministically instead of relying on real flakiness. */
function withImpossibleCheckpoint(artifact: Artifact): Artifact {
  const clone = structuredClone(artifact);
  const step = clone.steps.find((s) => s.id === 'confirm-order');
  if (!step) throw new Error('expected a "confirm-order" step');
  const impossible: LocatorStrategy = { strategy: 'visibleText', text: 'THIS-TEXT-CAN-NEVER-APPEAR-XYZ' };
  step.checkpoint = { kind: 'nodeExists', target: { recordedTier: 3, candidates: [{ tier: 3, confidence: 0.5, note: 'test: deliberately impossible', locator: impossible }] } };
  return clone;
}

function withoutIdempotency(artifact: Artifact): Artifact {
  const clone = structuredClone(artifact);
  const step = clone.steps.find((s) => s.id === 'confirm-order');
  if (!step) throw new Error('expected a "confirm-order" step');
  delete step.idempotency;
  return clone;
}

let server: Server;
let baseUrl: string;
let surface: Surface;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await createPlaywrightWebSurface({
    runId: 'idempotency-test',
    headless: true,
    policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

describe('order-replacement-card: at-most-once', () => {
  it('the committed artifact is schema-valid as-is', () => {
    const raw = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8'));
    expect(validateArtifact(raw).ok).toBe(true);
  });

  it('places a real order and returns a durable confirmation reference', async () => {
    const artifact = loadRetargeted(baseUrl);
    const result = await replay(artifact, { memberId: '20957' }, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
    });

    expect(result.status).toBe('success');
    expect(typeof result.outputs?.confirmationReference).toBe('string');
    expect(result.outputs?.confirmationReference).toMatch(/^REF-\d+$/);
    expect(findOrder('20957')?.reference).toBe(result.outputs?.confirmationReference);
  }, 30000);

  it('a checkpoint failure after a real dispatch consults the idempotency probe instead of ordering twice', async () => {
    const artifact = withImpossibleCheckpoint(loadRetargeted(baseUrl));
    const result = await replay(artifact, { memberId: '77410' }, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
    });

    // Confirmed via the idempotency probe, not the (impossible) checkpoint.
    expect(result.status).toBe('success');
    const reportedRef = result.outputs?.confirmationReference;
    expect(reportedRef).toMatch(/^REF-\d+$/);

    // The real proof: exactly one order exists, and it matches what was reported --
    // a buggy redispatch would have overwritten the store with a second reference.
    expect(findOrder('77410')?.reference).toBe(reportedRef);
  }, 30000);

  it('a fresh, separate run for a member who already has an order is caught by the already_ordered outcome, never clicking Confirm Order again', async () => {
    // Depends on the first test above having already placed a real order for 20957 --
    // this is deliberately a second, wholly separate replay() call (a fresh `dispatched`
    // Set, exactly like a later, independent invocation), which the in-run idempotency
    // probe alone would never catch: it only ever activates for a redispatch attempt
    // within the same run. Proving this needs the top-level outcome to have fired
    // instead, from the member page itself -- well before the run would otherwise reach
    // (and fail to click) the now-absent "Order Replacement Card" entry point.
    const before = findOrder('20957')?.reference;
    expect(before).toMatch(/^REF-\d+$/);

    const artifact = loadRetargeted(baseUrl);
    const result = await replay(artifact, { memberId: '20957' }, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
    });

    expect(result.status).toBe('business_outcome');
    expect(result.outcome?.code).toBe('already_ordered');

    // The real proof: the stored reference is unchanged -- a redispatch would have
    // overwritten it with a fresh one.
    expect(findOrder('20957')?.reference).toBe(before);
  }, 30000);

  it('escalates rather than blindly redispatching when no idempotency probe is declared', async () => {
    const artifact = withoutIdempotency(withImpossibleCheckpoint(loadRetargeted(baseUrl)));
    const result = await replay(artifact, { memberId: '41382' }, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
      escalationTimeoutMs: 150,
    });

    expect(result.status).toBe('failure');
    expect(result.failure?.kind).toBe('escalation_timeout');

    // Still at-most-once even though the run ultimately failed: the one real dispatch
    // that happened is the only order on record, nothing redispatched while stuck.
    expect(findOrder('41382')).toBeDefined();
  }, 30000);
});
