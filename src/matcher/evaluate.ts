/**
 * The one evaluator, used for checkpoints, outcome detection, recovery detection, and
 * step waits. Never throws -- an invalid regex in an artifact is a failed match, not a
 * crash, since this runs on every step of a live run.
 *
 * `ambiguous` never resolves to true for nodeExists or nodeAbsent: the resolver already
 * refuses to guess when acting on an element, and a matcher must not smuggle that guess
 * back in for a mere presence check.
 */
import { resolve } from '../locator/resolve';
import type { Observation, ObservedNode } from '../surface/observation';
import type { Matcher } from './types';

export interface MatchResult {
  satisfied: boolean;
  evidence: string;
}

function safeRegex(pattern: string, flags?: string): RegExp | undefined {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return undefined;
  }
}

function nodeText(node: ObservedNode): string {
  return [node.name, node.value ?? '', node.textContext ?? ''].join(' ');
}

function pageText(obs: Observation): string {
  return [obs.title, ...obs.nodes.map(nodeText)].join(' ');
}

export function evaluate(matcher: Matcher, obs: Observation): MatchResult {
  switch (matcher.kind) {
    case 'nodeExists': {
      const outcome = resolve(matcher.target, obs);
      const satisfied = outcome.kind === 'resolved' || outcome.kind === 'not_enabled';
      return { satisfied, evidence: `nodeExists: resolve -> ${outcome.kind}` };
    }

    case 'nodeAbsent': {
      const outcome = resolve(matcher.target, obs);
      const satisfied = outcome.kind === 'unresolved' || outcome.kind === 'not_visible';
      return { satisfied, evidence: `nodeAbsent: resolve -> ${outcome.kind}` };
    }

    case 'nodeValue': {
      const outcome = resolve(matcher.target, obs);
      if (outcome.kind !== 'resolved' && outcome.kind !== 'not_enabled') {
        return { satisfied: false, evidence: `nodeValue: target unavailable (resolve -> ${outcome.kind})` };
      }
      const value = outcome.node.value ?? '';
      if (matcher.op === 'eq') return { satisfied: value === matcher.value, evidence: `nodeValue eq: "${value}" vs "${matcher.value}"` };
      if (matcher.op === 'neq') return { satisfied: value !== matcher.value, evidence: `nodeValue neq: "${value}" vs "${matcher.value}"` };
      if (matcher.op === 'nonEmpty') return { satisfied: value.trim().length > 0, evidence: `nodeValue nonEmpty: "${value}"` };
      const re = safeRegex(matcher.value ?? '');
      if (!re) return { satisfied: false, evidence: `nodeValue matches: invalid pattern "${matcher.value}"` };
      return { satisfied: re.test(value), evidence: `nodeValue matches: "${value}" against /${matcher.value}/` };
    }

    case 'textPresent': {
      let haystack: string;
      if (matcher.scope === 'page') {
        haystack = pageText(obs);
      } else {
        const outcome = resolve(matcher.scope, obs);
        if (outcome.kind !== 'resolved' && outcome.kind !== 'not_enabled') {
          return { satisfied: false, evidence: `textPresent: scope unavailable (resolve -> ${outcome.kind})` };
        }
        haystack = nodeText(outcome.node);
      }
      const re = safeRegex(matcher.pattern, matcher.flags);
      if (!re) return { satisfied: false, evidence: `textPresent: invalid pattern "${matcher.pattern}"` };
      return { satisfied: re.test(haystack), evidence: `textPresent: /${matcher.pattern}/ against "${haystack.slice(0, 80)}"` };
    }

    case 'urlMatches': {
      const re = safeRegex(matcher.pattern);
      if (!re) return { satisfied: false, evidence: `urlMatches: invalid pattern "${matcher.pattern}"` };
      return { satisfied: re.test(obs.url), evidence: `urlMatches: /${matcher.pattern}/ against "${obs.url}"` };
    }

    case 'all': {
      const results = matcher.of.map((m) => evaluate(m, obs));
      const satisfied = results.every((r) => r.satisfied);
      return { satisfied, evidence: `all(${results.filter((r) => r.satisfied).length}/${results.length}): ${results.map((r) => r.evidence).join(' | ')}` };
    }

    case 'any': {
      const results = matcher.of.map((m) => evaluate(m, obs));
      const satisfied = results.some((r) => r.satisfied);
      return { satisfied, evidence: `any(${results.filter((r) => r.satisfied).length}/${results.length}): ${results.map((r) => r.evidence).join(' | ')}` };
    }

    case 'not': {
      const inner = evaluate(matcher.of, obs);
      return { satisfied: !inner.satisfied, evidence: `not(${inner.evidence})` };
    }
  }
}
