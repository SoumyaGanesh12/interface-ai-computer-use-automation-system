import { describe, expect, it } from 'vitest';
import { LocatorCandidateSchema, LocatorDescriptorSchema } from '../../src/locator/descriptor';

describe('LocatorCandidateSchema', () => {
  it('accepts a tier that matches its strategy', () => {
    const result = LocatorCandidateSchema.safeParse({
      tier: 1,
      confidence: 0.95,
      note: 'stable accessible name on a named button',
      locator: { strategy: 'roleAndName', role: 'button', name: 'Search' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a tier that does not match its strategy', () => {
    const result = LocatorCandidateSchema.safeParse({
      tier: 1,
      confidence: 0.5,
      note: 'coordinates dressed up as tier 1',
      locator: { strategy: 'anchoredCoordinates', anchorName: 'Search', dx: 40, dy: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty robustness note', () => {
    const result = LocatorCandidateSchema.safeParse({
      tier: 1,
      confidence: 0.95,
      note: '',
      locator: { strategy: 'roleAndName', role: 'button', name: 'Search' },
    });
    expect(result.success).toBe(false);
  });
});

describe('LocatorDescriptorSchema', () => {
  it('requires at least one candidate', () => {
    const result = LocatorDescriptorSchema.safeParse({ candidates: [], recordedTier: 1 });
    expect(result.success).toBe(false);
  });
});
