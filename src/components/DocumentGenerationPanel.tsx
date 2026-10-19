import React, { useState } from 'react';
import {
  FileDown,
  Eye,
  Layers,
  FileCheck2,
  HardDriveUpload,
  TableProperties,
  CheckCircle2,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Archive,
  AlertCircle,
  FileText,
} from 'lucide-react';
import JSZip from 'jszip';
import { RestorationJobData } from '../types/jobData';
import {
  JOB_DOCUMENTS,
  buildCombinedPacketFileName,
  safeCustomerName,
  safeJobNumber,
  type JobDocument,
} from '../services/documentCatalog';
import {
  generateCompletePacket,
  downloadPdf,
  formatCurrency,
} from '../services/pdfService';
import { PdfPreviewRequest } from './SectionPdfActions';
import { getMissingJobFields, type MissingJobField } from '../services/jobReadiness';

interface DocumentGenerationPanelProps {
  jobData: RestorationJobData;
  onPreview: PdfPreviewRequest;
  onSaveToDrive: () => void;
  onSyncToSheets: () => void;
  isDriveLoading: boolean;
  isSheetsLoading: boolean;
  driveSuccessLink?: string;
  sheetsSuccessLink?: string;
  onReviewField?: (field: MissingJobField) => void;
}

export const DocumentGenerationPanel: React.FC<DocumentGenerationPanelProps> = ({
  jobData,
  onPreview,
  onSaveToDrive,
  onSyncToSheets,
  isDriveLoading,
  isSheetsLoading,
  driveSuccessLink,
  sheetsSuccessLink,
  onReviewField,
}) => {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [lastGeneratedSummary, setLastGeneratedSummary] = useState<{
    timestamp: string;
    filesCount: number;
    calculatedRCV: string;
    calculatedNet: string;
    calculatedDown: string;
    unresolvedFields: string[];
  } | null>(null);

  // Exact deliverables mapping required by Hays Intake to Production specification.
  const combinedFileName = buildCombinedPacketFileName(jobData);

  // The eight standalone deliverables — generators and file names come from the shared catalog
  // so the per-section quick actions always match this panel.
  const docList: JobDocument[] = JOB_DOCUMENTS;

  const missingFields = getMissingJobFields(jobData);
  const unresolvedList = missingFields.map((field) => field.label);

  const isQualityGatePassed = unresolvedList.length === 0;

  const handleDownload = async (doc: JobDocument) => {
    try {
      setDownloadingId(doc.id);
      const bytes = await doc.generator(jobData);
      downloadPdf(bytes, doc.buildFileName(jobData));
      setLastGeneratedSummary({
        timestamp: new Date().toLocaleTimeString(),
        filesCount: 1,
        calculatedRCV: formatCurrency(jobData.financials.totalApprovedRcv),
        calculatedNet: formatCurrency(jobData.financials.netClaimValue),
        calculatedDown: formatCurrency(jobData.financials.downPayment),
        unresolvedFields: unresolvedList,
      });
    } catch (err) {
      console.error('Failed generating document:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadCompletePacket = async () => {
    try {
      setDownloadingId('packet');
      const bytes = await generateCompletePacket(jobData);
      downloadPdf(bytes, combinedFileName);
      setLastGeneratedSummary({
        timestamp: new Date().toLocaleTimeString(),
        filesCount: 1,
        calculatedRCV: formatCurrency(jobData.financials.totalApprovedRcv),
        calculatedNet: formatCurrency(jobData.financials.netClaimValue),
        calculatedDown: formatCurrency(jobData.financials.downPayment),
        unresolvedFields: unresolvedList,
      });
    } catch (err) {
      console.error('Failed generating complete packet:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  // Download All as ZIP archive
  const handleDownloadZipPackage = async () => {
    try {
      setIsZipping(true);
      const zip = new JSZip();

      // 1. Generate Combined Packet
      const combinedBytes = await generateCompletePacket(jobData);
      zip.file(combinedFileName, combinedBytes);

      // 2. Generate each individual document
      for (const doc of docList) {
        const bytes = await doc.generator(jobData);
        zip.file(doc.buildFileName(jobData), bytes);
      }

      // 3. Generate summary text file
      const summaryText = `HAYS + SONS COMPLETE RESTORATION
Production Packet Summary
Generated: ${new Date().toLocaleString()}
------------------------------------------------
Job Number: ${jobData.customer.jobNumber}
Customer: ${jobData.customer.customerName}
Loss Address: ${jobData.customer.lossAddress}
Insurance Carrier: ${jobData.insurance.carrier}
Claim Number: ${jobData.insurance.claimNumber}
Primary Adjuster: ${jobData.insurance.primaryAdjuster}

Financial Reconciliation:
Total Approved RCV: ${formatCurrency(jobData.financials.totalApprovedRcv)}
Deductible: ${formatCurrency(jobData.financials.deductible)}
Net Claim Value: ${formatCurrency(jobData.financials.netClaimValue)}
Down Payment (50%): ${formatCurrency(jobData.financials.downPayment)}
Mid-Progress (25%): ${formatCurrency(jobData.financials.midProgressPayment)}
Balance Due (25%): ${formatCurrency(jobData.financials.balancePayment)}
Contract Timelines: ${jobData.financials.commenceDays} days commence, ${jobData.financials.completeDays} days complete

Files Included:
- ${combinedFileName}
${docList.map((d) => `- ${d.buildFileName(jobData)}`).join('\n')}
`;
      zip.file(`README_Production_Summary_${safeJobNumber}.txt`, summaryText);

      // 4. Download Zip
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Hays_Production_Packet_${safeJobNumber(jobData)}_${safeCustomerName(jobData)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setLastGeneratedSummary({
        timestamp: new Date().toLocaleTimeString(),
        filesCount: 9,
        calculatedRCV: formatCurrency(jobData.financials.totalApprovedRcv),
        calculatedNet: formatCurrency(jobData.financials.netClaimValue),
        calculatedDown: formatCurrency(jobData.financials.downPayment),
        unresolvedFields: unresolvedList,
      });
    } catch (err) {
      console.error('ZIP package error:', err);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="bg-surface rounded-xl border border-line p-3 sm:p-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-line-soft">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-lg bg-subtle text-muted">
              <Layers className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-primary tracking-tight">
                Documents
              </h2>
              <p className="text-[12px] text-muted mt-0.5">
                Review, preview, and download the production packet or individual forms
              </p>
            </div>
          </div>
        </div>

        {/* Workspace Cloud Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onSaveToDrive}
            disabled={isDriveLoading}
            type="button"
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-semibold bg-subtle text-body hover:bg-selection hover:text-primary border border-line transition shadow-sm disabled:opacity-50"
            title="Save the complete PDF packet to shared Drive storage through Google Apps Script"
          >
            {isDriveLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin text-brand-copy" />
            ) : (
              <HardDriveUpload className="w-4 h-4 mr-2 text-info-copy" />
            )}
            Save to Google Drive
          </button>

          <button
            onClick={onSyncToSheets}
            disabled={isSheetsLoading}
            type="button"
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-semibold bg-subtle text-body hover:bg-selection hover:text-primary border border-line transition shadow-sm disabled:opacity-50"
            title="Update this job in the shared Google Sheets database through Google Apps Script"
          >
            {isSheetsLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin text-success-copy" />
            ) : (
              <TableProperties className="w-4 h-4 mr-2 text-success-copy" />
            )}
            Sync to Google Sheets
          </button>
        </div>
      </div>

      {/* Quality Gate Status Strip */}
      <div className="mt-4 p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs bg-canvas border-line">
        <div className="flex items-center gap-2.5">
          {isQualityGatePassed ? (
            <div className="p-1 rounded-full bg-success-soft text-success-copy">
              <ShieldCheck className="w-4 h-4" />
            </div>
          ) : (
            <div className="p-1 rounded-full bg-warning-soft text-warning-copy">
              <AlertCircle className="w-4 h-4" />
            </div>
          )}
          <div>
            <span className="font-bold text-primary">
              {isQualityGatePassed
                ? 'Required fields complete'
                : `${missingFields.length} required field${missingFields.length === 1 ? '' : 's'} to review`}
            </span>
            <span className="text-muted block text-[11px]">
              {isQualityGatePassed
                ? 'Customer, claim, and financial fields are filled in. Review the packet before sharing.'
                : 'Choose a missing field below to fill it in. Downloads remain available with blank placeholders.'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-secondary">
          <span className="bg-surface px-2 py-1 rounded border border-line">
            RCV: {formatCurrency(jobData.financials.totalApprovedRcv)}
          </span>
          <span className="bg-surface px-2 py-1 rounded border border-line">
            Net: {formatCurrency(jobData.financials.netClaimValue)}
          </span>
        </div>
      </div>

      {missingFields.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Missing required fields">
          {missingFields.map((field) => onReviewField ? (
            <button
              key={field.inputId}
              type="button"
              onClick={() => onReviewField(field)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-warning-line bg-warning-tint px-3 py-2 text-xs font-medium text-warning-copy-strong hover:bg-warning-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {field.label}
            </button>
          ) : <span key={field.inputId} className="text-xs text-warning-copy-strong">{field.label}</span>)}
        </div>
      )}

      {/* Cloud Links Notifications if saved */}
      {(driveSuccessLink || sheetsSuccessLink) && (
        <div className="mt-4 p-3 bg-success-tint border border-success-line rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-success-copy-strong">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-success-copy shrink-0" />
            <span>Shared storage updated:</span>
          </div>
          <div className="flex items-center gap-3">
            {driveSuccessLink && (
              <a
                href={driveSuccessLink}
                target="_blank"
                rel="noreferrer"
                className="font-bold underline flex items-center gap-1 hover:text-success-copy-strong"
              >
                Open in Drive <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {sheetsSuccessLink && (
              <a
                href={sheetsSuccessLink}
                target="_blank"
                rel="noreferrer"
                className="font-bold underline flex items-center gap-1 hover:text-success-copy-strong"
              >
                Open Google Sheet <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Complete packet */}
      <div className="mt-6 rounded-xl border border-line bg-canvas p-3 sm:p-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-surface border border-line flex items-center justify-center shrink-0">
            <FileCheck2 className="w-5 h-5 text-muted" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[14px] font-semibold text-primary">Complete production packet</h3>
              <span className="text-[11px] font-medium text-secondary bg-surface border border-line rounded px-1.5 py-0.5">
                9 pages
              </span>
            </div>
            <p className="mt-1 text-[12px] text-muted max-w-xl">
              All eight documents bundled in exact production order.
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-faint break-all">{combinedFileName}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end shrink-0">
          <button
            onClick={() =>
              onPreview({
                id: 'completePacket',
                code: '',
                label: 'Complete Packet',
                title: 'Complete 9-Page Restoration Packet',
                pages: '9 pages',
                description: 'All eight documents bundled in exact production order.',
                generator: () => generateCompletePacket(jobData),
                buildFileName: () => buildCombinedPacketFileName(jobData),
              })
            }
            type="button"
            className="flex-1 sm:flex-initial inline-flex items-center justify-center px-3.5 py-2.5 rounded-lg text-[13px] font-semibold bg-surface hover:bg-canvas text-body border border-line transition"
          >
            <Eye className="w-4 h-4 mr-1.5" />
            Preview
          </button>

          <button
            onClick={handleDownloadCompletePacket}
            disabled={downloadingId === 'packet'}
            type="button"
            className="flex-1 sm:flex-initial inline-flex items-center justify-center px-4 py-2.5 rounded-lg text-[13px] font-semibold bg-red-600 hover:bg-red-700 text-white transition shadow-sm disabled:opacity-50"
          >
            {downloadingId === 'packet' ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-1.5" />
            )}
            Download packet
          </button>

          <button
            onClick={handleDownloadZipPackage}
            disabled={isZipping}
            type="button"
            className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 rounded-lg text-[13px] font-semibold bg-surface hover:bg-canvas text-body border border-line transition disabled:opacity-50"
            title="Download a ZIP containing all 9 files plus a summary"
          >
            {isZipping ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Archive className="w-4 h-4 mr-1.5 text-faint" />
            )}
            Download all as ZIP
          </button>
        </div>
      </div>

      {/* Grid of Individual Forms */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
            Individual documents
          </h4>
          <span className="text-xs text-muted">Preview or download a single form</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {docList.map((doc) => {
            const isDownloading = downloadingId === doc.id;
            return (
              <div
                key={doc.id}
                className="bg-canvas hover:bg-surface rounded-xl p-4 border border-line hover:border-line-strong hover:shadow-sm transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-bold text-brand-copy bg-brand-tint border border-brand-line/80 px-2 py-0.5 rounded">
                      {doc.code} • {doc.pages}
                    </span>
                    <span className="text-[10px] text-faint font-mono truncate max-w-[140px]">
                      {doc.buildFileName(jobData)}
                    </span>
                  </div>
                  <h5 className="font-bold text-primary text-sm">{doc.title}</h5>
                  <p className="text-xs text-muted mt-1 leading-relaxed">{doc.description}</p>
                </div>

                <div className="flex items-center space-x-2 mt-4 pt-3 border-t border-line/70">
                  <button
                    onClick={() => onPreview(doc)}
                    type="button"
                    className="flex-1 inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-surface text-body hover:bg-subtle border border-line transition"
                  >
                    <Eye className="w-3.5 h-3.5 mr-1 text-muted" />
                    Preview
                  </button>
                  <button
                    onClick={() => handleDownload(doc)}
                    disabled={isDownloading}
                    type="button"
                    className="flex-1 inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-red-600 transition shadow-sm disabled:opacity-50"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin text-white" />
                    ) : (
                      <FileDown className="w-3.5 h-3.5 mr-1" />
                    )}
                    Download
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Generation Completion Note per Skill requirement */}
      {lastGeneratedSummary && (
        <div className="mt-6 p-4 rounded-xl bg-slate-900 text-slate-200 border border-slate-800 text-xs animate-in fade-in">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
            <span className="font-bold text-white flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Generation Completion Note ({lastGeneratedSummary.timestamp})
            </span>
            <span className="text-[10px] text-faint font-mono">
              {lastGeneratedSummary.filesCount} file(s) generated
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-300">
            <div>
              <span className="text-faint block text-[10px]">Total Contract RCV:</span>
              <span className="font-bold text-white">{lastGeneratedSummary.calculatedRCV}</span>
            </div>
            <div>
              <span className="text-faint block text-[10px]">Net Claim Value:</span>
              <span className="font-bold text-emerald-400">{lastGeneratedSummary.calculatedNet}</span>
            </div>
            <div>
              <span className="text-faint block text-[10px]">50% Down Payment:</span>
              <span className="font-bold text-sky-400">{lastGeneratedSummary.calculatedDown}</span>
            </div>
          </div>
          {lastGeneratedSummary.unresolvedFields.length > 0 ? (
            <p className="mt-2 text-amber-300 text-[11px]">
              ⚠️ Unresolved fields left blank: {lastGeneratedSummary.unresolvedFields.join(', ')}
            </p>
          ) : (
            <p className="mt-2 text-emerald-400 text-[11px]">
              Required fields were filled in when generated. Review the documents before sharing.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
