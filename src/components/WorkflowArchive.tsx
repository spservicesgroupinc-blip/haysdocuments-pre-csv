import { itemOf } from '../types/workflow';
import { ArtifactDownloads, Panel, type WorkflowWorkspaceProps } from './workflow/shared';

/** Published files remain accessible when an authoring stage is disabled for rollout. */
export default function WorkflowArchive(props: WorkflowWorkspaceProps) {
  const artifacts = itemOf(props.items, 'artifact').filter(item => item.payload.reviewState === 'final');
  if (!artifacts.length) return null;
  return <Panel title="Published job documents" description="Download the saved version prepared from its frozen source."><div className="space-y-4">{artifacts.map(artifact => <div className="rounded-lg border border-line p-3" key={artifact.itemId}><p className="mb-2 text-sm font-semibold capitalize text-primary">{artifact.payload.type.replaceAll('_', ' ')}</p><ArtifactDownloads artifact={artifact} props={props} /></div>)}</div></Panel>;
}
