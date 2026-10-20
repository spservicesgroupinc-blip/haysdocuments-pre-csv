import { useState } from 'react';
import { STAGES, STAGE_LABELS, closeoutBlockers, createCloseout, isOverdue, itemOf, newId, validatePayload, workflowOf, type JobStage } from '../types/workflow';
import { ActionState, Field, Message, Panel, control, grid, primary, useAction, useDraft, type WorkflowWorkspaceProps } from './workflow/shared';

export type WorkflowProgressProps = Pick<WorkflowWorkspaceProps, 'job' | 'items' | 'readOnly' | 'onSave'> & Partial<Pick<WorkflowWorkspaceProps, 'pendingCount' | 'error'>>;

export function WorkflowProgress({ job, items, readOnly, onSave, pendingCount = 0, error }: WorkflowProgressProps) {
  const stored = itemOf(items, 'workflow')[0];
  const form = useDraft(workflowOf(job, items), job.recordId || job.id);
  const { draft } = form;
  const action = useAction();
  const [actionId] = useState(newId);
  const [expanded, setExpanded] = useState(false);
  const next = draft.nextAction;
  const inactive = draft.stage === 'complete' || draft.stage === 'cancelled';
  const overdue = !inactive && next && !next.completedAt && isOverdue(next.dueDate);
  function updateAction(field: 'title' | 'name' | 'email' | 'dueDate', value: string) {
    const valueNext = next ?? { id: actionId, title: '', responsiblePerson: { name: '', email: '' }, dueDate: '' };
    form.change({ ...draft, nextAction: field === 'name' || field === 'email' ? { ...valueNext, responsiblePerson: { ...valueNext.responsiblePerson, [field]: value } } : { ...valueNext, [field]: value } });
  }
  async function save() {
    const payload = { ...draft, nextAction: draft.nextAction?.title.trim() ? draft.nextAction : null };
    if (payload.stage === 'complete') {
      const closeout = itemOf(items, 'closeout')[0]?.payload ?? createCloseout();
      if ((!closeout.completionDate || closeoutBlockers(closeout).length) && !closeout.completionOverrideReason.trim()) throw new Error('Review Closeout and resolve outstanding items or record an override before marking complete.');
    }
    validatePayload('workflow', payload);
    await onSave('workflow', stored?.itemId ?? 'workflow', payload);
    form.saved(); setExpanded(false);
  }
  return <Panel title="Job progress" description="One stage and one clear next step for the team.">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-primary">{STAGE_LABELS[draft.stage]}</p><p className="mt-1 break-words text-sm text-body">{next?.title || 'No next action recorded'}{next?.completedAt ? ' · Completed' : ''}</p>{next?.responsiblePerson.name ? <p className="mt-1 text-xs text-muted">{next.responsiblePerson.name}{next.dueDate ? ` · Due ${next.dueDate}` : ''}{overdue ? ' · Overdue' : ''}</p> : null}{draft.stage === 'on_hold' ? <p className="mt-1 text-sm text-warning-copy">On hold: {draft.holdReason}</p> : null}</div>
      <button type="button" className="min-h-11 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-body focus-visible:ring-2 focus-visible:ring-red-500" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Close editor' : readOnly ? 'View details' : 'Edit progress'}</button></div>
    {error ? <Message error>{error}</Message> : null}
    {pendingCount > 0 ? <p role="status" className="text-xs text-warning-copy">Saved on this device · {pendingCount} waiting to sync</p> : null}
    {expanded ? <form onSubmit={event => { event.preventDefault(); void action.run(save, 'Saved on this device. Sync status is shown above.'); }} className="space-y-4">
      <fieldset disabled={readOnly || action.busy} className="min-w-0 space-y-4">
        <Field label="Job stage"><select className={control} value={draft.stage} onChange={event => form.change({ ...draft, stage: event.target.value as JobStage })}>{STAGES.map(stage => <option value={stage} key={stage}>{STAGE_LABELS[stage]}</option>)}</select></Field>
        {draft.stage === 'on_hold' ? <Field label="Hold reason"><textarea className={control} required rows={2} maxLength={8000} value={draft.holdReason} onChange={event => form.change({ ...draft, holdReason: event.target.value })} /></Field> : null}
        <Field label="Next action" help="Leave blank to clear the action."><input className={control} maxLength={500} value={next?.title ?? ''} placeholder="Confirm the flooring selection" onChange={event => updateAction('title', event.target.value)} /></Field>
        <div className={grid}><Field label="Responsible person"><input className={control} required={!!next?.title.trim()} maxLength={200} value={next?.responsiblePerson.name ?? ''} onChange={event => updateAction('name', event.target.value)} /></Field><Field label="Responsible person's email" help="Use their account email for the Mine filter."><input className={control} type="email" maxLength={254} value={next?.responsiblePerson.email ?? ''} onChange={event => updateAction('email', event.target.value)} /></Field><Field label="Due date"><input className={control} type="date" value={next?.dueDate ?? ''} onChange={event => updateAction('dueDate', event.target.value)} /></Field></div>
        {next?.title.trim() ? <label className="flex min-h-11 items-center gap-3 text-sm text-body"><input className="h-5 w-5 accent-red-600" type="checkbox" checked={!!next.completedAt} onChange={event => form.change({ ...draft, nextAction: { ...next, completedAt: event.target.checked ? new Date().toISOString() : undefined } })} />Action completed</label> : null}
        <button className={primary} type="submit">{action.busy ? 'Saving…' : 'Save progress'}</button>
      </fieldset><ActionState action={action} />
    </form> : null}
  </Panel>;
}

export default WorkflowProgress;
