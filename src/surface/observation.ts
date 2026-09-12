/**
 * Normalized perception format. The only vocabulary above src/surface --
 * no DOM, no CSS selector, no driver handle crosses this line. Discovery and replay
 * consume the identical shape. Schema-first since Observation is also written to disk
 * (traces, evidence) and read back by the offline recorder.
 */
import * as z from 'zod';

/**
 * Closed set of roles a human operator would recognize, not the full ARIA vocabulary.
 * `unknown` is load-bearing: legacy markup often has no derivable role, and dropping
 * those nodes would blind the locator ladder's lower tiers.
 */
export const RoleSchema = z.enum([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'cell', 'row', 'table', 'heading', 'text', 'dialog', 'form',
  'list', 'listitem', 'image', 'region', 'unknown',
]);
export type Role = z.infer<typeof RoleSchema>;

/** Viewport-relative geometry. Only locator tier 5 (coordinates) consults it. */
export const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type Bounds = z.infer<typeof BoundsSchema>;

export const ObservedNodeSchema = z.object({
  /** Valid only within the observation that produced it -- never persisted in an artifact. */
  nodeId: z.string(),
  role: RoleSchema,
  /** Accessible name; legitimately empty on legacy markup, which is why tiers 2-5 exist. */
  name: z.string(),
  value: z.string().optional(),
  enabled: z.boolean(),
  visible: z.boolean(),
  /** Named frame ancestry, e.g. ['content']. Empty means the top document. */
  framePath: z.array(z.string()),
  bounds: BoundsSchema.optional(),
  /**
   * Nearby label/header/row text. DOM-derived, not AX-tree-derived -- a <td onclick>
   * layout table has no accessibility semantics to expose. Locator tier 2 depends on it.
   */
  textContext: z.string().optional(),
  parentId: z.string().optional(),
});
export type ObservedNode = z.infer<typeof ObservedNodeSchema>;

export const ObservationSchema = z.object({
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string(),
  nodes: z.array(ObservedNodeSchema),
  /** See observationHash in ./hash.ts for what this covers and what it deliberately omits. */
  hash: z.string(),
  capturedAt: z.string(),
});
export type Observation = z.infer<typeof ObservationSchema>;
