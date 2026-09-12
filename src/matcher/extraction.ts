/**
 * The value-producing counterpart to Matcher. A predicate can't return a value, so
 * extraction is a distinct type rather than a Matcher variant.
 *
 * `transform` is a closed, reviewable registry -- no eval, no arbitrary expression. This
 * file is the complete list of ways an artifact can shape a raw string into an output.
 */
import * as z from 'zod';
import { resolve } from '../locator/resolve';
import { LocatorDescriptorSchema } from '../locator/descriptor';
import type { Observation } from '../surface/observation';

export const TransformSchema = z.enum(['trim', 'currency', 'integer', 'date', 'regexCapture']);
export type Transform = z.infer<typeof TransformSchema>;

export const ExtractionSchema = z
  .object({
    target: LocatorDescriptorSchema,
    source: z.enum(['text', 'value']),
    transform: TransformSchema,
    pattern: z.string().min(1).optional(),
  })
  .refine((e) => e.transform !== 'regexCapture' || e.pattern !== undefined, {
    message: 'pattern is required when transform is "regexCapture"',
    path: ['pattern'],
  });
export type Extraction = z.infer<typeof ExtractionSchema>;

export type ExtractResult = { ok: true; value: string | number } | { ok: false; reason: string; raw?: string };

type TransformFn = (raw: string, pattern?: string) => ExtractResult;

const TRANSFORMS: Record<Transform, TransformFn> = {
  trim: (raw) => ({ ok: true, value: raw.trim() }),

  currency: (raw) => {
    const value = Number.parseFloat(raw.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: `not a currency amount: "${raw}"`, raw };
  },

  integer: (raw) => {
    const value = Number.parseInt(raw.replace(/[^0-9-]/g, ''), 10);
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: `not an integer: "${raw}"`, raw };
  },

  date: (raw) => {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime())
      ? { ok: false, reason: `not a parseable date: "${raw}"`, raw }
      : { ok: true, value: parsed.toISOString().slice(0, 10) };
  },

  regexCapture: (raw, pattern) => {
    let re: RegExp;
    try {
      re = new RegExp(pattern ?? '');
    } catch {
      return { ok: false, reason: `invalid pattern: "${pattern}"`, raw };
    }
    const match = re.exec(raw);
    if (!match) return { ok: false, reason: `pattern did not match: /${pattern}/ against "${raw}"`, raw };
    return { ok: true, value: match[1] ?? match[0] ?? '' };
  },
};

/**
 * Never returns a null/undefined value wrapped in `ok: true` -- an unresolved target or
 * a failed transform is always a distinct failure, never a silently corrupted success.
 */
export function extract(extraction: Extraction, obs: Observation): ExtractResult {
  const outcome = resolve(extraction.target, obs);
  if (outcome.kind !== 'resolved' && outcome.kind !== 'not_enabled') {
    return { ok: false, reason: `target unavailable (resolve -> ${outcome.kind})` };
  }
  const raw = extraction.source === 'text' ? outcome.node.name : (outcome.node.value ?? '');
  return TRANSFORMS[extraction.transform](raw, extraction.pattern);
}
