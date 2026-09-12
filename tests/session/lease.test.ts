import { describe, expect, it } from 'vitest';
import { RunLease } from '../../src/session/lease';

function request(overrides: Partial<Parameters<RunLease['requestHandoff']>[0]> = {}) {
  return {
    runId: 'r1',
    capability: 'test-cap',
    stepId: 'step-1',
    intent: 'do a thing',
    reason: 'stuck',
    raisedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('RunLease', () => {
  it('starts in AUTOMATION', () => {
    expect(new RunLease().state).toBe('AUTOMATION');
  });

  it('walks the full handoff cycle: AUTOMATION -> PAUSED_PENDING_HUMAN -> HUMAN_CONTROL -> RESUMING -> AUTOMATION', async () => {
    const lease = new RunLease();
    const wait = lease.requestHandoff(request(), 5000);
    expect(lease.state).toBe('PAUSED_PENDING_HUMAN');
    expect(lease.getIntervention()?.stepId).toBe('step-1');

    lease.takeControl();
    expect(lease.state).toBe('HUMAN_CONTROL');

    lease.releaseControl();
    expect(lease.state).toBe('RESUMING');

    const outcome = await wait;
    expect(outcome).toBe('resumed');

    lease.confirmResumed();
    expect(lease.state).toBe('AUTOMATION');
  });

  it('rejects an out-of-order transition', () => {
    const lease = new RunLease();
    expect(() => lease.takeControl()).toThrow(); // no pending handoff yet
    expect(() => lease.releaseControl()).toThrow(); // not in HUMAN_CONTROL
    expect(() => lease.confirmResumed()).toThrow(); // not in RESUMING
  });

  it('cannot request a second handoff while one is already pending', () => {
    const lease = new RunLease();
    void lease.requestHandoff(request(), 5000);
    expect(() => lease.requestHandoff(request(), 5000)).toThrow();
  });

  it('times out and moves to ABORTED when nobody responds', async () => {
    const lease = new RunLease();
    const outcome = await lease.requestHandoff(request(), 30);
    expect(outcome).toBe('timeout');
    expect(lease.state).toBe('ABORTED');
  });

  it('does not fire the timeout after a human has already resumed', async () => {
    const lease = new RunLease();
    const wait = lease.requestHandoff(request(), 50);
    lease.takeControl();
    lease.releaseControl();
    const outcome = await wait;
    expect(outcome).toBe('resumed');
    await new Promise((r) => setTimeout(r, 80)); // past the original timeout window
    expect(lease.state).toBe('RESUMING'); // still RESUMING, not ABORTED -- the timer was cleared
  });

  it('abort() resolves a pending handoff instead of leaving it hanging', async () => {
    const lease = new RunLease();
    const wait = lease.requestHandoff(request(), 5000);
    lease.abort();
    expect(await wait).toBe('timeout');
    expect(lease.state).toBe('ABORTED');
  });
});
