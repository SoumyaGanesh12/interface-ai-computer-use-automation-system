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
anything above it -- and the test suite, which includes a real headless-Chromium
integration test against the fixture (it starts its own fixture instance on an ephemeral
port; no need to run `npm run fixture` separately first).

## Try the fixture app

```bash
npm run fixture
```

Starts a deliberately hostile legacy back-office console at `http://localhost:4400` --
server-rendered, a frameset, layout tables, `onclick` "buttons" with no semantic role,
fields identified only by an adjacent label cell, no test IDs. It's inconsistently bad on
purpose: a couple of fields are properly labeled, because real legacy apps are uneven.

Log in with `svc.operator` / `fixture-only-not-a-real-secret` (synthetic, hardcoded in
`fixture/data.ts` -- this app doesn't know the automation system exists, so it can't read
real credentials from it). Search for member `41382`, `77410`, or `20957`; any other ID
is a legitimate "not found." Ordering a replacement card is the one irreversible action
and returns a durable confirmation reference.

Runtime conditions are controlled per-session, not via query params on the real pages
(a real session timeout isn't a query parameter):

```
GET /_control/fault/:mode     none | not_found | session_expired | permission | slow | dialog | server_error
GET /_control/tenant/:variant a | b   -- b relabels "Member ID" to "Account Number" and adds a card-order confirmation step
GET /_control/reset
```

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
- `fixture/` -- the hostile console described above. `app.ts` holds the Express app;
  `server.ts` is the CLI entry point (`app.listen`), split apart so tests can run their
  own instance on an ephemeral port. Shares nothing with `src/` -- no imported types, no
  shared constants -- enforced in both directions by dependency-cruiser.
- `src/surface/roles.ts` -- Chrome's accessibility role strings (empirically inconsistent
  casing) mapped to our closed Role enum; anything unmapped becomes `'unknown'` rather
  than a guess.
- `src/surface/dom-lite.ts` -- one `DOM.getDocument({ pierce: true })` call turned into a
  parent/child tree keyed by `backendNodeId`, used to compute `textContext` (the label
  cell to the left, the row it's in) the way a hostile layout table actually requires --
  the accessibility tree alone has no semantics to expose for that.
- `src/surface/perceive.ts` -- builds an `Observation` from a live page: one CDP session,
  `Accessibility.getFullAXTree` scoped per frame via `frameId` (confirmed against the
  fixture's frameset before writing this -- a same-origin frame has no CDP session of its
  own). Also drops a `StaticText` node when an ancestor already carries the exact same
  name, since Chrome routinely represents a control's own name as a duplicate text
  descendant, which would otherwise make every text-based locator ambiguous against
  itself.
- `src/surface/element-handle.ts` -- bridges a `backendNodeId` to a live Playwright handle,
  needed only for `select` (a native dropdown can't be driven by coordinates alone).
- `src/surface/act.ts` -- dispatches one `Action`: resolves the target against a freshly
  taken observation, then clicks/types via a computed bounding-box center point and real
  mouse/keyboard events -- no DOM handle needed for click/type, which is also what a
  desktop adapter would have to assume.
- `src/surface/playwright-surface.ts` -- the one `Surface` implementation, wiring the
  above together. Headed by default (human takeover needs an operable window later).
- `.dependency-cruiser.cjs` -- the boundary rules, wired before any code they govern.

The artifact schema and deterministic replay are built and proven out before the
LLM-driven agent, so the schema is designed on its own merits rather than shaped around
whatever the model happens to emit.
