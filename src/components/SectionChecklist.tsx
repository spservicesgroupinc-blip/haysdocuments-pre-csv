import React from 'react';
import { ClipboardCheck, CheckSquare, Calendar, DollarSign, FileText } from 'lucide-react';
import { RestorationJobData } from '../types/jobData';
import { DOC } from '../services/documentCatalog';
import { SectionPdfActions, type PdfPreviewRequest } from './SectionPdfActions';

interface SectionChecklistProps {
  checklist: RestorationJobData['checklist'];
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onChange: (field: keyof RestorationJobData['checklist'], value: any) => void;
}

export const SectionChecklist: React.FC<SectionChecklistProps> = ({
  checklist,
  jobData,
  onPreview,
  onChange,
}) => {
  return (
    <div className="bg-surface rounded-xl border border-line p-3 sm:p-5">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-line-soft">
        <div className="p-2 rounded-lg bg-subtle text-muted">
          <ClipboardCheck className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-primary">Production Checklist</h3>
          <p className="text-xs text-muted">
            DASH tracking, Xactimate version, deductible receipt status, and construction schedule
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Has deductible been collected? */}
        <div>
          <label className="block text-xs font-semibold text-body mb-1">
            Has Deductible Been Collected? *
          </label>
          <select
            value={checklist.hasDeductibleBeenCollected}
            onChange={(e) => onChange('hasDeductibleBeenCollected', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-canvas border border-line-strong rounded-lg text-primary font-semibold focus:bg-surface focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          >
            <option value="Yes">Yes (Collected)</option>
            <option value="No">No (Pending collection)</option>
            <option value="Pending">Payment plan arranged</option>
          </select>
        </div>

        {/* Xactimate Version */}
        <div>
          <label className="block text-xs font-semibold text-body mb-1">
            Xactimate Version
          </label>
          <input
            type="text"
            value={checklist.xactimateVersion}
            onChange={(e) => onChange('xactimateVersion', e.target.value)}
            placeholder="X1"
            className="w-full px-3 py-2 text-sm bg-canvas border border-line-strong rounded-lg text-primary focus:bg-surface focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Program Claim? */}
        <div>
          <label className="block text-xs font-semibold text-body mb-1">
            Program Claim (Carrier TPA)?
          </label>
          <div className="flex space-x-2 mt-1">
            <button
              type="button"
              onClick={() => onChange('isProgramClaim', true)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
                checklist.isProgramClaim
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-canvas text-body border-line-strong hover:bg-subtle'
              }`}
            >
              Yes (TPA)
            </button>
            <button
              type="button"
              onClick={() => onChange('isProgramClaim', false)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
                !checklist.isProgramClaim
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-canvas text-body border-line-strong hover:bg-subtle'
              }`}
            >
              No (Standard)
            </button>
          </div>
        </div>

        {/* Self Pay */}
        <div>
          <label className="block text-xs font-semibold text-body mb-1">
            Self Pay?
          </label>
          <div className="flex space-x-2 mt-1">
            <button
              type="button"
              onClick={() => onChange('isSelfPay', false)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
                !checklist.isSelfPay
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-canvas text-body border-line-strong hover:bg-subtle'
              }`}
            >
              Insurance
            </button>
            <button
              type="button"
              onClick={() => onChange('isSelfPay', true)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
                checklist.isSelfPay
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-canvas text-body border-line-strong hover:bg-subtle'
              }`}
            >
              Self Pay
            </button>
          </div>
        </div>

        {/* Deductible Explanation */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-body mb-1">
            Deductible Collection Notes / If No, Explain
          </label>
          <input
            type="text"
            value={checklist.deductibleExplanation}
            onChange={(e) => onChange('deductibleExplanation', e.target.value)}
            placeholder="e.g. Deductible collected via check #1042 at pre-construction walk."
            className="w-full px-3 py-2 text-sm bg-canvas border border-line-strong rounded-lg text-primary focus:bg-surface focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Check Payable To */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-body mb-1">
            Who is the check payable to?
          </label>
          <input
            type="text"
            value={checklist.checkPayableTo}
            onChange={(e) => onChange('checkPayableTo', e.target.value)}
            placeholder="Hays + Sons & Owner"
            className="w-full px-3 py-2 text-sm bg-canvas border border-line-strong rounded-lg text-primary focus:bg-surface focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Start Date */}
        <div>
          <label className="block text-xs font-semibold text-body mb-1">
            Target Start Date
          </label>
          <input
            type="date"
            value={checklist.startDate}
            onChange={(e) => onChange('startDate', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-canvas border border-line-strong rounded-lg text-primary focus:bg-surface focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Finish Date */}
        <div>
          <label className="block text-xs font-semibold text-body mb-1">
            Target Finish Date
          </label>
          <input
            type="date"
            value={checklist.finishDate}
            onChange={(e) => onChange('finishDate', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-canvas border border-line-strong rounded-lg text-primary focus:bg-surface focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>

        {/* Depreciation Withheld */}
        <div>
          <label className="block text-xs font-semibold text-body mb-1">
            Depreciation Withheld ($)
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-faint">
              <DollarSign className="w-4 h-4" />
            </span>
            <input
              type="number"
              step="0.01"
              value={checklist.depreciationAmount}
              onChange={(e) =>
                onChange(
                  'depreciationAmount',
                  e.target.value === '' ? '' : parseFloat(e.target.value)
                )
              }
              placeholder="0.00"
              className="w-full pl-9 pr-3 py-2 text-sm bg-canvas border border-line-strong rounded-lg text-primary focus:bg-surface focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
            />
          </div>
        </div>

        {/* PM Notes */}
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="block text-xs font-semibold text-body mb-1">
            Project Manager Notes
          </label>
          <textarea
            rows={2}
            value={checklist.projectManagerNotes}
            onChange={(e) => onChange('projectManagerNotes', e.target.value)}
            placeholder="Material selections, special access arrangements, staging areas..."
            className="w-full px-3 py-2 text-sm bg-canvas border border-line-strong rounded-lg text-primary focus:bg-surface focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>
      </div>

      <SectionPdfActions jobData={jobData} docs={[DOC.productionChecklist]} onPreview={onPreview} />
    </div>
  );
};
