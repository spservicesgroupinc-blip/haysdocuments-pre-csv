import React, { useRef, useState } from 'react';
import {
  Database,
  Save,
  Loader2,
  Plus,
  LogOut,
  ChevronDown,
  Cloud,
  AlertCircle,
  Check,
  UserCircle,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { ThemePicker } from './ThemePicker';

interface NavbarProps {
  isHome: boolean;
  hasJobInProgress: boolean;
  jobNumber: string;
  customerName: string;
  onReset: () => void;
  /** Unsaved changes exist. */
  isDirty: boolean;
  isSavingJob: boolean;
  savedJobsCount: number;
  /** Email verified by the customer database, when signed in. */
  databaseEmail: string | null;
  isDatabaseConfigured: boolean;
  /** True when the developer shared-secret bypass is active (no sign-in). */
  isDeveloperBypass: boolean;
  onSaveJob: () => void;
  /** Opens the saved jobs library. */
  onOpenSavedCustomers: () => void;
  /** Returns to the home screen when the brand lockup is clicked. */
  onGoHome: () => void;
  /** Signs the application user out of the database session. */
  onSignOut: () => void;
  /** Records queued locally that still need to reach the database. */
  pendingSyncCount?: number;
  /** True while the device has no connectivity. */
  isOffline?: boolean;
  draftStatus?: 'idle' | 'saving' | 'saved' | 'error';
  isSyncing?: boolean;
}

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-45 disabled:cursor-not-allowed';

export const Navbar: React.FC<NavbarProps> = ({
  isHome,
  hasJobInProgress,
  jobNumber,
  customerName,
  onReset,
  isDirty,
  isSavingJob,
  savedJobsCount,
  databaseEmail,
  isDatabaseConfigured,
  isDeveloperBypass,
  onSaveJob,
  onOpenSavedCustomers,
  onGoHome,
  onSignOut,
  pendingSyncCount = 0,
  isOffline = false,
  draftStatus = 'idle',
  isSyncing = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const hasCustomer = Boolean(customerName.trim());

  const saveTitle = !isDatabaseConfigured
    ? 'Connect the job database to save this job'
    : isDirty
    ? 'Save changes to the customer database'
    : 'Saved — save again to overwrite';

  return (
    <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-line pt-safe">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-5">
        <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 lg:gap-4 min-h-16 py-2 lg:py-0">
          {/* Brand — the lockup is the way home */}
          <button
            type="button"
            onClick={onGoHome}
            title="Go to Home"
            aria-label="Hays + Sons — go to Home"
            className="group flex min-w-0 items-center rounded-lg -ml-2 px-2 py-1.5 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
          >
            <BrandLogo
              size={34}
              sublabel="Restoration Document Suite"
              sublabelClassName="hidden sm:block"
            />
          </button>

          {/* Job context */}
          {!isHome && <div className="hidden xl:flex items-center gap-2 min-w-0 rounded-lg border border-line bg-canvas/80 px-3 h-9">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                hasCustomer ? (isDirty ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-track'
              }`}
              aria-hidden
            />
            <span className="text-[13px] font-medium text-primary truncate max-w-[220px]">
              {hasCustomer ? customerName : 'New job'}
            </span>
            <span className="text-slate-300 select-none">·</span>
            <span className="text-[12px] text-muted tabular-nums truncate">
              {jobNumber || 'no job #'}
            </span>
            {isDirty && (
              <span className="text-[11px] font-semibold text-warning-copy bg-warning-tint border border-warning-line rounded px-1.5 py-0.5">
                Unsaved
              </span>
            )}
          </div>}

          {/* Actions */}
          <div className={`flex ${isHome ? 'w-auto' : 'w-full lg:w-auto'} items-center justify-end gap-1.5 sm:gap-2 shrink-0`}>
            {(isOffline || pendingSyncCount > 0 || draftStatus !== 'idle') && (
              <span
                title={
                  isOffline
                    ? 'Offline — changes are saved on this device and sync automatically'
                    : `${pendingSyncCount} change${pendingSyncCount === 1 ? '' : 's'} waiting to sync`
                }
                role="status"
                aria-live="polite"
                className={`hidden sm:inline-flex mr-auto lg:mr-0 items-center gap-1.5 h-9 px-2.5 rounded-lg border text-[11px] font-semibold ${draftStatus === 'error' ? 'border-brand-line bg-brand-tint text-brand-copy-strong' : isOffline || pendingSyncCount > 0 ? 'border-warning-line bg-warning-tint text-warning-copy-strong' : 'border-line bg-canvas text-secondary'}`}
              >
                {isSyncing || draftStatus === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <Check className="w-3 h-3" aria-hidden />}
                {draftStatus === 'error' ? 'Autosave needs attention' : draftStatus === 'saving' ? 'Saving draft…' : isOffline ? 'Saved on device' : isSyncing ? 'Syncing…' : pendingSyncCount > 0 ? 'Saved on device' : 'Draft synced'}
              </span>
            )}
            {!isHome && <button
              type="button"
              onClick={onOpenSavedCustomers}
              aria-label="Open saved jobs"
              title={databaseEmail ? `Saved jobs — signed in as ${databaseEmail}` : 'Open saved jobs'}
              className={`${BTN_BASE} min-h-11 px-2 sm:px-3 border border-line text-body hover:bg-canvas hover:text-primary`}
            >
              <Database className="w-4 h-4 text-faint" aria-hidden />
              <span>Jobs</span>
              {savedJobsCount > 0 && (
                <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded bg-selection text-body text-[11px] font-bold flex items-center justify-center tabular-nums">
                  {savedJobsCount}
                </span>
              )}
            </button>}

            {!isHome && <button
              type="button"
              onClick={onReset}
              title="Start a new job"
              className={`${BTN_BASE} min-h-11 px-2 sm:px-3 border border-line-strong text-body hover:bg-canvas hover:text-primary`}
            >
              <Plus className="w-4 h-4" aria-hidden />
              <span>New job</span>
            </button>}

            {(!isHome || hasJobInProgress) && <button
              type="button"
              onClick={onSaveJob}
              disabled={isSavingJob || !isDatabaseConfigured}
              title={saveTitle}
              className={`${BTN_BASE} min-h-11 px-2.5 sm:px-3.5 bg-red-700 text-white hover:bg-red-800 shadow-sm`}
            >
              {isSavingJob ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              ) : isDirty ? (
                <Save className="w-4 h-4" aria-hidden />
              ) : (
                <Check className="w-4 h-4" aria-hidden />
              )}
              <span>{isSavingJob ? 'Saving…' : 'Save job'}</span>
            </button>}

            {/* Account and integrations */}
            <div
              className="relative"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && isMenuOpen) {
                  setIsMenuOpen(false);
                  accountButtonRef.current?.focus();
                }
              }}
            >
              <button
                ref={accountButtonRef}
                type="button"
                onClick={() => setIsMenuOpen((open) => !open)}
                title="Account and connections"
                aria-label="Account and connections"
                aria-controls="account-panel"
                aria-expanded={isMenuOpen}
                className={`${BTN_BASE} min-h-11 min-w-11 px-2 border border-line text-secondary hover:bg-canvas`}
              >
                <UserCircle className="w-4 h-4" aria-hidden />
                <span className="hidden 2xl:inline">Account</span>
                <ChevronDown className={`hidden 2xl:block w-3 h-3 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>

              {isMenuOpen && (
                <>
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setIsMenuOpen(false)}
                    className="fixed inset-0 z-40 cursor-default"
                  />
                  <div id="account-panel" className="absolute right-0 top-12 z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-surface shadow-lg overflow-hidden">
                    <div className="border-b border-line-soft px-3.5 py-3"><ThemePicker /></div>
                    {/* Connection status */}
                    <div className="px-3.5 py-3 border-b border-line-soft">
                      <div className="flex items-start gap-2.5">
                        {isDatabaseConfigured ? (
                          <span
                            className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                              isDeveloperBypass ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                          />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-primary">
                            {isDatabaseConfigured ? 'Google Apps Script connected' : 'Google Apps Script not connected'}
                          </p>
                          <p className="text-[11px] text-muted truncate">
                            {isDeveloperBypass
                              ? 'Developer mode — sign-in bypassed'
                              : databaseEmail || (isDatabaseConfigured ? 'Not signed in' : 'Ask your administrator to connect the database')}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Shared backend storage */}
                    <div className="px-3.5 py-3 border-b border-line-soft">
                      <div className="flex items-start gap-2.5">
                        <Cloud className="w-4 h-4 text-faint shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-primary">Shared Drive &amp; job database</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted">Documents and job records use this account through the app's Google Apps Script backend.</p>
                        </div>
                      </div>
                    </div>

                    {/* Application sign out */}
                    {databaseEmail && !isDeveloperBypass && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onSignOut();
                        }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left hover:bg-canvas transition-colors border-t border-line-soft"
                      >
                        <LogOut className="w-4 h-4 text-faint" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-primary">Sign out</span>
                          <span className="block text-[11px] text-muted truncate">
                            {databaseEmail}
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
