import { useEffect, useState } from 'react';
import { itemOf, validatePayload, type ChangePayload } from '../../types/workflow';
import { ActionState, DecisionFields, DraftNotice, Field, Message, button, control, dollars, grid, primary, readCents, useAction, useDraft, type WorkflowWorkspaceProps } from './shared';

export function ChangeEditor({ id, source, props, onClose, isNew = false }: { id: string; source: ChangePayload; props: WorkflowWorkspaceProps; onClose: () => void; isNew?: boolean }) {
  const form = useDraft(source, id);
  const [amount, setAmount] = useState(() => isNew ? '' : dollars(source.amountCents));
  const action = useAction();
  const draft = form.draft;
  const frozen = !!source.documentArtifactId || !!source.number;
  useEffect(() => { if (!form.dirty && !isNew) setAmount(dollars(source.amountCents)); }, [source.amountCents, form.dirty, isNew]);
  const evidence = itemOf(props.items, 'attachment').filter(item => item.payload.uploadState === 'ready');
  const selections = itemOf(props.items, 'selection');
  async function save() {
    form.assertCurrent();
    const amountCents = readCents(amount);
    if (amountCents === null) throw new Error('Enter the reviewed change amount. Use zero for a time-only change.');
    const payload = { ...draft, amountCents };
    validatePayload('change', payload);
    await props.onSave('change', id, payload); onClose();
  }
  return <form className="space-y-4 rounded-lg border border-line p-3" onSubmit={event => { event.preventDefault(); void action.run(save); }}>
    <DraftNotice form={form} />{frozen ? <Message>This issued document is frozen. Record decisions here; create an amendment to change its scope, amount, or days.</Message> : null}
    {source.predecessorId ? <p className="text-xs text-muted">Amendment linked to its prior change. Enter only the additional amount or credit.</p> : null}
    <fieldset disabled={props.readOnly || action.busy} className="min-w-0 space-y-4">
      <p className="text-xs text-muted">{draft.number ? `Change ${draft.number}` : 'Draft ID retained. A number is assigned by the server on submission.'}</p>
      <fieldset disabled={frozen} className="min-w-0 space-y-4"><Field label="Scope of this change"><textarea className={control} required rows={4} maxLength={8000} value={draft.scope} onChange={event => form.change({ ...draft, scope: event.target.value })} /></Field>
      <div className={grid}><Field label="Change amount ($)" help="Positive adds work; a negative amount is a credit. Zero supports time-only changes."><input className={control} type="number" step="0.01" value={amount} required onChange={event => { setAmount(event.target.value); form.change(draft); }} /></Field><Field label="Additional calendar days"><input className={control} type="number" min={0} step={1} value={draft.addedDays} required onChange={event => form.change({ ...draft, addedDays: event.target.value === '' ? 0 : Number(event.target.value) })} /></Field></div>
      <label className="flex min-h-11 items-center gap-3 text-sm text-body"><input className="h-5 w-5 accent-red-600" type="checkbox" checked={draft.insuranceRelated} onChange={event => form.change({ ...draft, insuranceRelated: event.target.checked, carrierDecision: { ...draft.carrierDecision, status: event.target.checked ? (draft.carrierDecision.status === 'not_applicable' ? 'pending' : draft.carrierDecision.status) : 'not_applicable' } })} />Insurance-related change / supplement</label>
      {selections.length ? <Field label="Related selections"><select className={`${control} min-h-24`} multiple value={draft.linkedSelectionIds} onChange={event => form.change({ ...draft, linkedSelectionIds: Array.from(event.target.selectedOptions, option => option.value) })}>{selections.map(item => <option key={item.itemId} value={item.itemId}>{item.payload.room ? `${item.payload.room} · ` : ''}{item.payload.item}</option>)}</select></Field> : null}</fieldset>
      <Field label="Register status"><select className={control} value={draft.lifecycle} onChange={event => form.change({ ...draft, lifecycle: event.target.value as ChangePayload['lifecycle'] })}><option value="draft" disabled={frozen}>Draft</option><option value="submitted">Submitted</option><option value="closed">Closed</option><option value="void">Void</option></select></Field>
      <div className={grid}><DecisionFields title="Customer decision" value={draft.customerDecision} options={['pending', 'approved', 'rejected']} attachments={evidence} onChange={customerDecision => form.change({ ...draft, customerDecision })} /><DecisionFields title="Carrier decision" value={draft.carrierDecision} options={draft.insuranceRelated ? ['pending', 'approved', 'rejected'] : ['not_applicable', 'pending', 'approved', 'rejected']} attachments={evidence} onChange={carrierDecision => form.change({ ...draft, carrierDecision })} /></div>
      <p className="text-xs text-muted">Submission and carrier approval do not establish customer authorization. Recorded decisions do not create electronic signatures.</p>
      <div className="flex flex-wrap gap-2"><button className={primary}>{action.busy ? 'Saving…' : 'Save change'}</button><button className={button} type="button" onClick={onClose}>Cancel</button></div></fieldset><ActionState action={action} />
  </form>;
}
