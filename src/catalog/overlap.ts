/**
 * Deliberately conservative, deliberately not exhaustive: proving two matchers overlap
 * in general is undecidable, and JS regexes aren't even regular. This catches structural
 * duplicates and one pattern literally containing another; everything else is allowed
 * through to the runtime precedence rule (recovery before outcomes, declaration order
 * within each), which is what actually guarantees determinism. Named as a limitation,
 * not hidden as a false completeness claim.
 */
import type { Matcher } from '../matcher/types';

export interface LabeledMatcher {
  label: string;
  matcher: Matcher;
}

function patternOf(m: Matcher): string | undefined {
  if (m.kind === 'textPresent') return m.pattern;
  if (m.kind === 'nodeValue' && m.op === 'matches') return m.value;
  return undefined;
}

function targetOf(m: Matcher): unknown {
  if (m.kind === 'textPresent') return m.scope;
  if (m.kind === 'nodeExists' || m.kind === 'nodeAbsent' || m.kind === 'nodeValue') return m.target;
  return undefined;
}

function overlaps(a: Matcher, b: Matcher): boolean {
  if (JSON.stringify(a) === JSON.stringify(b)) return true;

  if (a.kind !== b.kind) return false;
  const pa = patternOf(a);
  const pb = patternOf(b);
  if (pa === undefined || pb === undefined) return false;
  if (JSON.stringify(targetOf(a)) !== JSON.stringify(targetOf(b))) return false;
  return pa.includes(pb) || pb.includes(pa);
}

/** Returns a human-readable description per overlapping pair found, empty if none. */
export function findOverlaps(entries: LabeledMatcher[]): string[] {
  const issues: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      if (overlaps(a.matcher, b.matcher)) {
        issues.push(`${a.label} and ${b.label} have overlapping matchers -- an ambiguous capability must never reach "approved"`);
      }
    }
  }
  return issues;
}
