/**
 * Synthetic data only. No real PII, no real credentials, ever. This fixture is a
 * stand-in for a vendor product -- it does not know src/ exists (dependency-cruiser
 * enforces that both ways).
 */
export interface Member {
  id: string;
  name: string;
  savings: number;
  checking: number;
}

export const MEMBERS: Record<string, Member> = {
  '41382': { id: '41382', name: 'Alice Johnson', savings: 1204.5, checking: 340.1 },
  '77410': { id: '77410', name: 'Brian Kim', savings: 58900.0, checking: 2100.75 },
  '20957': { id: '20957', name: 'Carla Nguyen', savings: 0, checking: 75.2 },
};

/** Fixture's own login gate. Synthetic, hardcoded, never a real secret. */
export const OPERATOR_CREDENTIALS = {
  username: 'svc.operator',
  password: 'fixture-only-not-a-real-secret',
};
