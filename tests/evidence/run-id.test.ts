import { describe, expect, it } from 'vitest';
import { generateRunId } from '../../src/evidence/run-id';

describe('generateRunId', () => {
  it('is unique across many back-to-back calls for the same capability -- Date.now() alone is not', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(generateRunId('same-capability'));
    expect(ids.size).toBe(1000);
  });

  it('still starts with the capability id, for a readable directory listing', () => {
    expect(generateRunId('member-savings-balance')).toMatch(/^member-savings-balance-/);
  });
});
