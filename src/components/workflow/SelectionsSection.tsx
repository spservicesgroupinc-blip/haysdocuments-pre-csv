import { useState } from 'react';
import { blankDecision, isOverdue, itemOf, newId, validatePayload, type SelectionPayload } from '../../types/workflow';
import { ActionState, AttachmentList, DecisionFields, Field, Message, Panel, button, control, dollars, grid, money, primary, readCents, useAction, useDraft, type WorkflowWorkspaceProps } from './shared';

const blank = (): SelectionPayload => ({ room: '', item: '', specification: '', allowanceCents: null, neededBy: '', responsiblePerson: { name: '', email: '' }, decision: blankDecision(), attachmentIds: [] });

function SelectionEditor({ id, source, props, onClose }: { id: string; source: SelectionPayload; props: WorkflowWorkspaceProps; onClose: () => void }) {
  const form = useDraft(source, id);
  const [allowance, setAllowance] = useState(() => dollars(source.allowanceCents));
  const action = useAction();
  const draft = form.draft;
  const needsRenewedReview = source.decision.status === 'approved' && (draft.specification !== source.specification || allowance !== dollars(source.allowanceCents));
  async function save() {
    const payload = { ...draft, allowanceCents: readCents(allowance), decision: needsRenewedReview ? blankDecision() : draft.decision };
    validatePayload('selection', payload);
    await props.onSave('selection', id, payload); onClose();
  }
  return <form className="space-y-4 rounded-lg border border-line p-3" onSubmit={event => { event.preventDefault(); void action.run(save); }}>
    <fieldset disabled={props.readOnly || action.busy} className="min-w-0 space-y-4"><div className={grid}><Field label="Room / area"><input className={control} maxLength={300} value={draft.room} onChange={event => form.change({ ...draft, room: event.target.value })} /></Field><Field label="Selection item"><input className={control} required maxLength={300} value={draft.item} onChange={event => form.change({ ...draft, item: event.target.value })} placeholder="Flooring, paint, cabinets…" /></Field></div>
    <Field label="Specification / selected finish"><textarea className={control} rows={3} maxLength={8000} value={draft.specification} onChange={event => form.change({ ...draft, specification: event.target.value })} /></Field>
    <div className={grid}><Field label="Allowance ($)" help="Leave blank when the allowance is unknown."><input type="number" className={control} step="0.01" value={allowance} onChange={event => setAllowance(event.target.value)} /></Field><Field label="Needed by"><input type="date" className={control} value={draft.neededBy} onChange={event => form.change({ ...draft, neededBy: event.target.value })} /></Field><Field label="Responsible person"><input className={control} maxLength={200} value={draft.responsiblePerson.name} onChange={event => form.change({ ...draft, responsiblePerson: { ...draft.responsiblePerson, name: event.target.value } })} /></Field><Field label="Responsible person's email"><input type="email" className={control} maxLength={254} value={draft.responsiblePerson.email ?? ''} onChange={event => form.change({ ...draft, responsiblePerson: { ...draft.responsiblePerson, email: event.target.value } })} /></Field></div>
    {needsRenewedReview ? <Message>The approved specification or allowance changed. Saving resets its decision to Pending for renewed review.</Message> : <DecisionFields title="Recorded selection decision" value={draft.decision} options={['pending', 'approved', 'changes_requested']} attachments={itemOf(props.items, 'attachment').filter(item => item.payload.uploadState === 'ready')} onChange={decision => form.change({ ...draft, decision })} />}
    <p className="text-xs text-muted">A recorded approval documents a decision; it does not create a signature, charge, or coverage decision.</p>
    <div className="flex flex-wrap gap-2"><button className={primary} type="submit">{action.busy ? 'Saving…' : 'Save selection'}</button><button className={button} type="button" onClick={onClose}>Cancel</button></div></fieldset><ActionState action={action} />
  </form>;
}

export function SelectionsSection({ onCreateChange, ...props }: WorkflowWorkspaceProps & { onCreateChange: (id: string, selection: SelectionPayload) => void }) {
  const selections = itemOf(props.items, 'selection');
  const [editing, setEditing] = useState<{ id: string; payload: SelectionPayload } | null>(null);
  return <Panel title="Selections and approvals" description="Record materials and finishes only when the job needs them.">
    {!props.readOnly && !editing ? <button type="button" className={primary} onClick={() => setEditing({ id: newId(), payload: blank() })}>Add selection</button> : null}
    {editing ? <SelectionEditor key={editing.id} id={editing.id} source={editing.payload} props={props} onClose={() => setEditing(null)} /> : null}
    {!selections.length && !editing ? <p className="text-sm text-muted">No selections recorded for this job.</p> : null}
    <ul className="space-y-3">{selections.map(item => <li className="min-w-0 space-y-3 rounded-lg border border-line p-3" key={item.itemId}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-semibold text-primary">{item.payload.room ? `${item.payload.room} · ` : ''}{item.payload.item}</h3><p className="mt-1 text-xs text-muted">{item.payload.decision.status === 'approved' ? 'Recorded approval' : item.payload.decision.status === 'changes_requested' ? 'Changes requested' : 'Pending'}{item.payload.decision.status !== 'approved' && isOverdue(item.payload.neededBy) ? ' · Overdue' : ''}{item.payload.neededBy ? ` · Needed ${item.payload.neededBy}` : ''}</p></div><span className="text-sm text-body">Allowance: {money(item.payload.allowanceCents)}</span></div><p className="whitespace-pre-wrap break-words text-sm text-body">{item.payload.specification || 'Specification not recorded'}</p>{item.payload.responsiblePerson.name ? <p className="text-xs text-muted">Responsible: {item.payload.responsiblePerson.name}</p> : null}{item.payload.decision.name ? <p className="text-xs text-muted">Decision recorded by {item.payload.decision.name} · {item.payload.decision.date}</p> : null}
      {!props.readOnly ? <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setEditing({ id: item.itemId, payload: structuredClone(item.payload) })}>Edit selection / decision</button><button type="button" className={button} onClick={() => onCreateChange(item.itemId, item.payload)}>Create change from selection</button></div> : null}<AttachmentList parent={{ kind: 'selection', itemId: item.itemId }} props={props} /></li>)}</ul>
  </Panel>;
}
