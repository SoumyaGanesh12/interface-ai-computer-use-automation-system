# Report

## Architecture

```
goal (plain text)
        │
        ▼
┌────────────┐                ┌───────────┐                ┌────────────┐
│ agent/     │                │ recorder/ │                │ replay/    │
│ (LLM loop) │   - trace ->   │ (compile) │ - artifact ->  │ (executor) │
│            │                │           │                │ no model   │
└────────────┘                └───────────┘                └────────────┘
                                                                  │
                                                                  ▼
                                         success / business_outcome / failure
                                                    (or an escalation)

Both agent/ and replay/ drive the same surface/ (Playwright + CDP), the only place a real browser is touched.
```

**The flow.** An LLM decides actions against a live page from a plain-language goal (**discover**). A successful run compiles into a typed, versioned artifact (**compile**), which then executes with no model in the loop (**replay**), pausing for a human in-session when it genuinely can't proceed (**escalate**).
Compiling is offline and one-time; replay runs separately and repeatedly afterward.

**The core abstraction.** Discovery and replay never call each other, and both drive the identical `Surface`. Perception is a structured accessibility-tree observation, not a screenshot, so the *locator* carries "how to find this control" reasoning once, at record time, rather than a model re-deriving it every run. Every target resolves through a five-tier locator ladder (role+name, label proximity, visible text, structural path, anchored coordinates), tried in order, since the fixture mixes well-behaved controls with layout-table button-lookalikes on the same screen. Determinism itself is enforced structurally: `dependency-cruiser` fails the build if `replay/` or `recorder/`
ever import a model client, directly or transitively.

**Stack, target, and build order.** TypeScript (strict) and Zod give the
artifact schema one source of truth for types and validation. Playwright plus
CDP drives the browser; Vitest runs the full suite against a real headless
browser and fixture, never mocked. The target is a purpose-built fixture rather
than an existing site, so runtime conditions (a permission denial, a stale
duplicate order) could be injected and proven, not hoped for. The artifact
schema and replay engine were built and proven out *before* the LLM-driven
agent was wired in: the executor replayed a hand-written artifact correctly
before any discovery code existed. The model is Gemini, behind a one-method
`ModelClient` seam using constrained JSON validated through the same Zod
schema, not a vendor-specific tool-calling envelope, so swapping providers is a
config change and one new file.

## Artifact schema

An artifact declares:

- `artifactSchemaVersion`: the on-disk format version, separate from the
  capability's own version below
- `capability`: id, name, semver, description
- `surface`: target app, app version, tenant variant
- `requires`: preconditions, e.g. whether authentication is needed
- `approval`: draft or approved state, plus a verified-run count
- `inputs` / `outputs`: typed values, each independently `redact`-able
- `steps`: ordered actions, each with a locator, a checkpoint, and a risk
  classification
- `outcomes`: named business results, detected with a `Matcher`
- `recovery`: declared sub-flows for known recoverable conditions
- `policy`: the artifact's own allowlist
- `provenance`: which model, when, and whether a human assisted (no raw transcript ever crosses into the artifact)

**A checkpoint, an outcome, and an extraction are deliberately different types.** `Matcher` is one predicate shared by checkpoints, outcomes, recovery
detection, and step waits: it only answers true or false. `Extraction` is
separate, used only for `outputs`, since a predicate can't produce a value.
This keeps a checkpoint from smuggling out an undeclared value, and a value
read from ever doubling as a truthiness check.

**Two schema-enforced invariants keep an artifact from being ambiguous.**
Every locator candidate must state *why* it's expected to be stable, and every
step must declare a checkpoint. A malformed or ambiguous artifact fails
validation outright; the most notable real case was a declared outcome whose
detector overlapped with a step's own `precheck` (see Determinism).
`artifactSchemaVersion` is checked first, separately from `capability.semver`,
and an unsupported version is rejected outright with no attempt to migrate.

**`recovery` has two kinds of sub-flow, one not yet functional.** `runSteps`
inlines its own steps, each forced `risk: 'safe'`, so an automatic retry can
never fire an irreversible action. `preflight` is meant to run a shared,
app-level login flow so a session-expiry recovery doesn't duplicate one, but
it's declared without being wired up; the one committed session-expiry
recovery still duplicates its login inline via `runSteps` instead.

**The schema serves two readers.** A human reviewing the full artifact sees
every locator, checkpoint, and policy line. An agent deciding whether and how
to call a capability sees only a narrow `CapabilitySummary`, with steps,
locators, and policy stripped out entirely.

## Determinism & error handling

**The result contract is three-way, not a boolean with an error field.**
`replay()` returns `success` (with outputs), `business_outcome` (a known,
named result such as "no such member," a legitimate outcome, not an error), or
`failure` (the step, what was expected, what was observed, and a screenshot).
Recovery is checked before outcomes, in declaration order, at every retry; a
recovery that exhausts its attempts becomes its own kind, `recovery_exhausted`,
rather than being silently misreported as an outcome.

**At-most-once for irreversible actions is layered three ways, not enforced once.** An in-run idempotency probe never redispatches a step already
dispatched this run. A precondition is promoted to a real top-level outcome
for a wholly separate later run. And the fixture's own order-placement
endpoint looks up any existing order for that member before creating one,
rather than creating unconditionally, because a human clicking the same
button twice through the raw UI bypasses both of the automation's own layers.
All three are real, not assumed.

**Every named runtime condition is proven, not just handled in theory:** a
validation error, "record not found," a permission denial, an unexpected
dialog, a session timeout, a slow load, and an outright server error, each
against a real `replay()` call hitting a real instance of that condition.

**One genuine correctness bug surfaced directly from testing, not a code review.** A `Surface` can be reused across sequential runs for efficiency, and
outcomes/recovery were being evaluated against a new run's very first
observation before it had dispatched even its own first action, meaning a
fresh run could report a result based on whatever an *unrelated previous run*
had left on the page. The fix gates evaluation behind "has this run acted at
least once," with a regression test modeling exactly this
two-runs-one-surface scenario.

## Heterogeneity & multi-tenant

**The surface abstraction is designed to extend to a different platform.** The
core contract is `observe`, `act`, and `close`; `setPolicy` and `setRunId`
scope each run so one surface instance can run several artifacts in sequence
without evidence collision. No Playwright type appears in the interface, and
`Observation`'s vocabulary maps directly onto desktop UI Automation concepts.
One honest exception: `Observation.url` and `urlMatches` are web-specific
concepts in an otherwise surface-agnostic vocabulary; a desktop surface would
synthesize a stand-in and avoid `urlMatches`.

**Cross-tenant reuse is built and proven, not just designed.** One base
capability is adapted to a second tenant's relabeled field by replacing only
the steps that differ, never a partial patch, since a step's locator,
checkpoint, and action are one coherent unit. The base artifact is never
modified to accommodate a variant: overrides are additive files layered on
top of it, not re-recorded capabilities per tenant. This is proven
bidirectionally against the real fixture: the unmodified base genuinely fails
on the second tenant, and the override genuinely fixes it, reading the
identical real value. An override cannot change a replaced step's risk
classification, closing a privilege-escalation path an unconstrained override
would otherwise open. Per-tenant drift already has a real signal: replay
tracks whenever a step resolves at a lower locator tier than it was recorded
at, which is the concrete signal for deciding when a capability needs
re-recording rather than continuing to run against a UI that has drifted
further than expected.

**What isn't built is a scoped extension, not a redesign.** An override can
only *replace* an existing step, not *insert* a new one. There is also no
registry-level tenant-to-variant resolution; a caller has to already know
which override applies.

## Escalation & handoff

**The state machine is the actual seam, independent of whatever is on the other end of it.** A `RunLease` (`AUTOMATION → PAUSED_PENDING_HUMAN →
HUMAN_CONTROL → RESUMING → AUTOMATION`, or `→ ABORTED` on timeout) is what a
takeover goes through; discovery and replay both escalate through the
identical path. A human takes over the *same* live browser session, never a
fresh one, since a fresh session would lose the state that got the run to
this point, and the browser is headed by default for the same reason: a human
taking over needs an operable window, not a screenshot of one. Control
resumes only after the checkpoint is re-verified against a fresh observation;
a failed re-verification re-escalates rather than proceeding or aborting
silently. `escalation_timeout` (one intervention unanswered) is kept distinct
from `escalation_limit` (every one answered, but the run still hit its cap).

**What the human sees and does is real, because a real incident forced it to be.** An intervention carries which capability, the current step and its
intent, a specific reason, and a real screenshot captured at the moment
escalation is raised, for every intervention, not just a terminal failure.
What the human *does* is recorded too: click and input events across every
frame, capturing only the target's tag and structural identifier, never a
typed value. Before escalating on a possibly-irreversible action, discovery
also scans the page for existing-outcome text and folds it into the reason as
an explicit warning. That warning exists because of a real duplicate order: a
human manually completing the replacement-card flow by hand placed a second
order for a member who already had one, since nothing in that moment told
them so. Neither the in-run idempotency probe nor this warning covers that
case alone, since both are scoped to a single run's own tracking; that gap is
what `precheck` was built to close.

**One piece is explicitly out of scope.** A genuinely separate operator
process on a different machine would need real IPC. This build's handoff is
same-process, same-machine; the state machine and the executor's blocking
behavior around it are exactly what a remote operator console would build on.

## Safety

**Every step is classified safe or irreversible, and that classification is what the other safety mechanisms key off:** whether a step's `precheck` is
consulted, whether it's tracked for idempotency across a retry, and whether
its dispatch is journaled with a synchronous fsync before the click.

**The allowlist is an intersection, not a self-declared claim.** An
artifact's own `policy` is checked at the single choke point every dispatched
action passes through. The policy actually enforced is the *intersection* of
that declaration and a separate, deployment-level allowlist (a plain JSON
config an operator edits directly): an artifact can narrow what it touches,
but never wider than what the deployment permits.

**Redaction happens on write, for inputs and outputs alike.** Any input or
output declared `redact: true` is masked before it reaches a durable log; the
value `replay()` returns to the caller is untouched. Credentials never reach
this boundary, or any log, at all: a reference resolves to a real secret in
exactly one place, inside the surface adapter.

**Unattended execution is an opt-in, not a default.** A freshly compiled
capability starts as a draft and is refused for unattended replay unless a
human explicitly promotes it. This is the chosen answer to handling
irreversible actions conservatively: the human decision happens once, when
an artifact is reviewed and approved, rather than blocking or confirming on
every dispatch. Discovery still escalates live on a proposed irreversible
action, since nothing has been reviewed yet; replay of an already-approved
artifact only escalates if something about that specific dispatch turns
ambiguous, such as a failed checkpoint or a redispatch with no idempotency
probe declared.

**Three limitations are named honestly rather than left for a reviewer to find.** The allowlist checks origin, not path (see Cuts). There is no
per-tenant rate limiting; no shared mutable state between runs means this
isn't structurally blocked, but it isn't solved either. And nothing here
assumes a zero-retention agreement with the model provider, a non-issue
against a synthetic fixture but a real gap against actual regulated data.

## Cuts

**Multi-tenant:**

- Override can insert only by replacement, not addition, so a genuinely new
  step can't be expressed.
- No automatic tenant-to-variant resolution; applying the right override for
  a calling tenant is manual today.

**Safety and scale:**

- Allowlist has no route/path granularity, only origin, though the
  deployment-config intersection itself is real and enforced.
- No backpressure across many simultaneous tenants; not structurally blocked,
  but not solved either.
- The model provider is a public, free-tier API, fine for a synthetic
  fixture, not for real regulated data without a zero-retention tier.

**Schema and process:**

- `recovery`'s `preflight` kind is declared but not wired up; only `runSteps`
  is functional.
- The matcher-overlap check is conservative, not a general prover: it catches
  structural equality or containment, not every conceivable conflict, since
  general matcher overlap isn't decidable.
- Promoting a capability to `approved` is manual, not an automated pipeline.
  The fault-coverage tests prove the replay engine handles known conditions
  correctly; flipping a specific capability's `approval.state` on that result
  is still done by hand.
- A human-assisted artifact isn't specifically blocked from being marked
  approved; `provenance.humanAssisted` is recorded but never read elsewhere.
- The capability catalog isn't literal JSON Schema, a deliberately simpler,
  purpose-built summary shape instead.
- A desktop surface isn't implemented; the interface is designed to support
  one cleanly (see Heterogeneity), with one named web-specific coupling.
- The recorder never infers outcomes or recovery from a trace: every
  compiled artifact starts with `outcomes: []` and `recovery: []`
  unconditionally, since a single successful trace contains no failures to
  learn a recovery from.
- Output-extraction candidates aren't always value-generic: at least one
  recorder-compiled artifact has an extraction candidate keyed to the literal
  value it was recorded against, and may need re-verification against
  materially different input.
