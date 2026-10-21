import { useEffect, useState } from 'react';
import { blankDecision, itemOf, newId, workflowOf, type ChangePayload, type JobItem, type SelectionPayload } from '../../types/workflow';
import { ActionState, ArtifactDownloads, AttachmentList, Panel, button, money, primary, useAction, type WorkflowWorkspaceProps } from './shared';
import { ContractBaseline } from './ContractBaseline';
import { ChangeEditor } from './ChangeEditor';
import { QuickChangeForm } from './QuickChangeForm';

export const blankChange = (): ChangePayload => ({ number: '', scope: '', insuranceRelated: true, amountCents: 0, addedDays: 0, lifecycle: 'draft', customerDecision: blankDecision(), carrierDecision: blankDecision(), attachmentIds: [], linkedSelectionIds: [], documentArtifactId: null });
export type NewSelectionChange = { id: string; selection: SelectionPayload };

function ChangeCard({ item, props, onEdit, onAmend }: { item: JobItem<'change'>; props: WorkflowWorkspaceProps; onEdit: () => void; onAmend: () => void }) {
  const action = useAction();
  const payload = item.payload;
  const workflow = workflowOf(props.job, props.items);
  const artifact = itemOf(props.items, 'artifact').find(candidate => candidate.itemId === payload.documentArtifactId);
  return <li className="min-w-0 space-y-3 rounded-lg border border-line p-3"><div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><h3 className="text-sm font-semibold text-primary">{payload.number ? `Change ${payload.number}` : 'Unnumbered draft'}</h3><p className="mt-1 text-xs capitalize text-muted">{payload.lifecycle}{payload.legacy ? ' · Imported legacy change' : ''}{payload.documentArtifactId ? ' · Issued document' : ''}</p></div><p className="text-sm font-semibold text-primary">{money(payload.amountCents)}{payload.addedDays ? ` · +${payload.addedDays} days` : ''}</p></div><p className="whitespace-pre-wrap break-words text-sm text-body">{payload.scope}</p><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><span>Customer: {payload.customerDecision.status === 'approved' ? 'Recorded approval' : payload.customerDecision.status}</span><span>Carrier: {payload.carrierDecision.status.replaceAll('_', ' ')}</span></div>
    <div className="flex flex-wrap gap-2">{!props.readOnly ? <button type="button" className={button} onClick={onEdit}>{payload.documentArtifactId ? 'Record decisions' : 'Edit change / decisions'}</button> : null}{!payload.documentArtifactId ? <button type="button" className={button} disabled={action.busy} onClick={() => void action.run(() => props.onExport('change_order', { changeId: item.itemId, final: false }))}>Download draft</button> : null}
      {!props.readOnly && !payload.number && payload.lifecycle === 'draft' ? <button type="button" className={button} disabled={action.busy || props.pendingCount > 0} onClick={() => void action.run(() => props.onSave('change', item.itemId, { ...payload, lifecycle: 'submitted' }), 'Submission saved on this device. The server assigns its number after sync.')}>Submit for numbering</button> : null}
      {!props.readOnly && !payload.documentArtifactId ? <button type="button" className={primary} disabled={action.busy || props.pendingCount > 0 || !workflow.baselineReviewed || !payload.number || payload.lifecycle !== 'submitted'} onClick={() => void action.run(() => props.onExport('change_order', { changeId: item.itemId, final: true }), 'Reviewed change order issued with a frozen source.')}>Issue reviewed change order</button> : null}
      {!props.readOnly && (payload.documentArtifactId || payload.number) ? <button type="button" className={button} onClick={onAmend}>Create amendment</button> : null}</div>
    {artifact ? <ArtifactDownloads artifact={artifact} props={props} /> : null}<AttachmentList parent={{ kind: 'change', itemId: item.itemId }} props={props} /><ActionState action={action} />
  </li>;
}

export function ChangesSection({ newSelectionChange, onSelectionChangeConsumed, ...props }: WorkflowWorkspaceProps & { newSelectionChange?: NewSelectionChange | null; onSelectionChangeConsumed?: () => void }) {
  const changes = itemOf(props.items, 'change');
  const [editing, setEditing] = useState<{ id: string; payload: ChangePayload } | null>(null);
  const [quickOpen, setQuickOpen] = useState(true);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!newSelectionChange) return;
    const selection = newSelectionChange.selection;
    setEditing({ id: newId(), payload: { ...blankChange(), scope: [selection.room, selection.item, selection.specification].filter(Boolean).join(' · '), linkedSelectionIds: [newSelectionChange.id] } });
    onSelectionChangeConsumed?.();
  }, [newSelectionChange]);
  function amend(item: JobItem<'change'>) {
    setEditing({ id: newId(), payload: { ...blankChange(), insuranceRelated: item.payload.insuranceRelated, carrierDecision: item.payload.insuranceRelated ? blankDecision() : { ...blankDecision(), status: 'not_applicable' }, scope: `Amendment to ${item.payload.number || 'previous change'}:\n${item.payload.scope}`, predecessorId: item.itemId, linkedSelectionIds: [...item.payload.linkedSelectionIds] } });
  }
  return <div className="space-y-4">
    {notice ? <p role="status" className="rounded-lg border border-line bg-surface p-3 text-sm text-body">{notice}</p> : null}
    {!props.readOnly && quickOpen && !editing ? <QuickChangeForm props={props} onClose={() => setQuickOpen(false)} onComplete={submitted => { setQuickOpen(false); setNotice(submitted ? 'Change submitted on this device. It syncs to the shared register and receives its number when connected. Customer approval is still pending.' : 'Change draft saved on this device. It will sync to the shared register when connected.'); }} /> : null}
    {!props.readOnly && !quickOpen && !editing ? <button className={primary} type="button" onClick={() => { setQuickOpen(true); setNotice(''); }}>Quick change order</button> : null}
    <Panel title="Changes and supplements" description="Review saved changes, attach photos, record decisions, and issue documents.">
    {!props.readOnly && !editing ? <button className={button} type="button" onClick={() => { setQuickOpen(false); setEditing({ id: newId(), payload: blankChange() }); }}>Add change / supplement</button> : null}
    {editing ? <ChangeEditor id={editing.id} source={changes.find(item => item.itemId === editing.id)?.payload ?? editing.payload} isNew={!changes.some(item => item.itemId === editing.id)} key={editing.id} props={props} onClose={() => setEditing(null)} /> : null}
    {!changes.length && !editing ? <p className="text-sm text-muted">No changes recorded. Add only changes needed for this job.</p> : null}
    <ul className="space-y-3">{changes.map(item => <ChangeCard key={item.itemId} item={item} props={props} onEdit={() => setEditing({ id: item.itemId, payload: structuredClone(item.payload) })} onAmend={() => amend(item)} />)}</ul>
  </Panel><details className="rounded-xl border border-line bg-surface p-3 sm:p-4"><summary className="min-h-8 cursor-pointer text-sm font-semibold text-primary">Contract totals & baseline</summary><div className="mt-3"><ContractBaseline {...props} /></div></details></div>;
}
