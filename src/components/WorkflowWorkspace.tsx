import { useEffect, useState } from 'react';
import { itemOf, type SelectionPayload } from '../types/workflow';
import { HandoffSection } from './workflow/HandoffSection';
import { UpdatesSection } from './workflow/UpdatesSection';
import { SelectionsSection } from './workflow/SelectionsSection';
import { ChangesSection, type NewSelectionChange } from './workflow/ChangesSection';
import { CloseoutSection } from './workflow/CloseoutSection';
import { ActionState, Field, Message, button, control, useAction, type WorkflowWorkspaceProps } from './workflow/shared';

export type { WorkflowWorkspaceProps } from './workflow/shared';
const sections = { updates: 'Updates', handoff: 'Handoff', selections: 'Selections', changes: 'Changes', closeout: 'Closeout' } as const;
type Section = keyof typeof sections;

export function WorkflowWorkspace(props: WorkflowWorkspaceProps) {
  const [section, setSection] = useState<Section>(props.section ?? 'updates');
  const [selectionChange, setSelectionChange] = useState<NewSelectionChange | null>(null);
  const action = useAction();
  const jobId = props.job.recordId || props.job.id;
  useEffect(() => { setSection(props.section ?? 'updates'); }, [props.section, jobId]);
  useEffect(() => { setSelectionChange(null); }, [jobId]);
  function createChange(id: string, selection: SelectionPayload) { setSelectionChange({ id, selection }); setSection('changes'); props.onNavigate?.('changeOrder'); }
  const counts = { updates: itemOf(props.items, 'activity').length, handoff: null, selections: itemOf(props.items, 'selection').length, changes: itemOf(props.items, 'change').length, closeout: null };
  return <div className="min-w-0 space-y-4" aria-busy={props.loading}>
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3 sm:p-4"><div className="min-w-0 flex-1">{props.section ? <p className="py-2 text-sm font-semibold text-primary">{sections[section]}{counts[section] !== null ? ` (${counts[section]})` : ''}</p> : <Field label="Production workspace"><select className={control} value={section} onChange={event => setSection(event.target.value as Section)}>{(Object.keys(sections) as Section[]).map(value => <option key={value} value={value}>{sections[value]}{counts[value] !== null ? ` (${counts[value]})` : ''}</option>)}</select></Field>}</div><button className={button} type="button" disabled={props.loading || action.busy} onClick={() => void action.run(props.onRefresh)}>Refresh</button></div>
    <p className="text-xs text-muted" role="status">{props.fromCache ? 'Showing the saved device copy' : 'Shared information refreshed'}{props.lastRefreshedAt ? ` · Last successful refresh ${new Date(props.lastRefreshedAt).toLocaleString('en-US', { timeZone: 'America/Indianapolis' })}` : ''}.</p>
    {props.error ? <Message error>{props.error}</Message> : null}
    {props.loading ? <p className="text-sm text-muted" role="status">Refreshing shared job information…</p> : null}
    {props.pendingCount > 0 ? <Message>Saved on this device · {props.pendingCount} waiting to sync. Reviewed publication is available after sync.</Message> : null}
    {props.readOnly ? <p className="text-sm text-muted">Read-only workspace. You can review saved information and download available drafts.</p> : null}
    <ActionState action={action} />
    <div key={jobId}>{section === 'updates' ? <UpdatesSection {...props} /> : section === 'handoff' ? <HandoffSection {...props} /> : section === 'selections' ? <SelectionsSection {...props} onCreateChange={createChange} /> : section === 'changes' ? <ChangesSection {...props} newSelectionChange={selectionChange} onSelectionChangeConsumed={() => setSelectionChange(null)} /> : <CloseoutSection {...props} />}</div>
  </div>;
}

export default WorkflowWorkspace;
