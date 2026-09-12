import { describe, expect, it } from 'vitest';
import { redactInputs } from '../../src/policy/redact';

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
