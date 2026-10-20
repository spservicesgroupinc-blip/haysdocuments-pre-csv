import { useState } from 'react';
import { authorizedContractTotal, itemOf, validatePayload, workflowOf } from '../../types/workflow';
import { ActionState, Field, Panel, control, dollars, grid, money, primary, readCents, useAction, type WorkflowWorkspaceProps } from './shared';

export function ContractBaseline(props: WorkflowWorkspaceProps) {
  const workflow = workflowOf(props.job, props.items);
  const changes = itemOf(props.items, 'change');
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState('');
  const [opening, setOpening] = useState('0.00');
  const [reviewed, setReviewed] = useState(false);
  const action = useAction();
  const frozen = changes.some(item => !!item.payload.documentArtifactId);
  const customerChanges = changes.filter(item => item.payload.lifecycle !== 'void' && item.payload.customerDecision.status === 'approved').reduce((total, item) => total + item.payload.amountCents, 0);
  const carrierChanges = changes.filter(item => item.payload.lifecycle !== 'void' && item.payload.carrierDecision.status === 'approved').reduce((total, item) => total + item.payload.amountCents, 0);
  async function save() {
    const contractBaseAmountCents = readCents(base);
    if (contractBaseAmountCents === null || !reviewed) throw new Error('Enter the contract base and explicitly confirm the baseline review.');
    const payload = { ...workflow, contractBaseAmountCents, openingPreviousChangesCents: readCents(opening) ?? 0, baselineReviewed: true };
    validatePayload('workflow', payload);
    await props.onSave('workflow', itemOf(props.items, 'workflow')[0]?.itemId ?? `workflow:${props.job.recordId || props.job.id}`, payload);
    setEditing(false);
  }
  function begin() {
    const suggestion = props.job.changeOrder.originalContractSum !== '' ? props.job.changeOrder.originalContractSum : props.job.financials.totalApprovedRcv;
    setBase(dollars(workflow.contractBaseAmountCents ?? (suggestion === '' ? null : Math.round(suggestion * 100))));
    setOpening(dollars(workflow.baselineReviewed ? workflow.openingPreviousChangesCents : Math.round((props.job.changeOrder.netPreviousChanges || 0) * 100)));
    setReviewed(workflow.baselineReviewed); setEditing(true);
  }
  return <Panel title="Contract baseline" description="Review the original contract and brought-forward changes before issuing a change. The payment schedule is maintained separately.">
    <dl className={grid}>{[['Contract base', money(workflow.contractBaseAmountCents)], ['Brought-forward changes', money(workflow.openingPreviousChangesCents)], ['Customer-authorized changes', money(customerChanges)], ['Authorized contract total', money(authorizedContractTotal(workflow, changes))], ['Carrier-approved changes', money(carrierChanges)]].map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-muted">{label}</dt><dd className="mt-1 text-sm font-semibold text-primary">{value}</dd></div>)}</dl>
    <p className="text-xs text-muted">{workflow.baselineReviewed ? 'Baseline review recorded.' : 'Baseline review required. Insurance RCV is only a suggested starting value.'}{frozen ? ' This baseline is frozen because a change has been issued.' : ''}</p>
    {!props.readOnly && !editing && !frozen ? <button className={primary} type="button" onClick={begin}>{workflow.baselineReviewed ? 'Review baseline' : 'Set and review baseline'}</button> : null}
    {editing ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void action.run(save, 'Contract baseline saved on this device.'); }}><fieldset className="min-w-0 space-y-3" disabled={props.readOnly || action.busy || frozen}><div className={grid}><Field label="Original contract base ($)"><input className={control} type="number" step="0.01" value={base} required onChange={event => setBase(event.target.value)} /></Field><Field label="Brought-forward previous changes ($)" help="Exclude changes already entered in this register to avoid counting them twice."><input className={control} type="number" step="0.01" value={opening} onChange={event => setOpening(event.target.value)} /></Field></div><label className="flex min-h-11 items-center gap-3 text-sm text-body"><input className="h-5 w-5 accent-red-600" type="checkbox" checked={reviewed} required onChange={event => setReviewed(event.target.checked)} />I reviewed the contract base and previous changes.</label><button className={primary}>{action.busy ? 'Saving…' : 'Save reviewed baseline'}</button><button className="ml-3 min-h-11 px-2 text-sm text-body" type="button" onClick={() => setEditing(false)}>Cancel</button></fieldset><ActionState action={action} /></form> : <ActionState action={action} />}
  </Panel>;
}
