# Computer-Use Automation System

An LLM discovers how to complete a task in a UI that has no API. The successful run
compiles into a typed, versioned capability. The capability then replays
deterministically, with no model in the decision loop.

## Setup

```bash
npm install
```

No API key or external service is needed for anything in this repo yet.

## Verify

```bash
npm run check
```

Runs the TypeScript compiler, the `dependency-cruiser` architectural boundary rules --
for example, the replay engine can never import a model client, and Playwright stays
confined to the surface layer so a desktop adapter can drop in later without touching
anything above it -- and the test suite.

## Layout

- `src/surface/observation.ts` -- the normalized perception format that discovery and
  replay both consume.
- `src/surface/hash.ts` -- the observation fingerprint used for no-progress detection
  during discovery.
- `src/surface/action.ts` -- the one action union shared by discovery and replay.
- `src/surface/surface.ts` -- the `Surface` interface: the seam between perceiving/acting
  on a UI and everything above it.
- `src/locator/descriptor.ts` -- the five-tier locator ladder, with the tier a candidate
  claims validated against the strategy it actually uses.
- `src/locator/strategies/` -- one file per tier's matching logic (role+name, label
  proximity, visible text, structural path, anchored coordinates).
- `src/locator/resolve.ts` -- tries a descriptor's candidates in order against an
  observation; a unique match that's disabled or hidden stops immediately rather than
  falling through to a weaker, possibly-wrong tier.
- `src/matcher/types.ts` -- the `Matcher` predicate type (booleans only) shared by
  checkpoints, outcome detection, recovery detection, and step waits.
- `src/matcher/evaluate.ts` -- the one evaluator. Never throws; an invalid regex in an
  artifact fails the match instead of crashing the run. Ambiguous resolver results never
  count as "exists" or "absent" -- a presence check can't smuggle in the coin flip the
  resolver already refuses to make.
- `src/matcher/extraction.ts` -- the value-producing counterpart to `Matcher`, plus the
  closed, reviewable transform registry (`trim`, `currency`, `integer`, `date`,
  `regexCapture`). An unresolved target or a failed transform is always a distinct
  failure, never a silently corrupted success.
- `.dependency-cruiser.cjs` -- the boundary rules, wired before any code they govern.

The artifact schema and deterministic replay are built and proven out before the
LLM-driven agent, so the schema is designed on its own merits rather than shaped around
whatever the model happens to emit.
