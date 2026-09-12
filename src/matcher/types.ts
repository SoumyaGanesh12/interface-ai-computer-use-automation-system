/**
 * One declarative predicate type, used for checkpoints, outcome detection, recovery
 * detection, and step waits. Data only -- no code, no eval. Extraction (reading a value
 * out) is a separate type in ./extraction.ts, because a predicate can't produce a value.
 */
import * as z from 'zod';
import { LocatorDescriptorSchema, type LocatorDescriptor } from '../locator/descriptor';

export type Matcher =
  | { kind: 'nodeExists'; target: LocatorDescriptor }
  | { kind: 'nodeAbsent'; target: LocatorDescriptor }
  | { kind: 'textPresent'; scope: LocatorDescriptor | 'page'; pattern: string; flags?: string }
  | { kind: 'nodeValue'; target: LocatorDescriptor; op: 'eq' | 'neq' | 'matches' | 'nonEmpty'; value?: string }
  | { kind: 'urlMatches'; pattern: string }
  | { kind: 'all'; of: Matcher[] }
  | { kind: 'any'; of: Matcher[] }
  | { kind: 'not'; of: Matcher };

export const MatcherSchema: z.ZodType<Matcher> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('nodeExists'), target: LocatorDescriptorSchema }),
    z.object({ kind: z.literal('nodeAbsent'), target: LocatorDescriptorSchema }),
    z.object({
      kind: z.literal('textPresent'),
      scope: z.union([LocatorDescriptorSchema, z.literal('page')]),
      pattern: z.string().min(1),
      flags: z.string().optional(),
    }),
    z
      .object({
        kind: z.literal('nodeValue'),
        target: LocatorDescriptorSchema,
        op: z.enum(['eq', 'neq', 'matches', 'nonEmpty']),
        value: z.string().optional(),
      })
      .refine((m) => m.op === 'nonEmpty' || m.value !== undefined, {
        message: 'value is required unless op is "nonEmpty"',
        path: ['value'],
      }),
    z.object({ kind: z.literal('urlMatches'), pattern: z.string().min(1) }),
    z.object({ kind: z.literal('all'), of: z.array(MatcherSchema).min(1) }),
    z.object({ kind: z.literal('any'), of: z.array(MatcherSchema).min(1) }),
    z.object({ kind: z.literal('not'), of: MatcherSchema }),
  ]),
);
