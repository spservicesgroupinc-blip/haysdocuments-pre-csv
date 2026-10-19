import React from 'react';
import { ArrowRight, Check, CircleAlert, Cloud, CloudOff, FileInput, FileCheck, FolderOpen, Loader2, MapPin, Plus, UserCircle } from 'lucide-react';
import type { SyncJobSummary } from '../services/localDb';
import type { MissingJobField } from '../services/jobReadiness';
import type { WorkspaceTab } from './Sidebar';

const REQUIRED_FIELD_TOTAL = 6;
const ACTION = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2';

interface HomeScreenProps {
  userName: string | null;
  databaseEmail: string | null;
  jobs: SyncJobSummary[];
  pendingSyncCount: number;
  isOffline: boolean;
  customerName: string;
  jobNumber: string;
  lossAddress: string;
  hasJobInProgress: boolean;
  isDirty: boolean;
  missingFields: MissingJobField[];
  syncError: string | null;
  isSyncing: boolean;
  onNewJob: () => void;
  onContinueJob: () => void;
  onReviewField: (field: MissingJobField) => void;
  onNavigate: (tab: WorkspaceTab) => void;
  onOpenLibrary: () => void;
}

/** Task-first home: open work, the next required action, then the searchable library. */
export const HomeScreen: React.FC<HomeScreenProps> = ({
  userName, databaseEmail, jobs, pendingSyncCount, isOffline, customerName, jobNumber,
  lossAddress, hasJobInProgress, isDirty, missingFields, syncError, isSyncing,
  onNewJob, onContinueJob, onReviewField, onNavigate, onOpenLibrary,
}) => {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = userName?.trim().split(/\s+/)[0] || databaseEmail?.split('@')[0];
  const readyCount = Math.max(0, REQUIRED_FIELD_TOTAL - missingFields.length);
  const activeJobs = jobs.filter((job) => job.status === 'Active').length;
  const syncNeedsAttention = isOffline || Boolean(syncError) || pendingSyncCount > 0;
  const SyncIcon = isOffline ? CloudOff : syncError ? CircleAlert : isSyncing ? Loader2 : Cloud;
  const syncLabel = isOffline ? 'Offline' : syncError ? 'Sync needs attention' : isSyncing ? 'Syncing changes' : pendingSyncCount > 0 ? 'Changes waiting to sync' : 'Connected';
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-5" aria-label="Home">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">{date}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Your job workspace</h1>
          <p className="mt-2 text-sm text-slate-600">{greeting}{name ? `, ${name}` : ''}. Pick up a job or start something new.</p>
        </div>
        <button type="button" onClick={onNewJob} className={`${ACTION} shrink-0 bg-red-700 text-white hover:bg-red-800`}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New job
        </button>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-slate-200 py-3 text-xs">
        <button type="button" onClick={onOpenLibrary} className="inline-flex min-h-8 items-center gap-2 rounded font-medium text-slate-600 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          <span><strong className="font-semibold text-slate-900">{jobs.length}</strong> saved jobs <span className="mx-1 text-slate-300">/</span> <strong className="font-semibold text-slate-900">{activeJobs}</strong> active</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <div role="status" className={`inline-flex items-center gap-2 ${syncNeedsAttention ? 'text-amber-800' : 'text-slate-600'}`}>
          <SyncIcon className={`h-4 w-4 shrink-0 ${isSyncing && !isOffline && !syncError ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
          <span>{syncLabel}{pendingSyncCount > 0 ? ` · ${pendingSyncCount} pending` : ''}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="current-work-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="current-work-title" className="text-xs font-semibold uppercase tracking-wider text-slate-500">{hasJobInProgress ? 'In your workspace' : 'Start a job'}</h2>
            {hasJobInProgress && <span className={`rounded px-2 py-1 text-[11px] font-semibold ${isDirty ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{isDirty ? 'Changes in progress' : 'Current job'}</span>}
          </div>
          {hasJobInProgress ? (
            <>
              <h3 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{customerName || 'Untitled job'}</h3>
              <p className="mt-1 text-xs font-medium text-slate-500">{jobNumber ? `Job ${jobNumber}` : 'No job number yet'}</p>
              <p className="mt-3 flex items-start gap-2 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />{lossAddress || 'Add the loss property address'}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <button type="button" onClick={onContinueJob} className={`${ACTION} bg-slate-900 text-white hover:bg-slate-800`}>Continue job <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" onClick={() => onNavigate('documents')} className={`${ACTION} border border-slate-200 text-slate-700 hover:bg-slate-50`}><FileCheck className="h-4 w-4" aria-hidden="true" />Documents</button>
              </div>
            </>
          ) : (
            <>
              <h3 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">One job record. Every document.</h3>
              <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600">Bring in an estimate or intake notes, then use the same job details for contracts, reports and your production packet.</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <button type="button" onClick={() => onNavigate('intake')} className={`${ACTION} bg-slate-900 text-white hover:bg-slate-800`}><FileInput className="h-4 w-4" aria-hidden="true" />Import job information</button>
                <button type="button" onClick={() => onNavigate('customer')} className={`${ACTION} border border-slate-200 text-slate-700 hover:bg-slate-50`}><UserCircle className="h-4 w-4" aria-hidden="true" />Enter manually</button>
              </div>
            </>
          )}
        </section>

        <section className={`${hasJobInProgress ? '' : 'hidden lg:block'} rounded-xl border border-slate-200 bg-white p-5 sm:p-6`} aria-labelledby="next-step-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="next-step-title" className="text-xs font-semibold uppercase tracking-wider text-slate-500">{hasJobInProgress ? 'Next steps' : 'From intake to documents'}</h2>
            {hasJobInProgress && <span className="text-xs font-semibold tabular-nums text-slate-600">{readyCount} of {REQUIRED_FIELD_TOTAL} required fields</span>}
          </div>
          {hasJobInProgress ? (
            <>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Required job fields" aria-valuenow={readyCount} aria-valuemin={0} aria-valuemax={REQUIRED_FIELD_TOTAL}>
                <div className={`h-full rounded-full ${missingFields.length ? 'bg-red-700' : 'bg-emerald-600'}`} style={{ width: `${readyCount / REQUIRED_FIELD_TOTAL * 100}%` }} />
              </div>
              {missingFields.length > 0 ? (
                <>
                  <p className="mt-3 text-sm text-slate-600">Complete these details before preparing your packet.</p>
                  <ul className="mt-2 divide-y divide-slate-100">
                    {missingFields.slice(0, 3).map((field) => (
                      <li key={field.inputId}><button type="button" onClick={() => onReviewField(field)} className="group flex min-h-11 w-full items-center justify-between gap-3 rounded py-2 text-left text-sm font-medium text-slate-700 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"><span>{field.label}</span><ArrowRight className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-red-700" aria-hidden="true" /></button></li>
                    ))}
                  </ul>
                  {missingFields.length > 3 && <button type="button" onClick={() => onNavigate('documents')} className="mt-2 min-h-9 rounded text-xs font-semibold text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">Review all {missingFields.length} missing fields <span aria-hidden="true">→</span></button>}
                </>
              ) : (
                <div className="mt-5">
                  <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><Check className="h-4 w-4" aria-hidden="true" />Required details complete</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Review the job and choose which documents to prepare.</p>
                  <button type="button" onClick={() => onNavigate('documents')} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded text-sm font-semibold text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">Prepare documents <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              )}
            </>
          ) : (
            <ol className="mt-4 space-y-4">
              {[
                ['01', 'Bring in the job', 'Upload a document or enter the details.'],
                ['02', 'Review the essentials', 'Check the customer, claim and financials.'],
                ['03', 'Prepare your packet', 'Preview, download or save your documents.'],
              ].map(([number, title, detail]) => <li key={number} className="flex gap-3"><span className="pt-0.5 text-xs font-semibold tabular-nums text-red-700">{number}</span><div><p className="text-sm font-semibold text-slate-800">{title}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{detail}</p></div></li>)}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
};
