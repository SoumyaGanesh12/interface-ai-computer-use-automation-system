/** Architectural boundaries enforced by the build, not just by review. */
module.exports = {
  forbidden: [
    {
      name: 'replay-reaches-model',
      severity: 'error',
      comment: 'Invariant 1: replay must have no path to a model client, direct or transitive.',
      from: { path: '^src/replay' },
      to: { path: '^src/(agent|model)(/|$)', reachable: true },
    },
    {
      name: 'replay-imports-openai',
      severity: 'error',
      comment: 'Invariant 1, npm-package case (packages are not traversed by the rule above).',
      from: { path: '^src/replay' },
      to: { dependencyTypes: ['npm'], path: '^openai($|/)' },
    },
    {
      name: 'recorder-reaches-model',
      severity: 'error',
      comment: 'Compiling a trace re-runs its already-decided actions; it must never re-decide anything, so no path to a model client, direct or transitive (agent/trace.ts is fine -- it is a data shape with no model dependency of its own).',
      from: { path: '^src/recorder' },
      to: { path: '^src/model(/|$)', reachable: true },
    },
    {
      name: 'recorder-imports-openai',
      severity: 'error',
      comment: 'Same invariant, npm-package case.',
      from: { path: '^src/recorder' },
      to: { dependencyTypes: ['npm'], path: '^openai($|/)' },
    },
    {
      name: 'playwright-outside-surface',
      severity: 'error',
      comment: 'Invariant 3: Playwright/CDP stay inside src/surface, so a desktop adapter can drop in later.',
      from: { path: '^(src|fixture)', pathNot: '^src/surface(/|$)' },
      to: { dependencyTypes: ['npm'], path: '^(playwright|playwright-core)($|/)' },
    },
    {
      name: 'src-imports-fixture',
      severity: 'error',
      comment: 'Invariant 2: src/ must not know the fixture exists; app facts live in artifacts/config.',
      from: { path: '^src' },
      to: { path: '^fixture' },
    },
    {
      name: 'fixture-imports-src',
      severity: 'error',
      comment: 'Fixture stands in for a vendor app we do not own -- no shared types with the system driving it.',
      from: { path: '^fixture' },
      to: { path: '^src' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Cycles defeat the boundary rules above.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Unreachable module: dead code or a missing wire-up.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$'] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // import-type counts as a dependency: a Playwright type outside src/surface is the same leak as a value import.
    tsPreCompilationDeps: true,
  },
};
