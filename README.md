# Computer-Use Automation System

An LLM discovers how to complete a task in a web UI that has no API. The successful
run is compiled into a typed, versioned **capability artifact** - a reusable,
reviewable description of the flow. From then on, the capability replays
**deterministically**, with no model anywhere in the decision loop, escalating to a
human only when it genuinely can't proceed safely on its own.

```
discover  →  compile  →  replay (no model)  →  escalate on demand
  LLM          artifact       executor            human takeover
```

## What it does

- **Discovers** a UI flow from a plain-language goal, perceiving the page through an
  accessibility-tree observation (not screenshots, not raw HTML) and picking actions by
  node id - the loop then builds and self-verifies the actual locator, rather than
  trusting anything the model invents.
- **Compiles** a successful run into a capability artifact: ordered steps, a five-tier
  locator per target with a stated robustness rationale, typed inputs/outputs, and a
  checkpoint per step. Literal values become reusable `{{param}}` inputs automatically.
- **Replays** that artifact with zero model involvement - enforced architecturally, not
  just by convention (see [Architecture](#architecture)) - distinguishing a clean
  success, an expected business outcome ("no such member"), a recoverable condition
  (dismiss a dialog, retry a transient fault), and a hard failure with enough detail to
  debug.
- **Escalates** to a human when it's stuck: pauses the live session, lets a person take
  over the same browser window, records what they did, and resumes or completes once
  they're done.
- **Reuses** a capability across a different tenant's UI variant by overriding just the
  steps that differ, instead of re-discovering the whole flow.
- **Guards** every run with an origin/action allowlist (narrowed by a deployment-level
  config, not just the artifact's own claim), redacts declared-sensitive values before
  they reach a durable log, and gates unattended execution behind human approval.

## Architecture

```
agent/ (LLM loop)     --  produces a trace  -->  recorder/ (compile)
                                                          |
                                                  produces an artifact
                                                          v
                                                  replay/ (executor)  --> result

Both agent/ and replay/ drive the same surface/ (Playwright + CDP) --
the only place a real browser is touched.
```

See `ARCHITECTURE.md` for the full system diagram and the design reasoning behind
every piece of it.

- **`surface/`** is the one seam between "perceive/act on a UI" and everything above
  it. Discovery and replay both consume the same normalized `Observation` shape; a
  desktop adapter would implement the same `Surface` interface without either caller
  changing.
- **`replay/` never imports a model client, directly or transitively** - enforced by a
  `dependency-cruiser` rule that fails the build otherwise, not left as a convention
  someone could accidentally break. `recorder/` is held to the same rule: compiling a
  trace re-runs already-decided actions, it never re-decides anything.
- **`catalog/`** is the artifact schema (Zod, single source of truth for types and
  runtime validation) plus the matcher-overlap check that keeps an artifact from
  reaching `approved` while ambiguous.
- **`locator/`** is the five-tier resolution ladder (role+name → label proximity →
  visible text → structural path → anchored coordinates), tried in order; an ambiguous
  match is a failure, never a coin flip.
- **`registry/`** is the agent-facing capability catalog and the cross-tenant override
  mechanism.
- **`session/` + `policy/` + `evidence/`** are the safety layer: who controls the live
  session, what a run is allowed to touch, what gets redacted, and what gets logged
  where.

## Tech stack

| Component | Technology |
|---|---|
| Runtime | Node 22, TypeScript (strict) |
| Browser automation | Playwright + Chrome DevTools Protocol |
| Schema & validation | Zod |
| Architectural enforcement | dependency-cruiser |
| Test runner | Vitest (real browser + real fixture, not mocked) |
| Fixture app | Express (a standalone, deliberately legacy-styled banking console) |
| CLI | Commander |
| Model | Gemini, via an OpenAI-compatible chat-completions endpoint |

## Project structure

```
src/
  agent/       LLM-driven discovery loop (observe → decide → act)
  surface/     perception + action layer - the only place Playwright is touched
  locator/     five-tier element identification
  matcher/     checkpoint / outcome / recovery / extraction predicates
  catalog/     artifact schema, validation, step/recovery types
  recorder/    compiles a discovery trace into a versioned artifact
  replay/      deterministic executor - no model in the loop
  registry/    agent-facing capability catalog + cross-tenant overrides
  session/     human-takeover state machine (lease + operator channel)
  policy/      allowlist, redaction, credential resolution
  evidence/    structured run logs (per-run + durable audit trail)
  model/       model client seam, kept isolated from replay/recorder
  cli/         runnable entry points (discover, record, replay, catalog)

fixture/       standalone test banking app the system automates against
artifacts/     committed, versioned capability artifacts
config/        deployment-level configuration (e.g. the allowlist ceiling)
tests/         test suite, mirroring src/ - real browser, real fixture
```

## Setup

```bash
npm install
cp .env.example .env   # only needed for a real discovery run - fill in GEMINI_API_KEY
```

Everything except a live discovery run works with no API key and no external service,
against the local fixture only.

## Verify

```bash
npm run check
```

Runs the TypeScript compiler, the dependency-cruiser architectural rules, and the full
test suite (a real headless-Chromium integration suite against the fixture - it starts
its own fixture instance on an ephemeral port, no need to run `npm run fixture` first).

## Quick start

**1. Explore the fixture app**

```bash
npm run fixture
```

A deliberately inconsistent legacy console at `http://localhost:4400` - server-rendered,
a frameset, layout tables, `onclick` "buttons" with no semantic role, fields identified
only by an adjacent label cell. Log in with `svc.operator` /
`fixture-only-not-a-real-secret`. Members `41382`, `77410`, `20957` exist; any other ID
is a legitimate "not found." Runtime conditions are controlled per-session:

```
GET /_control/fault/:mode     none | not_found | session_expired | permission | slow | dialog | server_error
GET /_control/tenant/:variant a | b
GET /_control/reset
```

**2. Run a capability deterministically, no model involved**

```bash
npx tsx --env-file=.env src/cli/replay.ts --artifact "artifacts/member-savings-balance@1.0.0.json" --input memberId=41382 --headless
```

**3. Watch the LLM discover a flow from a goal, live**

```bash
npx tsx --env-file=.env src/cli/discover.ts --goal "Find member 41382 and report their savings balance." --headless
```

Prints each step as it happens, writes a full trace to `traces/<runId>.json`, and real
evidence to `evidence/<runId>/`. Add `--record` to compile the successful run straight
into a draft artifact in the same command.

**4. Watch a live human takeover, triggered for real**

```bash
npx tsx --env-file=.env src/cli/discover.ts --goal "Order a replacement card for member 41382." --escalation-timeout-ms 60000
```

This command omits `--headless`, unlike the earlier ones, so the actual browser stays
visible: a click classified as possibly irreversible pauses the run and
prompts on stdin. Complete the action yourself in the still-open window, then press
Enter to hand control back - the run re-verifies the checkpoint before continuing rather
than assuming the click worked. Leave it unanswered and the run genuinely times out
(`escalation_timeout`) instead of placing the order.

**5. Compile an existing trace into a reusable capability**

```bash
npm run record -- --trace traces/discovery-1789247660348.json --capability-id my-balance-lookup --name "My Balance Lookup" --description "Compiled from a discovery trace."
npm run replay -- --artifact "artifacts/my-balance-lookup@1.0.0.json" --input memberId=77410 --allow-draft
```

That last command replays a capability compiled against one member while asking about a
completely different one - and returns *that* member's real balance, proving the
parameterization and output extraction are both real.

> On some platforms, `npm run <script> -- --flag value` swallows the flag before the
> script sees it. If a command above behaves oddly, call the script directly instead:
> `npx tsx --env-file=.env src/cli/record.ts ...`.

**6. Browse and invoke capabilities the way an agent would**

```bash
npm run catalog -- describe
npm run catalog -- invoke --id member-savings-balance --input memberId=20957
```

The catalog exposes only what a caller needs to decide whether and how to invoke a
capability - id, description, inputs, outputs - never its internal steps, locators, or
policy.

## Safety guardrails

- **Allowlist, narrowed by deployment config.** An artifact's own `policy` is checked at
  the single choke point every dispatched action passes through; the policy actually
  enforced is the *intersection* with a separate deployment-level config
  (`config/allowlist.json` by default, override with `--deployment-config <path>` on the
  `replay` CLI) - an artifact can narrow what it touches, never widen past what the
  deployment permits.
- **Redaction on write.** Any input or output declared `redact: true` is masked before
  it reaches a durable log; the value returned to the caller is untouched. Credentials
  never reach a log, the model, or the artifact at all - only a reference does.
- **Approval gating.** A freshly compiled capability starts `draft` and is refused for
  unattended replay unless explicitly promoted, or the caller opts in with
  `--allow-draft`.
- **Human takeover with evidence.** An escalation carries a screenshot of the state that
  triggered it, not just a text reason, and pauses the *same* live session for a human
  to act in - never a fresh one.

## Testing

```bash
npx vitest run                          # everything
npx vitest run tests/replay             # one area
npx vitest run tests/replay/fault-coverage.test.ts   # one file
```

Nearly every test drives a real headless browser against a real (locally spun up)
fixture instance - mocked only where a clean seam is the right call rather than the
rest of the surrounding system (the console-based operator channel standing in for a
real operator UI, most notably).

## Author

Soumya Ganesh ([ganesh.so@northeastern.edu](mailto:ganesh.so@northeastern.edu))
