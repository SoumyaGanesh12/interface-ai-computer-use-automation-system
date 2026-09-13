/**
 * What the model returns per step. `targetNodeId` refers to a node in the *current*
 * observation the model was just shown -- the model picks, the loop builds the actual
 * locator (see src/locator/generate.ts). `rationale` is required and non-empty on every
 * decision: it's how evidence satisfies "what the agent did and why," and `intent`
 * seeds the eventual artifact step's own intent field once a trace is compiled.
 */
import * as z from 'zod';

const ActSchema = z.discriminatedUnion('actionKind', [
  z.object({ actionKind: z.literal('navigate'), url: z.string().min(1) }),
  z.object({ actionKind: z.literal('click'), targetNodeId: z.string().min(1) }),
  z.object({ actionKind: z.literal('type'), targetNodeId: z.string().min(1), text: z.string() }),
  z.object({ actionKind: z.literal('select'), targetNodeId: z.string().min(1), option: z.string().min(1) }),
  z.object({ actionKind: z.literal('read'), targetNodeId: z.string().min(1), source: z.enum(['text', 'value']).default('text') }),
]);
export type AgentAct = z.infer<typeof ActSchema>;

export const AgentDecisionSchema = z.object({
  rationale: z.string().min(1),
  intent: z.string().min(1),
  decision: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('act'), action: ActSchema }),
    z.object({ kind: z.literal('done'), outputs: z.record(z.string(), z.string()) }),
    z.object({ kind: z.literal('stuck'), reason: z.string().min(1) }),
  ]),
});
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
