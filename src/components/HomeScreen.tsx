import React from 'react';
import {
  ArrowRight,
  Check,
  CircleAlert,
  Cloud,
  CloudOff,
  FilePlus2,
  FolderOpen,
  ListChecks,
  ClipboardList,
  Plus,
} from 'lucide-react';
import type { SyncJobSummary } from '../services/localDb';
import type { MissingJobField } from '../services/jobReadiness';

/** All required fields across the job record — used by the readiness card. */
const REQUIRED_FIELD_TOTAL = 6;

function greetingForHour(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

const SECTION_LABELS: Record<string, string> = {
  customer: 'Customer & Property',
  insurance: 'Insurance & Claim',
  financials: 'Financials',
};

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
  onNewJob: () => void;
  onContinueJob: () => void;
  onReviewField: (field: MissingJobField) => void;
}

/**
 * Home — the landing screen after sign-in.
 *
 * A calm dashboard: who is signed in, what state the job library and the
 * current workspace are in, and the two actions that matter most (start a
 * job, continue the open one). The job library lives directly below, so the
 * page is one scroll and no content is duplicated.
 */
export const HomeScreen: React.FC<HomeScreenProps> = ({
  userName,
  databaseEmail,
  jobs,
  pendingSyncCount,
  isOffline,
  customerName,
  jobNumber,
  lossAddress,
  hasJobInProgress,
  isDirty,
  missingFields,
  onNewJob,
  onContinueJob,
  onReviewField,
}) => {
  const greeting = greetingForHour(new Date().getHours());
  const displayName = userName || (databaseEmail ? databaseEmail.split('@')[0] : 'there');
  const activeJobs = jobs.filter((job) => job.status === 'Active').length;
  const readyCount = REQUIRED_FIELD_TOTAL - missingFields.length;
  const readinessPercent = Math.round((readyCount / REQUIRED_FIELD_TOTAL) * 100);

  return (
    <div className="space-y-4 sm:space-y-6" aria-label="Home">
      {/* Welcome band */}
      <section className="bg-white rounded-xl border border-slate-200">
        <div className="px-4 sm:px-6 py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              {greeting}
              {displayName && displayName !== 'there' ? ', ' + displayName : ''}
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              {todayLabel()} · Hays &amp; Sons Complete Restoration — Fort Wayne Division
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onNewJob}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              New job
            </button>
            {hasJobInProgress && (
              <button
                type="button"
                onClick={onContinueJob}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                Continue job
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* KPI tiles */}
      <section aria-label="Overview" className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {/* Saved jobs */}
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-slate-600">Saved jobs</p>
            <span className="shrink-0 p-2 rounded-lg bg-red-50 text-red-600">
              <FolderOpen className="w-4 h-4" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{jobs.length}</p>
          <p className="mt-1 text-[12px] text-slate-500">
            {activeJobs > 0 ? activeJobs + ' active' : 'In the job library'}
          </p>
        </div>

        {/* Sync state */}
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-slate-600">Cloud sync</p>
            <span
              className={
                'shrink-0 p-2 rounded-lg ' +
                (isOffline || pendingSyncCount > 0
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-slate-100 text-slate-500')
              }
            >
              {isOffline || pendingSyncCount > 0 ? (
                <CloudOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Cloud className="w-4 h-4" aria-hidden="true" />
              )}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-2xl font-semibold tabular-nums text-slate-900">{pendingSyncCount}</p>
            <span
              className={
                'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] font-semibold ' +
                (isOffline || pendingSyncCount > 0
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700')
              }
            >
              <span
                className={
                  'w-1.5 h-1.5 rounded-full ' +
                  (isOffline || pendingSyncCount > 0 ? 'bg-amber-500' : 'bg-emerald-500')
                }
                aria-hidden="true"
              />
              {isOffline ? 'Offline' : pendingSyncCount > 0 ? 'Waiting' : 'Synced'}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-slate-500">
            {isOffline
              ? 'Saved on this device'
              : pendingSyncCount > 0
              ? 'Changes waiting to sync'
              : 'All changes are in the database'}
          </p>
        </div>

        {/* Current job */}
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-slate-600">Current job</p>
            <span className="shrink-0 p-2 rounded-lg bg-slate-100 text-slate-500">
              <ClipboardList className="w-4 h-4" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 min-w-0">
            <span
              className={
                'w-2 h-2 rounded-full shrink-0 ' +
                (!hasJobInProgress ? 'bg-slate-300' : isDirty ? 'bg-amber-500' : 'bg-emerald-500')
              }
              aria-hidden="true"
            />
            <p className="text-[15px] font-semibold text-slate-900 truncate">
              {hasJobInProgress ? customerName || 'Untitled job' : 'New job'}
            </p>
          </div>
          <p className="mt-1 text-[12px] text-slate-500 tabular-nums truncate">
            {hasJobInProgress ? jobNumber || 'No job number yet' : 'Nothing in progress'}
          </p>
        </div>

        {/* Required fields */}
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-slate-600">Required fields</p>
            <span
              className={
                'shrink-0 p-2 rounded-lg ' +
                (missingFields.length > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500')
              }
            >
              {missingFields.length > 0 ? (
                <CircleAlert className="w-4 h-4" aria-hidden="true" />
              ) : (
                <ListChecks className="w-4 h-4" aria-hidden="true" />
              )}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
            {readyCount}
            <span className="text-[15px] font-medium text-slate-500"> of {REQUIRED_FIELD_TOTAL}</span>
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className={
                'h-full rounded-full transition-all ' +
                (missingFields.length > 0 ? 'bg-amber-500' : 'bg-emerald-500')
              }
              style={{ width: readinessPercent + '%' }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={REQUIRED_FIELD_TOTAL}
              aria-valuenow={readyCount}
              aria-label={readyCount + ' of ' + REQUIRED_FIELD_TOTAL + ' required fields entered'}
            />
          </div>
          <p className="mt-1 text-[12px] text-slate-500">
            {missingFields.length > 0 ? 'Entered so far' : 'Everything required is in'}
          </p>
        </div>
      </section>

      {/* Current job + readiness */}
      <section className="grid lg:grid-cols-3 gap-4 sm:gap-6 items-start">
        {/* Continue where you left off */}
        <div className="bg-white rounded-xl border border-slate-200 lg:col-span-2">
          <div className="px-4 sm:px-6 py-5">
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
              Continue where you left off
            </h3>

            {hasJobInProgress ? (
              <div className="mt-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-semibold text-slate-900 truncate">
                        {customerName || 'Untitled job'}
                      </p>
                      <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded tabular-nums">
                        {jobNumber ? 'Job ' + jobNumber : 'No job number'}
                      </span>
                      {isDirty && (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                          Unsaved changes
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[13px] text-slate-600 break-words">
                      {lossAddress || 'No loss address entered yet.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onContinueJob}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                  >
                    Continue editing
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center sm:text-left">
                <div className="shrink-0 p-3 rounded-xl bg-white border border-slate-200 text-slate-500">
                  <FilePlus2 className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-900">No job in progress</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-500 max-w-md">
                    Start a job to capture the customer, insurance and financial details, then
                    generate the contract, reports and production packet from one record.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Job readiness — actionable missing-field list */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-4 sm:px-5 py-5">
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
              Job readiness
            </h3>
            <p className="mt-1 text-[12px] text-slate-500">
              Six required fields unlock a complete packet.
            </p>

            {!hasJobInProgress ? (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3">
                <CircleAlert className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
                <p className="text-[12px] leading-relaxed text-slate-500">
                  Start a job to see which fields are required. Every entry below links straight
                  to the field once a job is open.
                </p>
              </div>
            ) : missingFields.length > 0 ? (
              <ul className="mt-4 space-y-1">
                {missingFields.map((field) => (
                  <li key={field.inputId} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-800 truncate">{field.label}</p>
                      <p className="text-[11px] text-slate-500">{SECTION_LABELS[field.section] ?? field.section}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onReviewField(field)}
                      className="shrink-0 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                    >
                      Fill in
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
                <span className="mt-0.5 p-1 rounded bg-emerald-100 text-emerald-600">
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                </span>
                <p className="text-[12px] leading-relaxed text-emerald-800">
                  All required fields are entered. This job is ready for its documents.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
