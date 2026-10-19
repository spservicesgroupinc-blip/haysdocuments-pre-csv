import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { getIntakeFieldValue, formatUsd, type IntakeFieldCandidate } from '../services/intakeParser';
import type { IntakeExtractionState, ExtractionStatus } from '../services/intakeCoordinator';
import type { RestorationJobData } from '../types/jobData';

const statusLabels: Record<ExtractionStatus, string> = {
  idle: 'Not started', running: 'Running', success: 'Complete', empty: 'No usable fields', error: 'Unavailable',
};
function displayValue(value: unknown, candidate: IntakeFieldCandidate) {
  if (value === '' || value === undefined || value === null) return '(empty)';
  if (/ssn/i.test(candidate.key)) return `•••• ${String(value).slice(-4)}`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (candidate.kind === 'currency' && typeof value === 'number') return formatUsd(value);
  return String(value);
}

export function IntakeExtractionReview({ state, currentJob, onRetryAi, onResolve }: {
  state: IntakeExtractionState;
  currentJob?: RestorationJobData;
  onRetryAi: () => void;
  onResolve: (key: string, useAi: boolean) => void;
}) {
  if (state.local.status === 'idle' && state.ai.status === 'idle') return null;
  const finished = state.ai.status !== 'running' && state.local.status !== 'running';
  const noFields = finished && !state.result;
  return (
    <div className="mt-5 space-y-3" aria-label="Extraction results">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" role="status" aria-live="polite">
        <div className="grid gap-3 sm:grid-cols-2">
          {([['Built-in extraction', state.local], ['AI extraction', state.ai]] as const).map(([label, outcome]) => (
            <div key={label}>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                {outcome.status === 'running' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {label}: {statusLabels[outcome.status]}{outcome.status === 'success' && ` (${outcome.fields} fields)`}
              </p>
              {outcome.error && <p className="mt-1 break-words text-xs leading-relaxed text-amber-800">{outcome.error}</p>}
            </div>
          ))}
        </div>
        {state.ai.status === 'running' && state.local.status === 'success' && <p className="mt-2 text-xs text-slate-600">Local results are ready. You can edit, save, and create documents while AI continues.</p>}
        {state.ai.status === 'error' && state.local.status === 'success' && <p className="mt-2 text-xs text-slate-600">AI was unavailable. Your local extraction results remain available.</p>}
        {state.local.status === 'error' && state.ai.status === 'success' && <p className="mt-2 text-xs text-slate-600">Built-in extraction was unavailable. AI results remain available.</p>}
        {noFields && <p className="mt-2 text-sm text-amber-900">{state.local.status === 'error' && state.ai.status === 'error'
          ? 'Both extraction methods failed. Your job was left unchanged.'
          : 'Neither method extracted usable fields. Your job was left unchanged.'} Your intake text is still available to edit or retry.</p>}
        {['error', 'empty'].includes(state.ai.status) && <button type="button" onClick={onRetryAi} className="mt-3 min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Retry AI</button>}
      </div>
      {state.conflicts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />Review differing values ({state.conflicts.length})</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">Your current values are kept until you choose an alternative.</p>
          <div className="mt-3 space-y-3">
            {state.conflicts.map(({ key, candidate, currentValue }) => (
              <div key={key} className="rounded-lg border border-amber-200 bg-white p-3" role="group" aria-label={`Review ${candidate.label}`}>
                <p className="text-sm font-semibold text-slate-900">{candidate.label}</p>
                <dl className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
                  <div><dt className="font-semibold text-slate-600">Local / current value</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{displayValue(currentJob ? getIntakeFieldValue(currentJob, candidate) : currentValue, candidate)}</dd></div>
                  <div><dt className="font-semibold text-slate-600">AI alternative</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{displayValue(candidate.value, candidate)}</dd></div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" aria-label={`Keep current ${candidate.label}`} onClick={() => onResolve(key, false)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Keep current</button>
                  <button type="button" aria-label={`Use AI for ${candidate.label}`} onClick={() => onResolve(key, true)} className="min-h-11 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Use AI</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
