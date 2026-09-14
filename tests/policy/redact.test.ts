import { describe, expect, it } from 'vitest';
import { redactInputs, redactOutputs } from '../../src/policy/redact';

describe('redactInputs', () => {
  it('replaces only fields declared redact: true', () => {
    const result = redactInputs(
      { memberId: '41382', ssn: '123-45-6789' },
      [
        { name: 'memberId', redact: false },
        { name: 'ssn', redact: true },
      ],
    );
    expect(result.memberId).toBe('41382');
    expect(result.ssn).toBe('[redacted]');
  });

  it('leaves an undeclared field untouched', () => {
    const result = redactInputs({ memberId: '41382' }, []);
    expect(result.memberId).toBe('41382');
  });
});

describe('redactOutputs', () => {
  it('replaces only fields declared redact: true, regardless of value type', () => {
    const result = redactOutputs(
      { savingsBalance: 1204.5, confirmationReference: 'REF-1001' },
      [
        { name: 'savingsBalance', redact: true },
        { name: 'confirmationReference', redact: false },
      ],
    );
    expect(result.savingsBalance).toBe('[redacted]');
    expect(result.confirmationReference).toBe('REF-1001');
  });

  it('leaves an undeclared field untouched', () => {
    const result = redactOutputs({ savingsBalance: 1204.5 }, []);
    expect(result.savingsBalance).toBe(1204.5);
  });
});
