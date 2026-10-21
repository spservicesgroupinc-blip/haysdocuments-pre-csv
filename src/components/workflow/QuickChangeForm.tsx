import { useRef, useState } from 'react';
import { blankDecision, newId, validatePayload, type ChangePayload } from '../../types/workflow';
import { ActionState, Field, Message, button, control, money, primary, readCents, useAction, type WorkflowWorkspaceProps } from './shared';

interface QuickDraft { id: string; scope: string; amount: string; days: string; insuranceRelated: boolean }
const emptyDraft = (): QuickDraft => ({ id: newId(), scope: '', amount: '', days: '0', insuranceRelated: true });

function recoverDraft(key: string): QuickDraft {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value && typeof value.id === 'string' && typeof value.scope === 'string' && typeof value.amount === 'string' && typeof value.days === 'string' && typeof value.insuranceRelated === 'boolean') return value;
  } catch { /* The form remains usable when browser storage is unavailable. */ }
  return emptyDraft();
}

export function QuickChangeForm({ props, onComplete, onClose }: {
  props: WorkflowWorkspaceProps;
  onComplete: (submitted: boolean) => void;
  onClose: () => void;
}) {
  const storageKey = `hays.quick-change.v1:${props.actorEmail || ''}:${props.job.recordId || props.job.id}`;
  const [draft, setDraft] = useState(() => recoverDraft(storageKey));
  const [reviewing, setReviewing] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const action = useAction();
  const saving = useRef(false);

  function change(patch: Partial<QuickDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  }

  function payload(submitted: boolean): ChangePayload {
    if (!props.job.customer.customerName.trim() || !props.job.customer.jobNumber.trim()) throw new Error('Open the job details above and add the customer / job name and job number before saving this change.');
    const amountCents = readCents(draft.amount);
    if (amountCents === null) throw new Error('Enter the change amount. Use zero for a time-only change.');
    const value: ChangePayload = {
      number: '', scope: draft.scope.trim(), amountCents, addedDays: Number(draft.days || '0'),
      insuranceRelated: draft.insuranceRelated, lifecycle: submitted ? 'submitted' : 'draft',
      customerDecision: blankDecision(), carrierDecision: { ...blankDecision(), status: draft.insuranceRelated ? 'pending' : 'not_applicable' },
      attachmentIds: [], linkedSelectionIds: [], documentArtifactId: null,
    };
    validatePayload('change', value);
    return value;
  }

  async function save(submitted: boolean) {
    if (saving.current || props.readOnly) return;
    saving.current = true;
    try {
      await props.onSave('change', draft.id, payload(submitted));
      try { localStorage.removeItem(storageKey); } catch { /* The shared save has already succeeded. */ }
      onComplete(submitted);
    } finally { saving.current = false; }
  }

  return <section className="space-y-4 rounded-xl border border-brand-line bg-surface p-4 sm:p-5" aria-labelledby="quick-change-heading">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-brand-copy-strong">{reviewing ? 'Step 2 of 2 · Review' : 'Step 1 of 2 · Describe the change'}</p>
      <h2 id="quick-change-heading" className="mt-1 text-xl font-semibold text-primary">{reviewing ? 'Review change order' : 'Quick change order'}</h2>
      <p className="mt-1 text-sm text-muted">{reviewing ? 'Check the job, scope, and amount before submitting to the shared change register.' : 'Enter the scope and price. Save a draft or review it for submission.'}</p></div>
    {storageError ? <Message error>Automatic draft recovery is unavailable. Save this draft before leaving the page.</Message> : null}
    <form onSubmit={event => { event.preventDefault(); void action.run(async () => { payload(false); setReviewing(true); }); }}>
      <fieldset disabled={action.busy || props.readOnly} className="min-w-0 space-y-4">
        {reviewing ? <div className="space-y-4 rounded-lg border border-line bg-canvas p-4">
          <div><p className="text-xs text-muted">Customer / job</p><p className="font-semibold text-primary">{props.job.customer.customerName} · {props.job.customer.jobNumber}</p></div>
          <div><p className="text-xs text-muted">Scope of change</p><p className="whitespace-pre-wrap break-words text-sm text-body">{draft.scope}</p></div>
          <div className="flex flex-wrap gap-x-8 gap-y-3"><div><p className="text-xs text-muted">Change amount</p><p className="text-lg font-semibold text-primary">{money(readCents(draft.amount))}</p></div><div><p className="text-xs text-muted">Additional calendar days</p><p className="font-semibold text-primary">{draft.days || '0'}</p></div></div>
          <p className="text-sm text-secondary">{draft.insuranceRelated ? 'Insurance-related change / supplement' : 'Customer-paid change'}</p>
          <p className="text-xs text-muted">Submission records the change for review. Customer authorization and issuing the final document are separate steps.</p>
        </div> : <>
          <Field label="What needs to change?"><textarea className={control} rows={4} required maxLength={8000} placeholder="Describe the additional work, location, materials, and reason for the change." value={draft.scope} onChange={event => change({ scope: event.target.value })} /></Field>
          <Field label="Change amount ($)" help="Enter a negative amount for a credit, or zero for a time-only change."><input className={control} type="number" inputMode="decimal" required step="0.01" placeholder="0.00" value={draft.amount} onChange={event => change({ amount: event.target.value })} /></Field>
          <details className="rounded-lg border border-line p-3"><summary className="min-h-8 cursor-pointer text-sm font-semibold text-body">Schedule & insurance details</summary><div className="mt-3 space-y-3">
            <Field label="Additional calendar days"><input className={control} type="number" inputMode="numeric" min={0} step={1} value={draft.days} onChange={event => change({ days: event.target.value })} /></Field>
            <label className="flex min-h-11 items-center gap-3 text-sm text-body"><input type="checkbox" className="h-5 w-5 accent-red-600" checked={draft.insuranceRelated} onChange={event => change({ insuranceRelated: event.target.checked })} />Insurance-related change / supplement</label>
          </div></details>
        </>}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {reviewing ? <><button type="button" className={primary} onClick={() => void action.run(() => save(true))}>Submit change order</button><button type="button" className={button} onClick={() => { setReviewing(false); action.clear(); }}>Back to edit</button></> : <><button type="submit" className={primary}>Review change order</button><button type="button" className={button} onClick={() => void action.run(() => save(false))}>Save change draft</button></>}
          <button type="button" className={button} onClick={onClose}>Close</button>
        </div>
        {action.busy ? <p role="status" className="text-sm text-muted">Saving on this device…</p> : null}
      </fieldset>
    </form>
    <ActionState action={action} />
  </section>;
}
