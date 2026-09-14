/**
 * Compiles a successful discovery trace into a draft capability artifact. Never trusts
 * the trace's own recorded checkpoints, because it never recorded any -- a trace only
 * has each step's *pre-action* observation (what the model was shown before deciding),
 * and a checkpoint needs the *post-action* result. So this re-runs the trace's already
 * -decided action sequence for real, one more time, and derives each step's checkpoint
 * from what the run actually produced. This is a compile-time verification pass over a
 * fixed sequence, not the production replay() engine -- it shares the Surface primitive,
 * nothing else, and (enforced by .dependency-cruiser.cjs) it can never reach a model
 * client: every action it dispatches was already decided when the trace was recorded.
 *
 * An irreversible step is never re-dispatched just to compile it -- doing so would make
 * compiling a capability a second, unwanted execution of that capability's own
 * irreversible effect. Reaching one converts it to a `kind: 'escalate'` step and stops
 * compilation there; anything after it in the original trace is left uncompiled, for a
 * human to author by hand.
 *
 * A declared output value is searched for on the run's final page (see inferOutput):
 * exactly one matching node builds a self-verifying extraction the same way discovery's
 * own live decisions do (generateDescriptor); zero matches or more than one is a compile
 * failure, not a guess -- a stricter, uniqueness-checked search than the checkpoint's own
 * use of the same value (see toPattern), which only ever needs to confirm presence, not
 * locate the one reliable place to read it from on every future replay. Only possible
 * when the run ended safely: an escalate-terminated run never dispatches its last step,
 * so there is no live final page to search, and `outputs` stays empty for that step.
 *
 * An escalate step's carried `action` is the one decision that triggered escalation
 * during discovery, not necessarily an exhaustive script of everything a human did
 * afterward -- once a human takes control they are free to perform more than one real
 * action before releasing it, and the trace has no record of anything beyond the
 * original proposal (see src/agent/discover.ts, which discards endHumanActionRecording's
 * result for a live escalation rather than attaching it to the trace). The step's
 * checkpoint, derived from the run's actual final outputs, is what genuinely defines
 * what a human replaying this step must accomplish -- the carried action is a starting
 * point for them, not a complete guarantee.
 *
 * A literal typed value becomes a declared, reusable input (see ParamRegistry) when it
 * verbatim-matches a whole token in the discovery goal string -- e.g. typing "41382"
 * for a goal that names member 41382 becomes `{{memberId}}`, so the compiled capability
 * answers this question for any member, not only the one it happened to be shown. A
 * fixed constant like the login username, which never appears in the goal, stays
 * literal. `outcomes` and `recovery` are always emitted empty: unlike a parameter (a
 * stated, checkable rule) or an output value (a coarse existence check), inferring
 * error-handling from a single successful trace has nothing to learn it from -- a
 * happy-path run contains no failures to generalize a recovery or an outcome from. That
 * is a stated limitation, not an oversight.
 */
import { classifyRisk } from '../policy/risk';
import { validateArtifact } from '../catalog/validate';
import { generateDescriptor } from '../locator/generate';
import type { Artifact } from '../catalog/artifact';
import type { Step } from '../catalog/step';
import type { Matcher } from '../matcher/types';
import type { Action } from '../surface/action';
import type { LocatorDescriptor } from '../locator/descriptor';
import type { Surface } from '../surface/surface';
import type { Observation, ObservedNode } from '../surface/observation';
import type { TraceFile, TraceStep } from '../agent/trace';

/** Lowercased whole tokens from the goal string, split on anything that isn't a letter or digit. */
function goalTokens(goal: string): Set<string> {
  return new Set(
    goal
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((t) => t.toLowerCase()),
  );
}

/** The first descriptive label a locator's own candidates carry, in candidate order -- structuralPath/anchoredCoordinates have none. */
function labelFor(target: LocatorDescriptor): string | undefined {
  for (const c of target.candidates) {
    const l = c.locator;
    if (l.strategy === 'roleAndName' && l.name) return l.name;
    if (l.strategy === 'labelProximity' && l.labelText) return l.labelText;
    if (l.strategy === 'visibleText' && l.text) return l.text;
  }
  return undefined;
}

/**
 * "Member ID" -> "memberId", "savings_balance" -> "savingsBalance". Splits on
 * non-alphanumeric separators; a word with no internal case structure of its own (all
 * upper or all lower, like "ID" or "balance") gets title-cased/lowercased, but a word
 * that already mixes case (like "savingsBalance" arriving as one undelimited token, a
 * model's own self-reported key) is left alone beyond fixing its leading letter --
 * otherwise this would flatten an already-fine camelCase name into "savingsbalance".
 */
function toParamName(label: string): string {
  const words = label.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words
    .map((w, i) => {
      const hasOwnCaseStructure = /[a-z]/.test(w) && /[A-Z]/.test(w) && w !== w.toUpperCase();
      const lead = i === 0 ? w[0]!.toLowerCase() : w[0]!.toUpperCase();
      return hasOwnCaseStructure ? lead + w.slice(1) : lead + w.slice(1).toLowerCase();
    })
    .join('');
}

/**
 * Turns a literal typed value into a declared, reusable input when it's plausibly
 * something the caller supplies rather than a fixed constant of this capability: it
 * verbatim-matches a whole token in the discovery goal string (see compileArtifact's
 * doc comment for why this rule, not a more elaborate one, was the stated decision).
 * The same literal value appearing in more than one step reuses the same declared
 * input rather than declaring a duplicate; two different values that would derive the
 * same parameter name are a genuine naming collision, surfaced as a compile failure
 * rather than silently disambiguated -- the same "ambiguity is a failure, not a guess"
 * discipline the locator ladder and the matcher-overlap checker already apply.
 */
class ParamRegistry {
  private byValue = new Map<string, string>();
  private byName = new Map<string, string>();
  private anonymousCount = 0;
  readonly inputs: Artifact['inputs'] = [];
  private readonly tokens: Set<string>;

  constructor(goal: string) {
    this.tokens = goalTokens(goal);
  }

  /** Returns the param name to substitute, or undefined if this value stays literal. Fails loudly on a name collision. */
  resolve(value: string, target: LocatorDescriptor): { ok: true; paramName?: string } | { ok: false; reason: string } {
    if (!this.tokens.has(value.toLowerCase())) return { ok: true };

    const existing = this.byValue.get(value);
    if (existing) return { ok: true, paramName: existing };

    const label = labelFor(target);
    const name = label ? toParamName(label) : `param${++this.anonymousCount}`;

    const priorValue = this.byName.get(name);
    if (priorValue !== undefined && priorValue !== value) {
      return { ok: false, reason: `parameter name "${name}" would be derived for two different recorded values ("${priorValue}" and "${value}") -- a human needs to name these distinctly` };
    }

    this.byValue.set(value, name);
    this.byName.set(name, value);
    this.inputs.push({ name, type: 'string', required: true, redact: false, description: label ? `The ${label} to use for this run.` : `Input recorded during discovery (previously "${value}").` });
    return { ok: true, paramName: name };
  }
}

export interface CompileOptions {
  surface: Surface;
  capability: { id: string; name: string; semver: string; description: string };
  app: string;
  appVersion: string;
  variant: string;
}

export type CompileResult = { ok: true; artifact: Artifact } | { ok: false; reason: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escapes everything except runs of digits, which become `\d+`. Some declared output
 * values are freshly generated every run (a confirmation reference, a timestamp) and
 * will never recur literally; genericizing digits turns those into a checkpoint that
 * matches the general shape actually produced, not a value that can only ever match
 * this one past run. This does loosen an otherwise-stable value (a fixed balance would
 * also become "any dollar amount"), which is an accepted, stated trade -- a checkpoint
 * that is slightly less precise beats one that is deterministically unsatisfiable.
 */
function toPattern(value: string): string {
  return value
    .split(/(\d+)/)
    .map((chunk, i) => (i % 2 === 1 ? '\\d+' : escapeRegExp(chunk)))
    .join('');
}

function outputsCheckpoint(outputs: Record<string, string> | undefined): Matcher | undefined {
  if (!outputs || Object.keys(outputs).length === 0) return undefined;
  const matchers: Matcher[] = Object.values(outputs).map((v) => ({ kind: 'textPresent', scope: 'page', pattern: toPattern(v) }));
  return matchers.length === 1 ? matchers[0]! : { kind: 'all', of: matchers };
}

/** Every Action kind except navigate carries a `target`; callers only reach here after checking hasTarget. */
function actionTarget(action: Action): LocatorDescriptor {
  if (action.kind === 'navigate') throw new Error('navigate has no target');
  return action.target;
}

function hasTarget(action: Action): boolean {
  return action.kind !== 'navigate';
}

function slugify(intent: string, index: number, used: Set<string>): string {
  const base =
    intent
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `step-${index + 1}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n++}`;
  }
  used.add(candidate);
  return candidate;
}

/** A trace step that genuinely happened: dispatched (or human-performed) and recorded ok, with a real action. Excludes preflight/model failures and the terminal done/stuck entry. */
function dispatchableSteps(trace: TraceFile): TraceStep[] {
  return trace.steps.filter((s) => s.result === 'ok' && s.action !== undefined);
}

/** Only `type` actions are ever parameterized -- `typeCredential` already carries a reference, never a literal, and no other action kind carries free-typed text. */
function parameterizeAction(action: Action, params: ParamRegistry): { ok: true; action: Action } | { ok: false; reason: string } {
  if (action.kind !== 'type') return { ok: true, action };
  const resolved = params.resolve(action.text, action.target);
  if (!resolved.ok) return resolved;
  if (!resolved.paramName) return { ok: true, action };
  return { ok: true, action: { ...action, text: `{{${resolved.paramName}}}` } };
}

/**
 * Finds where a declared output value actually lives on the final page and builds a
 * self-verifying extraction for it, reusing generateDescriptor -- the same
 * self-verification discovery itself relies on for a live decision. A value that
 * appears nowhere, or in more than one place, is a compile failure, not a guess: this is
 * a stricter, uniqueness-checked search, unlike the checkpoint's own coarse use of the
 * same value (see toPattern) which only ever needs to confirm presence, not locate a
 * single reliable source to read from on every future replay.
 */
function inferOutput(name: string, value: string, observation: Observation, afterStep: string): { ok: true; output: Artifact['outputs'][number] } | { ok: false; reason: string } {
  const matches: { node: ObservedNode; source: 'text' | 'value' }[] = [];
  for (const node of observation.nodes) {
    if (node.name && node.name.includes(value)) matches.push({ node, source: 'text' });
    else if (node.value && node.value.includes(value)) matches.push({ node, source: 'value' });
  }
  if (matches.length === 0) {
    return { ok: false, reason: `could not find output "${name}" (value "${value}") anywhere on the final page` };
  }
  if (matches.length > 1) {
    return { ok: false, reason: `output "${name}" (value "${value}") appears in ${matches.length} places on the final page -- not unique enough to extract reliably` };
  }

  const { node, source } = matches[0]!;
  const target = generateDescriptor(node, observation);
  if (!target) return { ok: false, reason: `could not build a reliable locator for output "${name}"` };

  const raw = (source === 'text' ? node.name : node.value) ?? '';
  const exact = raw.trim() === value.trim();

  let extraction: Artifact['outputs'][number]['extraction'];
  let type: Artifact['outputs'][number]['type'];
  if (/^\$[\d,]+\.\d{2}$/.test(value)) {
    type = 'currency';
    extraction = { target, source, transform: 'currency' };
  } else if (/^-?\d+$/.test(value)) {
    type = 'integer';
    extraction = { target, source, transform: 'integer' };
  } else if (exact) {
    type = 'string';
    extraction = { target, source, transform: 'trim' };
  } else {
    type = 'string';
    extraction = { target, source, transform: 'regexCapture', pattern: toPattern(value) };
  }

  return { ok: true, output: { name: toParamName(name), type, nullable: false, afterStep, extraction, description: `Recorded from discovery: "${value}".`, redact: false } };
}

export async function compileArtifact(trace: TraceFile, opts: CompileOptions): Promise<CompileResult> {
  if (trace.status !== 'done') {
    return { ok: false, reason: `only a trace that completed with status "done" can be compiled into a capability, got "${trace.status}"` };
  }

  const entries = dispatchableSteps(trace);
  if (entries.length === 0) {
    return { ok: false, reason: 'trace has no dispatchable steps to compile' };
  }

  const steps: Step[] = [];
  const usedIds = new Set<string>();
  const origins = new Set<string>();
  const actionKinds = new Set<Action['kind']>();
  const params = new ParamRegistry(trace.goal);
  let lastObservation: Observation | undefined;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const action = entry.action!;
    const risk = entry.source === 'preflight' ? 'safe' : classifyRisk(action);
    const id = slugify(entry.intent, i, usedIds);

    if (action.kind === 'navigate') {
      try {
        origins.add(new URL(action.url).origin);
      } catch {
        // an unparsable navigate URL is caught by dispatch failing below, not here
      }
    }

    if (risk === 'irreversible') {
      const checkpoint = outputsCheckpoint(trace.outputs);
      if (!checkpoint) {
        return {
          ok: false,
          reason: `cannot derive a checkpoint for the escalated step "${id}": the trace declared no outputs to confirm against, and this step is never re-dispatched to find out`,
        };
      }
      // action is carried for a human operator's benefit only -- the executor never
      // reads it for an escalate-kind step, it only ever uses escalateReason/checkpoint.
      // (parameterizeAction is a no-op here in practice: only 'type' actions ever
      // qualify, and only 'click' actions are ever classified irreversible.)
      const parameterized = parameterizeAction(action, params);
      if (!parameterized.ok) return parameterized;
      steps.push({ id, intent: entry.intent, kind: 'escalate', escalateReason: `classified as a possibly irreversible action during discovery: ${action.kind}`, action: parameterized.action, checkpoint, risk: 'safe' });
      break; // never dispatched again; nothing after this point was verified this pass
    }

    actionKinds.add(action.kind);
    const dispatchResult = await opts.surface.act(action);
    if (!dispatchResult.ok) {
      return { ok: false, reason: `compile-time replay failed to dispatch step "${id}": ${dispatchResult.reason} -- ${dispatchResult.detail}` };
    }
    const observation = await opts.surface.observe();
    origins.add(new URL(observation.url).origin);
    lastObservation = observation;

    // The outputs-derived checkpoint describes the run's *final* state -- it must only
    // ever be used for the true last dispatchable step (next === undefined). An
    // intermediate step whose next step merely lacks a target (e.g. the next action is
    // itself another navigate) is not the end of the sequence, and must not be checked
    // against a value that was only ever true once the whole run finished.
    const next = entries[i + 1];
    const checkpoint: Matcher = next
      ? hasTarget(next.action!)
        ? { kind: 'nodeExists', target: actionTarget(next.action!) }
        : { kind: 'urlMatches', pattern: escapeRegExp(new URL(observation.url).pathname) }
      : (outputsCheckpoint(trace.outputs) ?? { kind: 'urlMatches', pattern: escapeRegExp(new URL(observation.url).pathname) });

    // Dispatch above used the real recorded value (it has to, to actually verify
    // against the live app); the artifact stores the parameterized form so a later
    // replay can supply a different value instead of always searching for this one.
    const parameterized = parameterizeAction(action, params);
    if (!parameterized.ok) return parameterized;
    steps.push({ id, intent: entry.intent, kind: 'action', action: parameterized.action, checkpoint, risk: 'safe' });
  }

  // Only when the run ended safely (not on an escalate step, where nothing was
  // dispatched and there is no live final page to search) and the trace actually
  // declared something to look for.
  const outputs: Artifact['outputs'] = [];
  const endedOnEscalate = steps.at(-1)?.kind === 'escalate';
  if (!endedOnEscalate && lastObservation && trace.outputs) {
    const afterStep = steps.at(-1)!.id;
    for (const [name, value] of Object.entries(trace.outputs)) {
      const inferred = inferOutput(name, value, lastObservation, afterStep);
      if (!inferred.ok) return { ok: false, reason: `could not compile output "${name}": ${inferred.reason}` };
      outputs.push(inferred.output);
    }
  }

  const artifact: Artifact = {
    artifactSchemaVersion: 1,
    capability: opts.capability,
    surface: { kind: 'web', app: opts.app, appVersion: opts.appVersion, variant: opts.variant },
    requires: { authenticated: trace.steps.some((s) => s.source === 'preflight') },
    approval: { state: 'draft', verifiedRuns: 0 },
    inputs: params.inputs,
    outputs,
    steps,
    outcomes: [],
    recovery: [],
    policy: { allowedOrigins: [...origins], allowedActions: [...actionKinds] },
    provenance: { discoveredAt: trace.startedAt, model: trace.model, runId: trace.runId, humanAssisted: steps.some((s) => s.kind === 'escalate') },
  };

  const validated = validateArtifact(artifact);
  if (!validated.ok) return { ok: false, reason: `compiled artifact failed validation: ${validated.reason}` };
  return { ok: true, artifact: validated.artifact };
}
