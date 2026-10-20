import { useEffect, useState } from 'react';
import type { SyncJobSummary } from '../services/localDb';
import { callAuthenticatedAppsScript } from '../services/appsScriptService';
import { cachedWorkflowItems, subscribeWorkflow } from '../services/workflowStore';
import { isOverdue, itemOf, STAGE_LABELS, type JobStage, type NextAction } from '../types/workflow';
import { workflowOwner } from '../services/workflowClient';

export interface WorkflowSummary { jobId: string; stage: JobStage; nextAction: NextAction | null; latestUpdate?: { payload: { note: string } } | null; outstandingSelections?: number; openChanges?: number; openPunchItems?: number }
export function useWorkflowSummaries(jobs: SyncJobSummary[], enabled: boolean, owner: string) {
  const [summaries, setSummaries] = useState<Record<string, WorkflowSummary>>({});
  const ids = jobs.map(job => job.recordId).sort().join('|');
  useEffect(() => {
    let cancelled = false;
    setSummaries({});
    if (!enabled || !owner) return;
    const cacheKey = `hays.workflow.summaries:${owner}`;
    try { const cached = JSON.parse(localStorage.getItem(cacheKey) || '{}'); if (cached && typeof cached === 'object' && !Array.isArray(cached)) setSummaries(cached); } catch { /* optional summary cache */ }
    const refresh = async (network = true) => {
      const result: Record<string, WorkflowSummary> = {};
      if (network && navigator.onLine) {
        try {
          for (let start = 0; start < jobs.length; start += 100) {
            const page = await callAuthenticatedAppsScript<{ summaries: WorkflowSummary[] }>('listJobWorkflowSummaries', { jobIds: jobs.slice(start, start + 100).map(job => job.recordId) });
            if (!Array.isArray(page.summaries)) return;
            for (const summary of page.summaries) if (jobs.some(job => job.recordId === summary.jobId)) result[summary.jobId] = summary;
          }
        } catch { /* cached summaries remain usable offline */ }
      }
      for (const job of jobs) {
        const local = await cachedWorkflowItems(owner, job.recordId);
        const workflow = itemOf(local, 'workflow')[0];
        if (workflow) result[job.recordId] = { ...result[job.recordId], jobId: job.recordId, stage: workflow.payload.stage, nextAction: workflow.payload.nextAction };
      }
      if (!cancelled && owner === workflowOwner()) setSummaries(prior => {
        const merged = { ...prior, ...result };
        try { localStorage.setItem(cacheKey, JSON.stringify(merged)); } catch { /* optional cache */ }
        return merged;
      });
    };
    void refresh();
    const unsubscribe = subscribeWorkflow(() => { void refresh(false); });
    const focus = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('focus', focus); window.addEventListener('online', focus);
    const timer = setInterval(focus, 60000);
    return () => { cancelled = true; unsubscribe(); clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('online', focus); };
  }, [ids, enabled, owner]);
  return summaries;
}

export function WorkflowOverview({ jobs, summaries, owner, onOpen }: { jobs: SyncJobSummary[]; summaries: Record<string, WorkflowSummary>; owner: string; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState('all');
  const actionable = jobs.filter(job => {
    const summary = summaries[job.recordId];
    if (!summary || ['complete', 'cancelled'].includes(summary.stage)) return false;
    const action = summary.nextAction && !summary.nextAction.completedAt ? summary.nextAction : null;
    if (filter === 'mine') return !!action && action.responsiblePerson.email?.toLowerCase() === owner;
    if (filter === 'overdue') return !!action && isOverdue(action.dueDate);
    if (filter === 'waiting') return ['on_hold', 'awaiting_contract'].includes(summary.stage) || !!summary.outstandingSelections;
    return !!action || !!summary.outstandingSelections || !!summary.openPunchItems || ['on_hold', 'awaiting_contract'].includes(summary.stage);
  }).sort((a, b) => (summaries[a.recordId].nextAction?.dueDate || '9999').localeCompare(summaries[b.recordId].nextAction?.dueDate || '9999'));
  const [expanded, setExpanded] = useState(false);
  return <section className="rounded-xl border border-line bg-surface p-3 sm:p-5" aria-label="Needs attention"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold text-primary">Needs attention</h2><label className="flex items-center gap-2 text-sm text-body">Show<select className="min-h-11 rounded-lg border border-line-strong bg-canvas px-3 text-primary" value={filter} onChange={event => { setFilter(event.target.value); setExpanded(false); }}><option value="all">All</option><option value="mine">Mine</option><option value="overdue">Overdue</option><option value="waiting">Waiting</option></select></label></div>
    {actionable.length ? <ul className="mt-3 divide-y divide-line">{actionable.slice(0, expanded ? undefined : 5).map(job => { const summary = summaries[job.recordId], action = summary.nextAction; return <li key={job.recordId} className="py-3"><button className="min-h-11 w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-red-600" type="button" onClick={() => onOpen(job.recordId)}><span className="font-semibold text-primary">{job.customerName || job.jobNumber}</span><span className="ml-2 text-xs text-muted">{STAGE_LABELS[summary.stage]}</span><span className="mt-1 block break-words text-sm text-body">{action && !action.completedAt ? `${action.title} · ${action.responsiblePerson.name}${action.dueDate ? ` · ${action.dueDate}${isOverdue(action.dueDate) ? ' · Overdue' : ''}` : ''}` : 'Review outstanding decisions and job updates'}</span></button></li>; })}</ul> : <p className="mt-3 text-sm text-muted">No items match this view.</p>}
    {!expanded && actionable.length > 5 ? <button className="mt-2 min-h-11 text-sm font-semibold text-brand-copy-strong" type="button" onClick={() => setExpanded(true)}>View all {actionable.length}</button> : null}
  </section>;
}
