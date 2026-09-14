import { describe, expect, it } from 'vitest';
import { loadDeploymentAllowlist } from '../../src/policy/deployment-config';

describe('loadDeploymentAllowlist', () => {
  it('loads the committed deployment config as a valid allowlist', () => {
    const allowlist = loadDeploymentAllowlist('config/allowlist.json');
    expect(allowlist.allowedOrigins).toContain('http://localhost:4400');
    expect(allowlist.allowedActions.length).toBeGreaterThan(0);
  });

  it('throws rather than silently allowing everything when the file is missing', () => {
    expect(() => loadDeploymentAllowlist('config/does-not-exist.json')).toThrow();
  });
});
