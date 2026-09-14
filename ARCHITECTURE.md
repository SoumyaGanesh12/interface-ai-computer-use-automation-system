# Architecture

This document covers how the system is put together, why each major decision was made
the way it was (including the alternatives that were passed over), and where the
current design already extends cleanly versus where it would need real new work. See
`README.md` for what the system does and how to run it.

## 1. System overview

```
goal (plain language)
        |
        v
agent/ (LLM loop)          observe -> decide -> act, until done or stuck
        |
        | produces a trace
        v
recorder/ (compile)        re-runs the trace's already-decided actions once more,
        |                  deriving each checkpoint from what actually happens
        | produces an artifact (versioned, typed, reviewable)
        v
replay/ (executor)         no model anywhere in this path
        |
        | success / business_outcome / failure -- or an escalation
        v
session/ (human takeover)

Both agent/ and replay/ drive the same surface/ (Playwright + CDP) --
the only place a real browser is touched in the entire system.
```

Two things are true about this diagram that are enforced, not just drawn this way:

- **`agent/` and `replay/` never call each other, and both go through the identical
  `surface/`.** Discovery and replay consume the same `Observation` shape and dispatch
  the same `Action` union — the only thing that differs is *who decides* the next
  action (a model, or a pre-recorded step).
- **`replay/` has no path to a model client, and `recorder/` has no path to one
  either** — checked by a `dependency-cruiser` rule that fails the build if either
  boundary is crossed, directly or transitively. This is the actual mechanism behind
  "replay is deterministic," not a claim resting on nobody happening to add an import.

## 2. Why discovery and replay are separated at all

The alternative — one component that both decides actions live *and* can fall back to
a recorded step when confident — was rejected early. Two reasons:

1. **Auditability.** A capability that might silently consult a model on some runs and
   not others has no single, inspectable answer to "what will this do." Every
   `replay()` call needs to be answerable purely by reading the artifact file.
2. **Safety review.** An artifact is what a human approves before it runs unattended.
   If the executor could still make a live decision, approving the artifact wouldn't
   actually bound what happens at runtime.

The cost of this separation is real: anything the recorder didn't anticipate (a page
state genuinely outside what was observed during discovery) is a hard failure or an
escalation, never a moment where the system can "think" its way through it the way
discovery could. That's treated as a feature, not a gap — see §4.

## 3. Component walkthrough and the reasoning behind each

**`surface/`** — the perception/action seam. `Observation` is a normalized
role/name/value/bounds/frame-path tree, not a screenshot and not raw HTML. Screenshots
were rejected as the primary perception format because they push all of the "what is
this control" reasoning onto the model, non-deterministically, on every single run —
whereas a structured tree lets the *locator* carry that reasoning once, at record
time, and be replayed as pure resolution logic afterward. `Surface.act()` dispatches
click/type via a computed bounding-box center point and synthetic mouse/keyboard
events, not a DOM handle — the one deliberate exception is `select` (a native
dropdown genuinely needs a live element handle), which is called out explicitly rather
than pretending the abstraction is total.

**`locator/`** — five tiers, tried in order, first unique match wins: role+name, label
proximity, visible text, structural path, anchored coordinates. This was chosen over a
single "best" strategy (e.g. always generate a CSS selector) because the fixture — and
real legacy enterprise UIs generally — mix well-behaved controls with layout-table
button-lookalikes in the same screen; forcing one strategy either breaks on the good
half or the bad half. The cost is more moving parts: every candidate must state *why*
it's expected to be stable (schema-enforced, not optional), and tier drift is tracked
as a signal on every replay rather than silently ignored.

**`matcher/`** — one predicate type (`Matcher`) shared by checkpoints, outcome
detection, recovery detection, and step waits, plus a separate `Extraction` type for
the one place a predicate isn't enough (producing a value). Keeping predicates and
extraction structurally distinct, instead of one type that "sometimes" returns a
value, makes it a schema-level guarantee that a checkpoint can never accidentally
smuggle out a value nothing declared, and that extraction can never silently double as
a truthiness check.

**`catalog/`** — the artifact schema (Zod) and its own validity rules, most notably
matcher-overlap detection: an outcome and a recovery detector (or, as found during this
build, an outcome and a step-level precondition) sharing the same matcher is refused as
ambiguous rather than accepted and left to behave unpredictably at runtime. This
turned out not to be a theoretical concern — see §4.

**`recorder/`** — compiles a discovery trace into an artifact by *re-running* the
trace's already-decided actions against a real browser one more time, deriving each
checkpoint from what that real run actually produces. It does not trust anything the
trace recorded as a checkpoint, because a trace only ever records the *pre-action*
observation. Turning a literal typed value into a `{{param}}` input is done by exact
verbatim matching against the discovery goal string — a deliberately conservative rule
(reuse-by-value, fail loudly on a name collision) over something fuzzier, because a
silently wrong parameterization is worse than a compile that refuses and asks for a
name.

**`replay/`** — the executor. Recovery is checked before outcomes, at every re-entry
into a step's retry loop, using declaration order for both — a deterministic,
documented resolution order rather than "whichever fires first." An irreversible
step's own dispatch is journaled with `durable: true` (fsync before the click) so that
a crash between dispatch and confirmation is recoverable from disk, not memory.

**`registry/`** — the agent-facing capability catalog (a deliberately narrower view
than the full artifact: id, description, inputs, outputs — never steps, locators, or
policy) and the cross-tenant override mechanism (§6).

**`session/`** — a `RunLease` state machine (`AUTOMATION → PAUSED_PENDING_HUMAN →
HUMAN_CONTROL → RESUMING → AUTOMATION`, or `→ ABORTED`) is the actual seam a human
takeover goes through, independent of whatever process or console is on the other end
of it. `policy/` and `evidence/` are the safety and observability layers threaded
through both discovery and replay identically, not duplicated per caller.

**`model/`** — a one-method `ModelClient` seam (`complete(prompt)`), with the concrete
provider (an OpenAI-compatible chat-completions endpoint) as the only implementation.
Swapping providers is a config change, not a code change, and this module is the only
place `agent/` is allowed to reach — `replay/`, `recorder/`, and `registry/` have no
path to it at all.

## 4. Determinism and error handling, and a real bug this design surfaced

The replay contract is three-way at the top level — `success`, `business_outcome`, or
`failure` — not a boolean plus an error field, because "no such member" and "the
checkpoint never resolved" are different kinds of result a caller needs to branch on
differently, and conflating them is exactly how this kind of system produces false
alarms or missed ones.

One genuine correctness bug came directly out of stress-testing this design rather
than from a code review: a `Surface` can be reused across sequential runs for
efficiency (avoiding a browser relaunch per capability call), and outcomes/recovery
were being evaluated against the *very first* observation of a new run — which, before
that run has dispatched even its own first action, can still be showing whatever the
*previous* run left on the page. A fresh run could report a result based on unrelated
leftover state. The fix (gate recovery/outcome evaluation behind "has this run acted
at least once") is small; the fact that it took a real reused-surface scenario to
surface it is the more interesting lesson — a purely unit-level test of the outcome
matcher would never have caught it, only a test that actually modeled two runs sharing
one surface did.

## 5. Design decisions and their tradeoffs

| Decision | Alternative considered | Why this way |
|---|---|---|
| Accessibility-tree perception | Screenshot + vision model | Deterministic, cheap to replay with no model; loses anything with no accessible semantics at all (mitigated by the label-proximity/visible-text/coordinate tiers) |
| Five-tier locator ladder | One generic selector strategy | Matches how unevenly real legacy UIs are actually built; costs schema complexity and a mandatory rationale per candidate |
| Artifact-first build order (replay proven before the LLM was wired in) | Build the agent first, shape the schema around what it naturally emits | Keeps the schema designed on its own merits, not warped by one model's quirks; costs an extra integration pass once discovery was added |
| At-most-once + idempotency probe + fixture-level idempotency, not "exactly-once" | Trust a single dispatch-tracking flag | No cross-process transaction exists to guarantee exactly-once against a real backend; layering three independent checks (in-run probe, cross-run precheck turned into a real outcome, and the target system's own idempotency) is the credible substitute |
| Whole-step replacement for tenant overrides, never a partial patch | Patch individual fields (just the locator, say) | A step's action/target/checkpoint are one coherent unit; patching pieces independently risks a checkpoint that no longer matches what the patched action actually produces |
| Deployment allowlist as an intersection with artifact policy | Trust the artifact's own declared policy alone | An artifact's self-declared policy is a claim, not a guarantee; the intersection makes the deployment the actual ceiling |

## 6. Extending to what isn't built

**A different surface (desktop, a legacy thick client).** `Surface` is a plain
interface (`observe`, `act`, `setPolicy`, `setRunId`, `capture`, human-action
recording, `close`) —
no Playwright type appears in it, and `Observation`'s vocabulary (role, name, value,
enabled, visible, bounds, frame path) maps directly onto Windows UI Automation
concepts (ControlType, Name, the Value pattern, IsEnabled, IsOffscreen,
BoundingRectangle). A desktop adapter implementing the same interface is a credible
claim, not a hopeful one. The one honest caveat: `Observation.url` is required, and
`urlMatches` is one of the shared `Matcher` kinds — both are web-specific concepts
sitting in an otherwise surface-agnostic vocabulary. A desktop surface would synthesize
a stand-in for `url` (window title + process name) and desktop capabilities would
simply avoid `urlMatches` in favor of `nodeExists`/`textPresent`.

**Real multi-tenant scale (hundreds of tenants, many on the same vendor product).**
What's actually built and proven: one base capability reused across two tenant
variants by overriding only the steps that differ, verified bidirectionally against
the real fixture (the unmodified base genuinely fails on the second tenant; the
override genuinely fixes it), plus a guard that an override can't escalate a step's
risk — closing the specific privilege-escalation path an unconstrained override
mechanism would otherwise open. Drift itself is already detected, not just designed
for: replay tracks whenever a step resolves at a lower locator tier than it was
recorded at, which is exactly the signal a real per-tenant/version drift monitor would
key off of.

A credible next step beyond what's here: overrides can only *replace* an existing
step, not *insert* a new one — a tenant needing a genuinely extra step (not just a
relabeled field) can't be expressed yet. And there's no registry-level tenant→variant
resolution — nothing today maps "this call is for tenant B" to "load this override
automatically"; a caller has to already know which override file applies. Both are
scoped, well-understood extensions of the existing mechanism, not redesigns of it.

**A different model provider.** `src/model/client.ts` defines the seam; swapping
providers means writing one new file implementing `ModelClient.complete()` and
changing an environment variable, since `agent/` only ever calls through the
interface.

**A new action or perception primitive.** The `Action` union and `ObservedNode` shape
are the two vocabularies everything above `surface/` depends on. Adding a new action
kind means extending the union, implementing it once in `act.ts`, and every locator
tier, matcher, and the recorder all pick it up without changes elsewhere — the closed,
small vocabulary is deliberate, not an oversight; it's what keeps a new primitive a
localized change instead of a cross-cutting one.
