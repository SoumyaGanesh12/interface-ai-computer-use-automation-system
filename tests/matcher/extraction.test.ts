import { describe, expect, it } from 'vitest';
import { extract, ExtractionSchema } from '../../src/matcher/extraction';
import type { LocatorDescriptor } from '../../src/locator/descriptor';
import type { Observation, ObservedNode } from '../../src/surface/observation';

function node(overrides: Partial<ObservedNode> = {}): ObservedNode {
  return { nodeId: 'n', role: 'text', name: '', enabled: true, visible: true, framePath: [], ...overrides };
}

function obs(nodes: ObservedNode[]): Observation {
  return { runId: 'r1', seq: 0, url: 'http://x', title: '', nodes, hash: 'h', capturedAt: '2026-01-01T00:00:00Z' };
}

function target(name: string): LocatorDescriptor {
  return { candidates: [{ tier: 1, confidence: 0.9, note: 'test target', locator: { strategy: 'roleAndName', role: 'text', name } }], recordedTier: 1 };
}

describe('ExtractionSchema', () => {
  it('requires a pattern when transform is regexCapture', () => {
    const result = ExtractionSchema.safeParse({ target: target('x'), source: 'text', transform: 'regexCapture' });
    expect(result.success).toBe(false);
  });

  it('allows a missing pattern for every other transform', () => {
    const result = ExtractionSchema.safeParse({ target: target('x'), source: 'text', transform: 'trim' });
    expect(result.success).toBe(true);
  });
});

describe('extract', () => {
  it('trim', () => {
    const o = obs([node({ name: '  hello  ' })]);
    expect(extract({ target: target('hello'), source: 'text', transform: 'trim' }, o)).toEqual({ ok: true, value: 'hello' });
  });

  it('currency strips symbol and thousands separators', () => {
    const o = obs([node({ role: 'text', name: 'Balance', value: '$1,204.50' })]);
    const result = extract({ target: target('Balance'), source: 'value', transform: 'currency' }, o);
    expect(result).toEqual({ ok: true, value: 1204.5 });
  });

  it('integer strips non-digits', () => {
    const o = obs([node({ name: 'Count: 1,024' })]);
    expect(extract({ target: target('Count: 1,024'), source: 'text', transform: 'integer' }, o)).toEqual({ ok: true, value: 1024 });
  });

  it('integer fails closed on garbage rather than returning NaN', () => {
    const o = obs([node({ name: 'n/a' })]);
    const result = extract({ target: target('n/a'), source: 'text', transform: 'integer' }, o);
    expect(result.ok).toBe(false);
  });

  it('date normalizes to an ISO date', () => {
    const o = obs([node({ name: 'January 5, 2026' })]);
    const result = extract({ target: target('January 5, 2026'), source: 'text', transform: 'date' }, o);
    expect(result).toEqual({ ok: true, value: '2026-01-05' });
  });

  it('date fails closed on an unparseable string', () => {
    const o = obs([node({ name: 'not-a-date' })]);
    expect(extract({ target: target('not-a-date'), source: 'text', transform: 'date' }, o).ok).toBe(false);
  });

  it('regexCapture returns the first capture group', () => {
    const o = obs([node({ name: 'Confirmation #REF-88213' })]);
    const result = extract(
      { target: target('Confirmation #REF-88213'), source: 'text', transform: 'regexCapture', pattern: 'REF-(\\d+)' },
      o,
    );
    expect(result).toEqual({ ok: true, value: '88213' });
  });

  it('regexCapture with no group returns the whole match', () => {
    const o = obs([node({ name: 'REF-88213' })]);
    const result = extract({ target: target('REF-88213'), source: 'text', transform: 'regexCapture', pattern: 'REF-\\d+' }, o);
    expect(result).toEqual({ ok: true, value: 'REF-88213' });
  });

  it('regexCapture fails closed, never throws, on a non-matching pattern', () => {
    const o = obs([node({ name: 'nothing here' })]);
    expect(() =>
      extract({ target: target('nothing here'), source: 'text', transform: 'regexCapture', pattern: 'REF-(\\d+)' }, o),
    ).not.toThrow();
    expect(extract({ target: target('nothing here'), source: 'text', transform: 'regexCapture', pattern: 'REF-(\\d+)' }, o).ok).toBe(false);
  });

  it('fails when the target does not resolve, rather than extracting a null', () => {
    const o = obs([node({ name: 'Other' })]);
    const result = extract({ target: target('Missing'), source: 'text', transform: 'trim' }, o);
    expect(result.ok).toBe(false);
  });
});
