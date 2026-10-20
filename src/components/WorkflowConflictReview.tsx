import { useEffect, useState } from 'react';
import { getCoreConflicts, resolveCoreConflict, getSyncState, subscribeSyncState } from '../services/jobSync';
import type { RestorationJobData } from '../types/jobData';
import type { OutboxOp } from '../services/localDb';
import type { WorkflowConflict } from '../services/workflowStore';

function Compare({ local, server }: { local: unknown; server: unknown }) {
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">{[['Your device copy', local], ['Current shared copy', server]].map(([label, value]) => <div key={String(label)} className="min-w-0"><h3 className="text-sm font-semibold text-primary">{String(label)}</h3><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-3 text-xs text-body">{JSON.stringify(value, null, 2)}</pre></div>)}</div>;
}
export function WorkflowConflictReview({ conflicts, onResolve, onCoreResolved }: { conflicts: WorkflowConflict[]; onResolve: (itemId: string, choice: 'local' | 'server') => Promise<void>; onCoreResolved: (job: RestorationJobData) => void }) {
  const [core, setCore] = useState<OutboxOp[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const load = () => { void getCoreConflicts().then(setCore).catch(() => {}); }; load(); return subscribeSyncState(load); }, []);
  async function resolve(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); setCore(await getCoreConflicts()); } catch (err) { setError(err instanceof Error ? err.message : 'Could not resolve this conflict.'); } finally { setBusy(false); } }
  if (!core.length && !conflicts.length) return null;
  const button = 'min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-primary disabled:opacity-50';
  return <section className="my-4 min-w-0 space-y-4 rounded-xl border border-warning-line bg-warning-tint p-3 sm:p-5" aria-label="Changes needing review"><h2 className="text-base font-semibold text-primary">Changes need review</h2><p className="text-sm text-body">Your work is saved on this device. Review both copies before choosing which version to share.</p>{error ? <p role="alert" className="text-sm text-danger-copy">{error}</p> : null}
    {core.map(op => <details key={op.id} open className="min-w-0 space-y-3"><summary className="min-h-11 font-semibold text-primary">Job {op.job?.customer?.jobNumber || op.recordId}</summary><Compare local={op.job} server={op.conflictRecord} /><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} type="button" onClick={() => void resolve(async () => { const job = await resolveCoreConflict(op.recordId, 'server'); if (job) onCoreResolved(job); })}>Use shared copy</button><button className={button} disabled={busy} type="button" onClick={() => void resolve(async () => { const job = await resolveCoreConflict(op.recordId, 'local'); if (job) onCoreResolved(job); })}>Save reviewed device copy</button></div></details>)}
    {conflicts.map(conflict => <details key={conflict.key} open className="min-w-0 space-y-3"><summary className="min-h-11 font-semibold text-primary">{conflict.local.kind} update</summary><Compare local={conflict.local.payload} server={conflict.current.payload} /><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} type="button" onClick={() => void resolve(() => onResolve(conflict.itemId, 'server'))}>Use shared version</button><button className={button} disabled={busy} type="button" onClick={() => void resolve(() => onResolve(conflict.itemId, 'local'))}>Save reviewed device version</button></div></details>)}
  </section>;
}
