/**
 * One action union, shared by discovery decisions and replay steps. Adding an action
 * kind is one edit here, not four scattered ones.
 *
 * No `waitFor`: waiting is a step-level concern (a Matcher the executor polls), not an
 * action a surface performs, so this file has no dependency on the matcher module.
 */
import * as z from 'zod';
import { LocatorDescriptorSchema } from '../locator/descriptor';

export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string() }),
  z.object({ kind: z.literal('click'), target: LocatorDescriptorSchema }),
  z.object({ kind: z.literal('type'), target: LocatorDescriptorSchema, text: z.string() }),
  /** Carries a reference, never a literal -- the secret resolves inside the surface adapter and never enters a log or artifact. */
  z.object({ kind: z.literal('typeCredential'), target: LocatorDescriptorSchema, credentialRef: z.string() }),
  z.object({ kind: z.literal('select'), target: LocatorDescriptorSchema, option: z.string() }),
  z.object({ kind: z.literal('read'), target: LocatorDescriptorSchema, source: z.enum(['text', 'value']) }),
]);
export type Action = z.infer<typeof ActionSchema>;

/**
 * Resolution happens inside act(), immediately before dispatch, against a freshly taken
 * observation -- so no nodeId ever crosses this boundary.
 */
export const ActionResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    /** Present when the action was a `read`. */
    value: z.string().optional(),
    /** Absent for `navigate` -- there is no locator to resolve. */
    resolvedTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['unresolved', 'ambiguous', 'not_enabled', 'not_visible', 'timeout']),
    detail: z.string(),
  }),
]);
export type ActionResult = z.infer<typeof ActionResultSchema>;
