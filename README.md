# Computer-Use Automation System

An LLM discovers how to complete a task in a UI that has no API. The successful run
compiles into a typed, versioned capability. The capability then replays
deterministically, with no model in the decision loop.

## Setup

```bash
npm install
```

No API key or external service is needed except for a real discovery run (below);
everything else runs entirely against the local fixture.

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

## Try a real replay

`tests/replay/executor.test.ts` runs the actual committed artifact --
`artifacts/member-savings-balance@1.0.0.json` -- against a real browser driving the real
fixture, with no model anywhere in the loop:

```bash
npx vitest run tests/replay/executor.test.ts
```

It replays the same capability twice: once for a real member (extracts the real
balance), once for an unknown one -- which comes back as a clean `business_outcome`,
not a crash. Conflating the two is an easy way to get this kind of system wrong.

`tests/replay/idempotency.test.ts` does the same against
`artifacts/order-replacement-card@1.0.0.json` -- the one irreversible action in this
system -- and proves at-most-once concretely: a forced checkpoint failure right after a
real dispatch consults the idempotency probe instead of clicking "Confirm Order" again,
verified against the fixture's own order store, not just the reported result.

`tests/replay/escalation.test.ts` proves the human-takeover mechanism the same way: a
real `replay()` call pausing mid-flight, a simulated operator resuming it, a timeout
when nobody responds, and re-escalation up to the per-run cap when a resume turns out
not to have fixed anything.

## Try a real discovery run

```bash
cp .env.example .env   # fill in GEMINI_API_KEY
npm run fixture        # in one terminal
npx tsx --env-file=.env src/cli/discover.ts --goal "Find member 41382 and report their savings balance." --headless
```

(`npx tsx` directly, not `npm run discover --`, since npm's own argument parsing on some
platforms swallows a `--flag value` passed after `--` before the script ever sees it.)

This wires a real Gemini-backed model client and a real headed Chromium `Surface` into
the observe-decide-act loop (`src/agent/discover.ts`): the model sees only the structured
accessibility-tree observation, picks a target by node id, and the loop builds and
self-verifies the actual locator (`src/locator/generate.ts`) rather than trusting
whatever the model invents. A fixed login preflight runs before the model ever sees a
page. Every step prints live as it happens (`[3] preflight: enter the operator username
-> ok`) rather than leaving the terminal silent until the run ends. Every run writes a
`traces/<runId>.json` step-by-step record and real evidence under `evidence/<runId>/`,
the same evidence writer replay uses.

A click classified as possibly irreversible (`src/policy/risk.ts` -- a stated,
deliberately coarse keyword heuristic, not semantic understanding) escalates through the
identical `RunLease`/`OperatorChannel` path a stuck replay uses, rather than dispatching
automatically:

```bash
npx tsx --env-file=.env src/cli/discover.ts --goal "Order a replacement card for member 41382." --escalation-timeout-ms 60000
```

Drop `--headless` here to actually act as the human yourself: the CLI's own
`watchForHumanTakeover` prompts on stdin once escalation pauses the run, and pressing
Enter after completing the action in the still-open browser window calls the same
`RunLease.takeControl()`/`releaseControl()` a remote operator console would. With nobody
responding inside the window instead, the run genuinely times out (`escalation_timeout`)
rather than placing the order.

What a human sees at that pause is not just a generic label: the intervention carries
the model's own stated rationale, plus an independent scan of the current page for
"already ordered"-style text (`detectExistingOutcomeWarning` in `src/policy/risk.ts`) --
so a duplicate-looking situation is flagged directly in the escalation, not left for a
human to notice on their own or dig out of a trace file afterward.

A successful run can also compile itself into a draft artifact immediately, in the same
terminal, rather than requiring a separate command and a manually copied trace path
afterward:

```bash
npx tsx --env-file=.env src/cli/discover.ts --goal "Find member 41382 and report their savings balance." --headless --record --capability-id my-balance-lookup --capability-name "My Balance Lookup"
```

On success this writes `artifacts/my-balance-lookup@1.0.0.json` directly; on anything
else, it says so and skips recording rather than compiling a run that never finished.

## Try the recorder

`tests/recorder/compile.test.ts` compiles the two committed discovery traces above into
draft artifacts, for real:

```bash
npx vitest run tests/recorder/compile.test.ts
```

A trace only records each step's *pre-action* observation -- what the model was shown
before deciding -- never a checkpoint, since there was nothing to check yet. So
`compileArtifact` (`src/recorder/compile.ts`) re-runs the trace's already-decided
actions against a real browser one more time, and derives each step's checkpoint from
what that real run actually produces (an enforced dependency-cruiser rule keeps this
pass from ever reaching a model client -- every action was already decided when the
trace was recorded, so there is nothing left to decide). The resulting artifact starts
`approval.state: 'draft'`; nothing promotes it to `approved` automatically, and that
state is enforced, not just informational -- `replay()` refuses a non-`'approved'`
artifact before dispatching anything at all, unless the caller explicitly passes
`allowDraft: true` (`--allow-draft` on the CLI). See `tests/replay/approval.test.ts` for
proof: the refusal happens before even the first step resolves, and the identical draft
artifact succeeds once that opt-in is given.

A literal typed value becomes a reusable `{{param}}` input (`ParamRegistry` in
`src/recorder/compile.ts`) when it verbatim-matches a whole word in the discovery goal --
typing "41382" for a goal that names member 41382 becomes `{{memberId}}`, so the same
compiled capability answers this for *any* member, not only the one it happened to be
shown (a fixed constant like the login username, which never appears in the goal, stays
literal). The same value reused across steps shares one declared input; two different
values that would derive the same parameter name fail the compile with a clear reason
rather than guessing which is which.

A declared output value is searched for on the run's own final page and turned into a
real, self-verifying extraction the same way -- `"$1204.50"` becomes a `currency`-typed
output read from the member's Savings cell, so replaying for a different member returns
*that* member's real balance, not an empty result you have to interpret yourself. Exactly
one matching node is required: none, or more than one, fails the compile rather than
guessing which one was meant (the same discipline `ParamRegistry` and the locator ladder
already apply). This only happens when the run ended safely -- an escalate-terminated
run never dispatches its last step, so there's no live final page to search, and
`outputs` stays empty for that one.

`discover --record` is the common path (pass `--overwrite` to replace an existing
artifact at the same path instead of being refused); `record` also exists standalone,
for compiling an existing trace from an earlier run (one you already have on disk, or
one someone else produced) without repeating discovery:

```bash
npm run fixture   # in one terminal

npm run record -- \
  --trace traces/discovery-1789247660348.json \
  --capability-id my-balance-lookup \
  --name "My Balance Lookup" \
  --description "Compiled from a discovery trace."

npm run replay -- --artifact "artifacts/my-balance-lookup@1.0.0.json" --input memberId=77410 --allow-draft
```

`--allow-draft` is required here because `record` always writes `approval.state: 'draft'`
-- replay refuses a non-approved artifact by default (see "Approval gating" below), so a
freshly compiled capability needs this explicit opt-in until a human promotes it. That
last command replays a capability compiled against member 41382 while asking about a
completely different member (77410) -- and reports that member's real balance
(`{"savingsBalance": 58900}`), proving both the `{{memberId}}` substitution and the
output extraction are real, not just a cosmetic difference in the JSON.

(Use `npx tsx --env-file=.env src/cli/record.ts ...` / `.../replay.ts ...` directly
instead of `npm run record --`/`npm run replay --` if your platform's npm swallows a
`--flag value` passed after `--`, the same issue noted for `discover` above.) `replay`
never loads a model client at all -- disconnect from the network entirely and it still
runs the same way, since every locator and checkpoint is already sitting in the artifact
file `record` wrote.

An irreversible step is never re-dispatched just to compile it -- that would make
compiling a capability a second, unwanted execution of its own irreversible effect.
Reaching one converts it into a `kind: 'escalate'` step and stops compiling there,
proven against the fixture's own order store: compiling the order-replacement trace
never places a real order. The test also proves the other half -- once a real human
performs the real action later, during an actual `replay()` of the compiled artifact,
that escalate step's checkpoint verifies correctly and the run completes.

Output extraction applies the same discipline: a declared output value is searched for
on the run's own final page, and exactly one matching node becomes a real, self-
verifying extraction -- zero matches or more than one fails the compile instead of
guessing. Only possible when the run ended safely; an escalate-terminated run has no
live final page to search, so `outputs` stays empty for that one.

## Approval gating

A compiled capability starts `approval.state: 'draft'`, and that is enforced, not just
displayed: `replay()` (`src/replay/executor.ts`) checks it before anything else, and
refuses to dispatch a single step against a non-`'approved'` artifact unless the caller
explicitly passes `allowDraft: true` (`--allow-draft` on the `replay` CLI). This is what
"a human has to promote a capability before it runs unattended" actually means in code,
not just in the schema:

```bash
npx vitest run tests/replay/approval.test.ts
```

Proves both directions with the same artifact: the committed
`member-savings-balance@1.0.0.json` is already `'approved'` and needs no flag; cloning it
as a draft and replaying it is refused before even the first step resolves (`locatorTiers`
comes back empty -- nothing was dispatched), and the identical draft clone succeeds once
`allowDraft: true` is passed.

## Fault matrix

The fixture supports six injectable faults (`GET /_control/fault/:mode` --
`not_found`, `session_expired`, `permission`, `slow`, `dialog`, `server_error`), a
test-harness route no real capability is ever allowlisted to reach. Each one is proven
against a real `replay()` call, not just described:

```bash
npx vitest run tests/replay/fault-matrix.test.ts
```

- `not_found` / `permission` -- a declared `outcomes` entry reports a clean
  `business_outcome`, never a crash, for the fault-injected page directly (not just an
  incidentally similar "unknown ID" case).
- `slow` -- replay tolerates the fixture's own 3-second added delay without a false
  timeout; `status: 'success'` still, just slower.
- `server_error` -- a real 500 becomes a real `failure` (`checkpoint_failed`), never an
  uncaught exception.
- `dialog` -- the existing `dismiss_dialog`-style recovery genuinely clicks through the
  interstitial and the run completes, proven with `nodeAbsent` on the dismissed button
  (not a hand-wavy text check).
- `session_expired` -- a declared recovery re-authenticates through the identical
  embedded login form the fault page itself renders, then the interrupted step (a
  `navigate`, chosen deliberately -- it carries no in-page state to lose) redispatches
  by URL and succeeds once the fault clears. Recovery only ever retries the *current*
  step, not the whole sequence -- a fault landing on a step whose own effect isn't
  cleanly redispatchable (e.g. a `type` mid-form) is a real, stated limit of this
  mechanism, not one this test claims to cover.

## Agent-facing capability catalog

`src/registry/catalog.ts` is the surface an agent would actually call through: a
`CapabilitySummary` deliberately strips out steps, locators, policy, and provenance --
what a caller decides *whether and how to invoke* a capability with, not how it works
internally. An unreadable or malformed artifact file is skipped with a reason, not a
thrown exception that takes every other capability down with it.

```bash
npm run catalog -- describe
npm run catalog -- invoke --id member-savings-balance --input memberId=20957
```

`invoke` is a thin lookup in front of the same `replay()` everything else uses --
approval gating, policy enforcement, and escalation all apply exactly as they already do
elsewhere, not a second implementation of any of it.

## Cross-tenant reuse via override files

The fixture's tenant `b` relabels "Member ID" to "Account Number" -- enough of a real UI
difference that the tenant-`a` artifact's own locator genuinely doesn't resolve there.
`src/registry/override.ts` adapts a base artifact for a different tenant by replacing
only the steps that actually differ, rather than re-discovering the whole flow again: an
override provides a *complete* replacement `Step` per id (never a partial patch -- a
step's action, target, and checkpoint are one coherent unit, and merging them
independently risks a checkpoint that no longer matches what the patched action actually
produced), and the resulting artifact is re-validated through the same `validateArtifact`
every other artifact goes through.

```bash
npx vitest run tests/registry/override.test.ts
```

Proves both directions against the real fixture, not just the schema: the unmodified
base artifact genuinely fails against tenant `b` (at exactly `enter-member-id`, where
"Member ID" doesn't exist), proving the override is actually necessary rather than
cosmetic -- and `artifacts/member-savings-balance@1.0.0+b.json`, the committed override,
applied to that same base artifact, genuinely succeeds against tenant `b`, extracting the
identical real balance the base artifact reads for tenant `a`.

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
  above together. Headed by default: human takeover needs an operable window, not a
  screenshot of one.
- `src/surface/human-recorder.ts` -- attaches a click/input listener across every frame
  while a human has the session; records tag + a structural identifier only, never a
  typed value.
- `src/catalog/` -- the capability contract: `step.ts` (one step, shared by the main
  flow and a recovery sub-flow), `recovery.ts` (`runSteps` | `preflight`, every
  `runSteps` step forced `risk: 'safe'`), `artifact.ts` (the full schema), `validate.ts`
  (schema-version check, then shape, then matcher-overlap), `overlap.ts` (deliberately
  conservative -- structural equality or one pattern containing another, not a general
  overlap prover), `interpolate.ts` (`{{param}}` templates, scoped to action text/url/
  option and idempotency keys, never locator fields).
- `src/replay/executor.ts` -- runs an artifact with no model in the loop. Recovery is
  checked before outcomes at every re-entry; an irreversible step tracks whether it's
  already dispatched this run so a checkpoint failure never redispatches it; outcomes
  are checked once more after the last step, not just between steps, since a result
  like "not found" often only becomes visible after the final action. A stuck recovery,
  an ambiguous irreversible dispatch, or a recorded human-performed step all escalate
  to a lease rather than failing outright -- capped at 3 escalations per run, with a
  distinct failure kind from a single unanswered timeout. An irreversible step's
  idempotency probe navigates to `idempotency.navigateTo` first when declared, so it
  checks a known route rather than whatever page a failed checkpoint happened to leave
  the run on, and that dispatch is journaled with `durable: true` -- fsync before the
  click, not after -- so dispatch state remains determinable from disk if a crash
  happens in between. A step's separate, opt-in `precheck` is checked once, before the
  very first dispatch attempt of an irreversible step, never on retry -- distinct from
  the idempotency probe, which only ever covers this run's own crash/retry window.
  Absent by default: an approved capability still acts unattended unless the step's own
  author declared a precheck worth the cost for that specific action
  (`tests/replay/idempotency.test.ts` proves a wholly separate later run for an
  already-ordered member stops there, which the idempotency probe alone never catches).
  `approval.state` is checked first, before anything else: a non-`'approved'` artifact
  is refused outright unless the caller passes `allowDraft`
  (`tests/replay/approval.test.ts`).
- `src/session/lease.ts` -- who controls the live session: `AUTOMATION ->
  PAUSED_PENDING_HUMAN -> HUMAN_CONTROL -> RESUMING -> AUTOMATION` (or `-> ABORTED` on
  timeout). A real, tested state machine; a separate operator process sharing it across
  machines would need IPC, which is the documented mock here -- the transitions and the
  executor's blocking behavior around them are what's real.
- `src/session/operator-channel.ts` -- how an intervention reaches a human; one
  implementation (stdout) behind an interface a web console could implement identically.
- `src/policy/` -- `allowlist.ts` (checked inside `Surface.act` itself -- the single
  choke point, so any caller driving the surface gets the same guardrail),
  `credentials.ts` (`CredentialProvider`; a reference resolves to a secret only inside
  the surface, never elsewhere), `redact.ts` (the write boundary: an artifact's
  declared-sensitive inputs never reach a log verbatim).
- `src/evidence/` -- `writer.ts` (one event stream, two sinks: `/evidence/<runId>/` and
  `/audit/`, plus a separate `journal.jsonl` of dispatched/confirmed transitions --
  `durable: true` opens the file, writes, and fsyncs before returning, everything else
  is a buffered append -- and a refusal to reopen a runId that already has a finished
  run on disk), `run-id.ts` (`<capability>-<timestamp>`, not a literal string),
  `paths.ts` (the one place a run's evidence directory gets computed, so nothing else
  can compute a different one).
- `artifacts/member-savings-balance@1.0.0.json` -- a hand-written capability matching
  the task "look up a member and read their savings balance," proven against the real
  fixture end to end (`tests/replay/executor.test.ts`).
- `artifacts/order-replacement-card@1.0.0.json` -- the one irreversible capability:
  finds a member and orders a replacement card, returning a durable confirmation
  reference. Its idempotency probe checks the member page for an "already ordered"
  notice after navigating there directly, rather than assuming whatever page a failed
  checkpoint left the run on (`tests/replay/idempotency.test.ts`).
- `.dependency-cruiser.cjs` -- the boundary rules, wired before any code they govern.
- `src/model/client.ts` -- the `ModelClient` seam (one `complete(prompt)` method) and its
  two failure types, kept out of the concrete provider module so discovery never depends
  on a specific vendor's SDK.
- `src/model/openai-compatible-client.ts` -- the one implementation: any OpenAI-compatible
  chat-completions endpoint, constrained to JSON output. Classifying a 429 into rate-limit
  vs. quota-exhausted is a best-effort heuristic on the error body -- no rate-limit headers
  were returned when this endpoint was probed.
- `src/config/model.ts` -- model identity (base URL, model id, key) is required
  environment, with no default baked into `src/`, so swapping providers is a config edit.
- `src/locator/generate.ts` -- builds a `LocatorDescriptor` for a node the model picked by
  id, then resolves it against the same observation and rejects it if it doesn't resolve
  back to that exact node. Shared with a future recorder, not duplicated.
- `src/policy/risk.ts` -- classifies a click as safe or irreversible when nothing has
  already declared its risk (a live discovery decision never has; an artifact step
  always has). Also `detectExistingOutcomeWarning`, a generic scan of the current
  observation for "already ordered"-style text, folded into an escalation's context
  rather than left for a human to notice on their own.
- `src/agent/decision.ts` -- the schema for what the model returns each step: act (by
  node id, not a full locator), done (with outputs), or stuck (with a reason).
- `src/agent/prompt.ts` -- builds the prompt from the goal, compact action history, and
  the current observation only -- no stale observations for the model to read past.
- `src/agent/trace.ts` -- the step-by-step record a run leaves behind, decoupled from the
  raw prompt/response text, that `src/recorder/compile.ts` compiles into an artifact.
- `src/agent/discover.ts` -- the observe-decide-act loop. Preflight actions run before
  the model ever sees an observation. A click classified as possibly irreversible
  escalates through the same `RunLease`/`OperatorChannel` path replay's executor uses,
  never dispatches automatically. Bounded by step count, wall-clock time, token budget,
  consecutive-failure count, and escalations per run -- every stopping condition is a
  distinct, named status, not a single generic failure.
- `src/cli/discover.ts` -- the runnable entry point (`npx tsx --env-file=.env
  src/cli/discover.ts`): wires a real model client and a real headed `Surface` into the
  loop against the fixture, with a fixed login preflight specific to this app. `--record`
  compiles a successful run into a draft artifact immediately, reusing the same open
  `Surface` rather than requiring a separate command afterward.
- `src/cli/human-takeover.ts` -- the console's side of a real human takeover, shared by
  every CLI that can pause on a lease: once it reports `PAUSED_PENDING_HUMAN`, prompts on
  stdin and blocks until the operator presses Enter, then claims and releases the lease
  itself -- cancellably (an `AbortSignal`-based prompt), so a timeout elsewhere never
  leaves it hanging.
- `src/recorder/compile.ts` -- compiles a successful (`status: 'done'`) discovery trace
  into a draft artifact by re-running its already-decided actions once more, deriving
  each step's checkpoint from what that real run actually produces rather than trusting
  anything the trace itself recorded (it never recorded a checkpoint, only a pre-action
  observation). Never re-dispatches an irreversible step to compile it -- reaching one
  converts it to a `kind: 'escalate'` step and stops there. `ParamRegistry` turns a
  literal typed value into a reusable `{{param}}` input when it verbatim-matches a whole
  word in the discovery goal, reusing one input for a value repeated across steps and
  failing the compile outright if two different values would derive the same parameter
  name, rather than guessing. `inferOutput` finds a declared output value on the run's
  final page the same way -- one uniquely matching node becomes a self-verifying
  extraction (reusing `generateDescriptor`), with a transform picked from the value's own
  shape (`currency`, `integer`, an exact `trim`, or a genericized `regexCapture` when the
  value sits inside a larger string); no match or more than one fails the compile rather
  than guessing. Only possible when the run ended safely, since an escalate-terminated
  run never dispatches its own last step, leaving no live page to search.
- `src/cli/record.ts` / `src/cli/replay.ts` -- runnable entry points for the recorder and
  the replay executor: thin wrappers with no logic of their own beyond CLI parsing and
  writing the compiled file to disk. `replay` never loads a model client at all.
- `src/cli/report-compiled.ts` -- the console output shared by `record` and `discover
  --record` after a compile: every step's own intent (not just its kind), which inputs
  got declared, and an explicit `outputs: none declared` line rather than a bare empty
  result a reader has to interpret unassisted.
- `src/catalog/step.ts` -- also `precheck`: an explicit, opt-in field distinct from
  `idempotency`, checked once before the very first dispatch attempt of an irreversible
  step (never on retry). Absent by default -- an approved capability still acts
  unattended unless a step's own author declared one worth the cost.
- `src/registry/catalog.ts` -- `listCapabilities`/`findCapability`/`invokeCapability`: the
  agent-facing summary over the artifact schema, and a thin lookup in front of `replay()`
  that inherits every safety property it already has for free. A malformed artifact file
  is skipped with a reason, never a thrown exception.
- `src/registry/override.ts` -- adapts a base artifact for a different tenant variant by
  replacing whole steps by id (never a partial patch), then re-validates the result
  through the same pipeline every artifact goes through. Refuses an override that
  references a step id the base doesn't have, rather than silently ignoring it.
- `src/cli/catalog.ts` -- the runnable entry point (`npm run catalog -- describe` /
  `invoke --id ...`) for the catalog above.

The artifact schema and deterministic replay are built and proven out before the
LLM-driven agent, so the schema is designed on its own merits rather than shaped around
whatever the model happens to emit.
