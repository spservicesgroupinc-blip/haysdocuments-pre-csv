import { useEffect, useState } from 'react';
import { blankDecision, itemOf, newId, workflowOf, type ChangePayload, type JobItem, type SelectionPayload } from '../../types/workflow';
import { ActionState, ArtifactDownloads, AttachmentList, Panel, button, money, primary, useAction, type WorkflowWorkspaceProps } from './shared';
import { ContractBaseline } from './ContractBaseline';
import { ChangeEditor } from './ChangeEditor';

export const blankChange = (): ChangePayload => ({ number: '', scope: '', insuranceRelated: true, amountCents: 0, addedDays: 0, lifecycle: 'draft', customerDecision: blankDecision(), carrierDecision: blankDecision(), attachmentIds: [], linkedSelectionIds: [], documentArtifactId: null });
export type NewSelectionChange = { id: string; selection: SelectionPayload };

function ChangeCard({ item, props, onEdit, onAmend }: { item: JobItem<'change'>; props: WorkflowWorkspaceProps; onEdit: () => void; onAmend: () => void }) {
  const action = useAction();
  const payload = item.payload;
  const workflow = workflowOf(props.job, props.items);
  const artifact = itemOf(props.items, 'artifact').find(candidate => candidate.itemId === payload.documentArtifactId);
  return <li className="min-w-0 space-y-3 rounded-lg border border-line p-3"><div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><h3 className="text-sm font-semibold text-primary">{payload.number ? `Change ${payload.number}` : 'Unnumbered draft'}</h3><p className="mt-1 text-xs capitalize text-muted">{payload.lifecycle}{payload.legacy ? ' · Imported legacy change' : ''}{payload.documentArtifactId ? ' · Issued document' : ''}</p></div><p className="text-sm font-semibold text-primary">{money(payload.amountCents)}{payload.addedDays ? ` · +${payload.addedDays} days` : ''}</p></div><p className="whitespace-pre-wrap break-words text-sm text-body">{payload.scope}</p><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><span>Customer: {payload.customerDecision.status === 'approved' ? 'Recorded approval' : payload.customerDecision.status}</span><span>Carrier: {payload.carrierDecision.status.replaceAll('_', ' ')}</span></div>
    <div className="flex flex-wrap gap-2">{!props.readOnly ? <button type="button" className={button} onClick={onEdit}>{payload.documentArtifactId ? 'Record decisions' : 'Edit change / decisions'}</button> : null}<button type="button" className={button} disabled={action.busy} onClick={() => void action.run(() => props.onExport('change_order', { changeId: item.itemId, final: false }))}>Download draft</button>
      {!props.readOnly && !payload.number && payload.lifecycle === 'draft' ? <button type="button" className={button} disabled={action.busy || props.pendingCount > 0} onClick={() => void action.run(() => props.onSave('change', item.itemId, { ...payload, lifecycle: 'submitted' }), 'Submission saved on this device. The server assigns its number after sync.')}>Submit for numbering</button> : null}
      {!props.readOnly && !payload.documentArtifactId ? <button type="button" className={primary} disabled={action.busy || props.pendingCount > 0 || !workflow.baselineReviewed || !payload.number || payload.lifecycle !== 'submitted'} onClick={() => void action.run(() => props.onExport('change_order', { changeId: item.itemId, final: true }), 'Reviewed change order issued with a frozen source.')}>Issue reviewed change order</button> : null}
      {!props.readOnly && payload.documentArtifactId ? <button type="button" className={button} onClick={onAmend}>Create amendment</button> : null}</div>
    {artifact ? <ArtifactDownloads artifact={artifact} props={props} /> : null}<AttachmentList parent={{ kind: 'change', itemId: item.itemId }} props={props} /><ActionState action={action} />
  </li>;
}

export function ChangesSection({ newSelectionChange, onSelectionChangeConsumed, ...props }: WorkflowWorkspaceProps & { newSelectionChange?: NewSelectionChange | null; onSelectionChangeConsumed?: () => void }) {
  const changes = itemOf(props.items, 'change');
  const [editing, setEditing] = useState<{ id: string; payload: ChangePayload } | null>(null);
  useEffect(() => {
    if (!newSelectionChange) return;
    const selection = newSelectionChange.selection;
    setEditing({ id: newId(), payload: { ...blankChange(), scope: [selection.room, selection.item, selection.specification].filter(Boolean).join(' · '), linkedSelectionIds: [newSelectionChange.id] } });
    onSelectionChangeConsumed?.();
  }, [newSelectionChange]);
  function amend(item: JobItem<'change'>) {
    setEditing({ id: newId(), payload: { ...blankChange(), insuranceRelated: item.payload.insuranceRelated, carrierDecision: item.payload.insuranceRelated ? blankDecision() : { ...blankDecision(), status: 'not_applicable' }, scope: `Amendment to ${item.payload.number || 'previous change'}:\n${item.payload.scope}`, predecessorId: item.itemId, linkedSelectionIds: [...item.payload.linkedSelectionIds] } });
  }
  return <div className="space-y-4"><ContractBaseline {...props} /><Panel title="Changes and supplements" description="Keep each change and its customer and carrier decisions separate.">
    {!props.readOnly && !editing ? <button className={primary} type="button" onClick={() => setEditing({ id: newId(), payload: blankChange() })}>Add change / supplement</button> : null}
    {editing ? <ChangeEditor id={editing.id} source={changes.find(item => item.itemId === editing.id)?.payload ?? editing.payload} key={editing.id} props={props} onClose={() => setEditing(null)} /> : null}
    {!changes.length && !editing ? <p className="text-sm text-muted">No changes recorded. Add only changes needed for this job.</p> : null}
    <ul className="space-y-3">{changes.map(item => <ChangeCard key={item.itemId} item={item} props={props} onEdit={() => setEditing({ id: item.itemId, payload: structuredClone(item.payload) })} onAmend={() => amend(item)} />)}</ul>
  </Panel></div>;
}
