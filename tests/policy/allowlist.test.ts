import { describe, expect, it } from 'vitest';
import { checkPolicy } from '../../src/policy/allowlist';
import type { Action } from '../../src/surface/action';

const target: Action = {
  kind: 'click',
  target: { candidates: [{ tier: 1, confidence: 0.9, note: 'x', locator: { strategy: 'roleAndName', role: 'button', name: 'X' } }], recordedTier: 1 },
};

describe('checkPolicy', () => {
  it('allows an action kind that is listed', () => {
    expect(checkPolicy(target, { allowedOrigins: [], allowedActions: ['click'] }).allowed).toBe(true);
  });

  it('denies an action kind that is not listed', () => {
    const result = checkPolicy(target, { allowedOrigins: [], allowedActions: ['read'] });
    expect(result.allowed).toBe(false);
  });

  it('checks navigate against allowedOrigins', () => {
    const nav: Action = { kind: 'navigate', url: 'http://evil.example/anything' };
    const allowed = checkPolicy(nav, { allowedOrigins: ['http://good.example'], allowedActions: ['navigate'] });
    expect(allowed.allowed).toBe(false);

    const ok = checkPolicy({ kind: 'navigate', url: 'http://good.example/page' }, { allowedOrigins: ['http://good.example'], allowedActions: ['navigate'] });
    expect(ok.allowed).toBe(true);
  });

  it('does not check origin for non-navigate actions', () => {
    // click has no URL at all -- only its kind matters here.
    expect(checkPolicy(target, { allowedOrigins: [], allowedActions: ['click'] }).allowed).toBe(true);
  });
});
