import { itemOf, handoffBlockers, validatePayload, workflowOf } from '../../types/workflow';
import { ActionState, ArtifactDownloads, DraftNotice, Field, Message, Panel, button, control, grid, money, primary, useAction, useDraft, type WorkflowWorkspaceProps } from './shared';

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-body">{value || 'Not recorded'}</dd></div>;
}

export function HandoffSection(props: WorkflowWorkspaceProps) {
  const stored = itemOf(props.items, 'workflow')[0];
  const form = useDraft(workflowOf(props.job, props.items), props.job.recordId || props.job.id);
  const action = useAction();
  const exportAction = useAction();
  const { draft } = form;
  const blockers = handoffBlockers(props.job, draft);
  const selections = itemOf(props.items, 'selection').filter(item => item.payload.decision.status !== 'approved');
  const changes = itemOf(props.items, 'change').filter(item => !['closed', 'void'].includes(item.payload.lifecycle));
  const artifacts = itemOf(props.items, 'artifact').filter(item => item.payload.type === 'handoff').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = artifacts[0];
  const sourceRevisions = { [`job:${props.job.recordId || props.job.id}`]: props.job.revision ?? 0, ...Object.fromEntries(props.items.filter(item => !item.deletedAt && item.kind !== 'artifact' && !(item.kind === 'attachment' && item.payload.parent.kind === 'artifact')).map(item => [`${item.kind}:${item.itemId}`, item.revision])) };
  const stale = !!latest && (Object.entries(latest.payload.sourceRevisions).some(([key, revision]) => sourceRevisions[key] !== revision) || Object.keys(sourceRevisions).some(key => !(key in latest.payload.sourceRevisions)));
  async function save() { form.assertCurrent(); validatePayload('workflow', draft); await props.onSave('workflow', stored?.itemId ?? `workflow:${props.job.recordId || props.job.id}`, draft); form.saved(); }
  async function publish() {
    if (form.dirty) throw new Error('Save the handoff review, wait for sync, then publish.');
    if (blockers.length && !draft.handoffOverrideReason.trim()) throw new Error('Resolve the readiness items or enter and save an override reason.');
    await props.onExport('handoff', { audience: 'internal', final: true });
  }
  return <div className="space-y-4"><Panel title="Production handoff" description="Internal use only. The summary reuses the current job details; publishing freezes a reviewed version.">
    {latest ? <Message>{stale ? 'Handoff needs review: the job has changed since the published version.' : `Latest handoff: ${latest.payload.generatedAt.slice(0, 10)} · ${latest.payload.reviewState === 'final' ? 'Published' : 'Draft'}`}</Message> : null}
    <dl className={grid}>
      <Summary label="Customer / property" value={[props.job.customer.customerName, props.job.customer.lossAddress, props.job.customer.mainPhone || props.job.customer.mobilePhone, props.job.customer.email].filter(Boolean).join('\n')} />
      <Summary label="Claim contact" value={props.job.checklist.isSelfPay ? 'Self-pay job' : [props.job.insurance.carrier, props.job.insurance.claimNumber, props.job.insurance.primaryAdjuster, props.job.insurance.adjusterPhone, props.job.insurance.adjusterEmail].filter(Boolean).join('\n')} />
      <Summary label="Production team" value={Object.entries(props.job.team).filter(([, name]) => name).map(([role, name]) => `${role.replace(/([A-Z])/g, ' $1')}: ${name}`).join('\n')} />
      <Summary label="Approved insurance RCV / deductible" value={`${money(props.job.financials.totalApprovedRcv === '' ? null : Math.round(props.job.financials.totalApprovedRcv * 100))} / ${money(props.job.financials.deductible === '' ? null : Math.round(props.job.financials.deductible * 100))}`} />
      <Summary label="Scope summary" value={props.job.productionNotes.scopeSummary || props.job.insurance.lossDescription} />
      <Summary label="Materials / equipment" value={props.job.productionNotes.materialsAndEquipment} />
      <Summary label="Schedule / site access" value={props.job.productionNotes.scheduleAndAccess} />
      <Summary label="Safety" value={props.job.productionNotes.safetyConsiderations} />
    </dl>
    <div className={grid}><div><h3 className="text-sm font-semibold text-primary">Outstanding selections ({selections.length})</h3><ul className="mt-2 space-y-1 text-sm text-body">{selections.map(item => <li key={item.itemId}>{item.payload.room ? `${item.payload.room} · ` : ''}{item.payload.item}{item.payload.neededBy ? ` · Needed ${item.payload.neededBy}` : ''}</li>)}</ul>{!selections.length ? <p className="mt-1 text-sm text-muted">No pending selections.</p> : null}</div><div><h3 className="text-sm font-semibold text-primary">Open changes ({changes.length})</h3><ul className="mt-2 space-y-1 text-sm text-body">{changes.map(item => <li key={item.itemId}>{item.payload.number || 'Draft change'} · {item.payload.scope}</li>)}</ul>{!changes.length ? <p className="mt-1 text-sm text-muted">No open changes.</p> : null}</div></div>
  </Panel>
  <Panel title="Handoff readiness" description="Recorded confirmations help the PM review the job; they do not establish payment or authorization.">
    {blockers.length ? <div className="rounded-lg border border-warning-line bg-warning-tint p-3 text-warning-copy"><h3 className="text-sm font-semibold">Needs review</h3><ul className="mt-2 list-inside list-disc space-y-1 text-sm">{blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul><p className="mt-2 text-xs">Review the missing customer, claim, or approved amount fields in Job details, and scope in Production notes.</p>{props.onNavigate ? <div className="mt-2 flex flex-wrap gap-2">{(['customer', 'insurance', 'financials', 'productionNotes'] as const).map(section => <button className={button} type="button" key={section} onClick={() => props.onNavigate?.(section)}>{({ customer: 'Customer details', insurance: 'Claim details', financials: 'Approved amount', productionNotes: 'Scope notes' })[section]}</button>)}</div> : null}</div> : <Message>All handoff readiness items are recorded.</Message>}
    <form onSubmit={event => { event.preventDefault(); void action.run(save, 'Handoff review saved on this device. Wait for sync before publishing.'); }} className="space-y-4"><DraftNotice form={form} /><fieldset disabled={props.readOnly || action.busy} className="min-w-0 space-y-4">
      <label className="flex min-h-11 items-center gap-3 text-sm text-body"><input className="h-5 w-5 accent-red-600" type="checkbox" checked={draft.confirmations.contractSigned} onChange={event => form.change({ ...draft, confirmations: { ...draft.confirmations, contractSigned: event.target.checked } })} />Contract recorded signed</label>
      <label className="flex min-h-11 items-center gap-3 text-sm text-body"><input className="h-5 w-5 accent-red-600" type="checkbox" checked={draft.confirmations.scopeReviewed} onChange={event => form.change({ ...draft, confirmations: { ...draft.confirmations, scopeReviewed: event.target.checked } })} />Approved scope reviewed</label>
      <div className={grid}><Field label="Initial payment status"><select className={control} value={draft.confirmations.initialPayment} onChange={event => form.change({ ...draft, confirmations: { ...draft.confirmations, initialPayment: event.target.value as typeof draft.confirmations.initialPayment } })}><option value="pending">Pending review</option><option value="recorded">Recorded</option><option value="not_applicable">Not applicable</option></select></Field><Field label="Mortgage prerequisites"><select className={control} value={draft.confirmations.mortgageReviewed} onChange={event => form.change({ ...draft, confirmations: { ...draft.confirmations, mortgageReviewed: event.target.value as typeof draft.confirmations.mortgageReviewed } })}><option value="pending">Pending review</option><option value="reviewed">Reviewed</option><option value="not_applicable">Not applicable</option></select></Field></div>
      <Field label="Readiness override reason" help="Required to publish while readiness items remain unresolved. The reason appears in the handoff history."><textarea className={control} rows={2} maxLength={8000} value={draft.handoffOverrideReason} onChange={event => form.change({ ...draft, handoffOverrideReason: event.target.value })} /></Field>
      <button className={primary} type="submit">{action.busy ? 'Saving…' : 'Save handoff review'}</button></fieldset><ActionState action={action} /></form>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={exportAction.busy} onClick={() => void exportAction.run(() => props.onExport('handoff', { audience: 'internal', final: false }))}>Download draft handoff</button><button type="button" className={primary} disabled={props.readOnly || exportAction.busy || props.pendingCount > 0 || form.dirty || (!!blockers.length && !draft.handoffOverrideReason.trim())} onClick={() => void exportAction.run(publish, 'Handoff publication completed. Its source is frozen.')}>Publish reviewed handoff</button></div>
    {form.dirty ? <p className="text-xs text-warning-copy">The live summary uses saved job data. Save your review before publishing.</p> : null}<ActionState action={exportAction} />
    {artifacts.length ? <details className="rounded-lg border border-line p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-body">Published handoff files ({artifacts.length})</summary><div className="space-y-3">{artifacts.map(artifact => <ArtifactDownloads key={artifact.itemId} artifact={artifact} props={props} />)}</div></details> : null}
  </Panel></div>;
}
