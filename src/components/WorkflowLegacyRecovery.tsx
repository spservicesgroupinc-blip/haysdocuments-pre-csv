import { useState } from 'react';
import { fetchLegacyDraftRecovery, type RestoredDraft } from '../services/jobSync';
import { ActionState, Message, button, primary, useAction } from './workflow/shared';

export function WorkflowLegacyRecovery({ readOnly, onRestore }: { readOnly: boolean; onRestore: (draft: RestoredDraft) => Promise<void> }) {
  const [copy, setCopy] = useState<RestoredDraft | null>(null);
  const [checked, setChecked] = useState(false);
  const action = useAction();
  return <details className="rounded-xl border border-line bg-surface p-3 text-sm text-body">
    <summary className="min-h-11 cursor-pointer font-semibold">Recover an older shared workspace</summary>
    <div className="space-y-3 pt-2"><p>The legacy shared copy may belong to another team member. Preview it before restoring. It never replaces your current work automatically.</p>
      <button type="button" className={button} disabled={action.busy} onClick={() => void action.run(async () => { setCopy(await fetchLegacyDraftRecovery() ?? null); setChecked(true); })}>Check for legacy recovery copy</button>
      {checked && !copy ? <Message>No legacy shared recovery copy was found.</Message> : null}
      {copy ? <div className="space-y-3 rounded-lg border border-line p-3"><dl className="space-y-2"><div><dt className="text-xs text-muted">Customer / job</dt><dd>{copy.job.customer.customerName || 'Unnamed customer'} · {copy.job.customer.jobNumber}</dd></div><div><dt className="text-xs text-muted">Property</dt><dd>{copy.job.customer.lossAddress || 'Not recorded'}</dd></div><div><dt className="text-xs text-muted">Last saved by</dt><dd>{copy.updatedBy || 'Unknown'}{copy.updatedAt ? ` · ${new Date(copy.updatedAt).toLocaleString('en-US', { timeZone: 'America/Indianapolis' })}` : ''}</dd></div></dl>
        {!readOnly ? <><p>Your current workspace will be saved to the job library before opening this recovery copy. Shared-job revision checks still apply when saving recovered work.</p><button type="button" className={primary} disabled={action.busy} onClick={() => void action.run(async () => { await onRestore(copy); setCopy(null); setChecked(false); }, 'The recovery copy is open. Review it before saving changes.')}>Save current work and open recovery copy</button></> : null}
      </div> : null}<ActionState action={action} />
    </div>
  </details>;
}
