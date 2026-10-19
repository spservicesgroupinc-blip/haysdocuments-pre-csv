import React from 'react';
import {
  Home,
  UserCircle,
  ShieldAlert,
  Coins,
  Users2,
  FileEdit,
  CheckCircle,
  StickyNote,
  FileCheck,
  FileInput,
  Landmark,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Every page reachable from workspace navigation. */
export type WorkspaceTab =
  | 'home'
  | 'intake'
  | 'customer'
  | 'insurance'
  | 'financials'
  | 'mortgage'
  | 'team'
  | 'changeOrder'
  | 'checklist'
  | 'productionNotes'
  | 'documents';

export interface WorkspaceSection {
  id: WorkspaceTab;
  label: string;
  icon: LucideIcon;
  group: 'Workspace' | 'Job details' | 'Production' | 'Documents';
}

/** Order mirrors the intake-to-production workflow. */
export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { id: 'home', label: 'Home', icon: Home, group: 'Workspace' },
  { id: 'intake', label: 'Intake', icon: FileInput, group: 'Workspace' },
  { id: 'customer', label: 'Customer & Property', icon: UserCircle, group: 'Job details' },
  { id: 'insurance', label: 'Insurance & Claim', icon: ShieldAlert, group: 'Job details' },
  { id: 'financials', label: 'Financials', icon: Coins, group: 'Job details' },
  { id: 'mortgage', label: 'Mortgage', icon: Landmark, group: 'Job details' },
  { id: 'team', label: 'Team', icon: Users2, group: 'Production' },
  { id: 'productionNotes', label: 'Production Notes', icon: StickyNote, group: 'Production' },
  { id: 'checklist', label: 'Checklist', icon: CheckCircle, group: 'Production' },
  { id: 'changeOrder', label: 'Change Order', icon: FileEdit, group: 'Production' },
  { id: 'documents', label: 'Documents', icon: FileCheck, group: 'Documents' },
];

interface WorkspaceNavigationProps {
  activeTab: WorkspaceTab;
  onNavigate: (tab: WorkspaceTab) => void;
  missingFieldCounts?: Partial<Record<WorkspaceTab, number>>;
  showMissingWarnings: boolean;
}

const DESTINATIONS = [
  { id: 'home', label: 'Home', icon: Home, sections: ['home'] },
  { id: 'intake', label: 'Intake', icon: FileInput, sections: ['intake'] },
  { id: 'customer', label: 'Job details', icon: UserCircle, sections: ['customer', 'insurance', 'financials', 'mortgage'] },
  { id: 'team', label: 'Production', icon: CheckCircle, sections: ['team', 'productionNotes', 'checklist', 'changeOrder'] },
  { id: 'documents', label: 'Documents', icon: FileCheck, sections: ['documents'] },
] as const;

/** Five stable destinations; each workspace exposes only its own sections. */
export const WorkspaceNavigation: React.FC<WorkspaceNavigationProps> = ({
  activeTab, onNavigate, missingFieldCounts, showMissingWarnings,
}) => {
  const activeDestination = DESTINATIONS.find((item) => (item.sections as readonly string[]).includes(activeTab))!;
  const sections = WORKSPACE_SECTIONS.filter((section) => (activeDestination.sections as readonly string[]).includes(section.id));

  return (
    <div className="mb-5 sm:mb-6">
      <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white pb-safe shadow-[0_-4px_16px_rgb(15_23_42/0.04)] sm:static sm:flex sm:gap-1 sm:border-t-0 sm:border-b sm:bg-transparent sm:pb-0 sm:shadow-none">
        {DESTINATIONS.map((item) => {
          const Icon = item.icon;
          const selected = item === activeDestination;
          return (
            <button
              type="button" key={item.id} aria-label={item.label}
              aria-current={selected ? 'page' : undefined}
              onClick={() => onNavigate(selected ? activeTab : item.id)}
              className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600 sm:min-h-12 sm:flex-row sm:gap-2 sm:px-5 sm:text-sm ${selected ? 'text-red-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
              {selected && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-red-700 sm:inset-x-4 sm:top-auto sm:bottom-[-1px]" />}
            </button>
          );
        })}
      </nav>
      {sections.length > 1 && (
        <nav aria-label={`${activeDestination.label} sections`} className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 sm:flex sm:flex-wrap sm:w-fit">
          {sections.map((section) => {
            const Icon = section.icon;
            const missing = showMissingWarnings ? missingFieldCounts?.[section.id] ?? 0 : 0;
            const selected = section.id === activeTab;
            return (
              <button key={section.id} type="button" onClick={() => onNavigate(section.id)} aria-current={selected ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 sm:text-[13px] ${selected ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
                {section.label}
                {missing > 0 && <span aria-label={`${missing} required fields missing`} className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] ${selected ? 'bg-white/15 text-white' : 'bg-amber-50 text-amber-800'}`}>{missing}</span>}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
};
