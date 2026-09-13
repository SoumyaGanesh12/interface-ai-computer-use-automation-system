/** Shared CLI reporting for a freshly compiled artifact, used identically by record.ts and discover.ts --record. */
import type { Artifact } from '../catalog/artifact';

export function reportCompiledArtifact(artifact: Artifact, outPath: string): void {
  console.log(`wrote: ${outPath}`);
  console.log(`steps: ${artifact.steps.length}`);
  artifact.steps.forEach((step, i) => {
    const tag = step.kind === 'escalate' ? ' [escalate]' : '';
    console.log(`  ${i + 1}. ${step.intent}${tag}`);
  });
  console.log(`inputs: ${artifact.inputs.length ? artifact.inputs.map((i) => i.name).join(', ') : '(none)'}`);
  console.log(`approval: ${artifact.approval.state}`);
  console.log(`outputs: ${artifact.outputs.length ? artifact.outputs.map((o) => o.name).join(', ') : 'none (the run never dispatched a real final step to read one from, e.g. it ended on an escalate step)'}`);
}
