import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import JSZip from 'jszip';
import type { RestorationJobData } from '../types/jobData';
import {
  STAGE_LABELS, authorizedContractTotal, closeoutBlockers, createCloseout, handoffBlockers,
  itemOf, toCents, workflowOf, type JobItem, type WorkflowPayload,
} from '../types/workflow';
import { cleanTextForPdf, generateChangeOrder } from './pdfService';
import {
  MAX_ATTACHMENT_BYTES, detectAttachmentMime, normalizeSupportingPhoto, safeAttachmentName, sha256Bytes,
} from './workflowAttachments';

export type ExportAudience = 'internal' | 'customer' | 'carrier';
export interface SnapshotSection { title: string; rows: Array<{ label: string; value: string }> }
export interface SourceReference { kind: string; itemId: string; revision: number; updatedAt: string }
export interface WorkflowSnapshot {
  version: 1;
  type: 'handoff' | 'closeout';
  audience: ExportAudience;
  reviewState: 'draft' | 'final';
  jobId: string;
  jobNumber: string;
  customerName: string;
  generatedAt: string;
  generatedBy: string;
  sourceManifest: SourceReference[];
  sourceRevisions: Record<string, number>;
  sections: SnapshotSection[];
  reviewWarnings: string[];
}
export interface SnapshotOptions { reviewState?: 'draft' | 'final'; generatedAt?: string; generatedBy?: string }
export interface WorkflowOutput { fileName: string; mimeType: string; bytes: Uint8Array; sha256: string }
export interface SelectedExportFile { attachment: JobItem<'attachment'>; bytes: Uint8Array }
export interface CloseoutManifest {
  version: 1;
  audience: ExportAudience;
  reviewState: 'draft' | 'final';
  generatedAt: string;
  jobNumber: string;
  sourceRevisions: Record<string, number>;
  entries: string[];
  selectedFiles: Array<{ attachmentId: string; revision: number; path: string; mimeType: string; byteSize: number; sha256: string; caption: string }>;
  generatedFiles: Array<{ path: string; byteSize: number; sha256: string }>;
  reviewWarnings: string[];
}
export interface CloseoutExport {
  bytes: Uint8Array;
  fileName: string;
  manifest: CloseoutManifest;
  snapshot: WorkflowSnapshot;
  /** Persist these small constituents, plus snapshot JSON, rather than the ZIP. */
  outputs: WorkflowOutput[];
}
export const MAX_EXPORT_SOURCE_BYTES = 25 * 1024 * 1024;
const INK = rgb(0.102, 0.102, 0.102);
const MUTED = rgb(0.36, 0.39, 0.43);
const RED = rgb(0.76, 0.04, 0.07);
const RULE = rgb(0.84, 0.85, 0.86);
const present = (value: unknown): string => value === '' || value == null ? 'Not recorded' : String(value);
const dollars = (value: number | null): string => value === null ? 'Not recorded' : (value / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const row = (label: string, value: unknown) => ({ label, value: present(value) });
const section = (title: string, rows: SnapshotSection['rows']): SnapshotSection => ({ title, rows });

function freezeCopy<T>(value: T): T {
  const copy: T = JSON.parse(JSON.stringify(value));
  const freeze = (current: unknown) => {
    if (current && typeof current === 'object') {
      Object.values(current).forEach(freeze);
      Object.freeze(current);
    }
  };
  freeze(copy);
  return copy;
}

function scopedItems(job: RestorationJobData, items: JobItem[]): JobItem[] {
  const jobId = job.recordId || job.id;
  if (items.some(item => item.jobId !== jobId)) throw new Error('Supporting records belong to a different job. Refresh the current job before export.');
  return items.filter(item => !item.deletedAt);
}

function sourceReferences(job: RestorationJobData, items: JobItem[]): SourceReference[] {
  const jobId = job.recordId || job.id;
  return [
    { kind: 'job', itemId: jobId, revision: Number((job as RestorationJobData & { revision?: number }).revision) || 0, updatedAt: job.updatedAt || '' },
    ...items.filter(item => item.kind !== 'artifact').map(item => ({ kind: item.kind, itemId: item.itemId, revision: item.revision, updatedAt: item.updatedAt })),
  ].sort((a, b) => `${a.kind}:${a.itemId}`.localeCompare(`${b.kind}:${b.itemId}`, 'en-US'));
}

function makeSnapshot(job: RestorationJobData, items: JobItem[], type: WorkflowSnapshot['type'], audience: ExportAudience,
  sections: SnapshotSection[], reviewWarnings: string[], options: SnapshotOptions): WorkflowSnapshot {
  const sourceManifest = sourceReferences(job, items);
  const sourceRevisions = Object.fromEntries(sourceManifest.map(source => [`${source.kind}:${source.itemId}`, source.revision]));
  return freezeCopy({ version: 1, type, audience, reviewState: options.reviewState || 'draft', jobId: job.recordId || job.id,
    jobNumber: job.customer.jobNumber, customerName: job.customer.customerName,
    generatedAt: options.generatedAt || new Date().toISOString(), generatedBy: options.generatedBy || '',
    sourceManifest, sourceRevisions, sections, reviewWarnings });
}

function identity(job: RestorationJobData): SnapshotSection {
  return section('Job and property', [row('Job number', job.customer.jobNumber), row('Customer', job.customer.customerName),
    row('Property', job.customer.lossAddress), row('Division', job.branch.division), row('Office phone', job.branch.phone)]);
}

export function buildHandoffSnapshot(job: RestorationJobData, sourceItems: JobItem[], options: SnapshotOptions = {}): WorkflowSnapshot {
  const items = scopedItems(job, sourceItems);
  const workflow = workflowOf(job, items);
  const blockers = handoffBlockers(job, workflow);
  if (options.reviewState === 'final' && blockers.length && !workflow.handoffOverrideReason.trim()) {
    throw new Error(`Handoff needs review: ${blockers.join(', ')}. Resolve these items or record an override reason.`);
  }
  const sections = [identity(job),
    section('Progress and responsibility', [row('Stage', STAGE_LABELS[workflow.stage]), row('Next action', workflow.nextAction?.title),
      row('Responsible person', workflow.nextAction?.responsiblePerson.name), row('Due date', workflow.nextAction?.dueDate), row('Hold reason', workflow.holdReason)]),
    section('Customer and claim contacts', [row('Customer phone', job.customer.mainPhone || job.customer.mobilePhone || job.customer.homePhone), row('Customer email', job.customer.email),
      row('Loss contact', job.customer.lossContact), row('Claim type', job.checklist.isSelfPay ? 'Self-pay' : 'Insurance'), row('Carrier', job.insurance.carrier), row('Claim number', job.insurance.claimNumber),
      row('Adjuster', job.insurance.primaryAdjuster), row('Adjuster phone', job.insurance.adjusterPhone), row('Adjuster email', job.insurance.adjusterEmail)]),
    section('Production team', Object.entries(job.team).map(([label, value]) => row(label.replace(/([A-Z])/g, ' $1'), value))),
    section('Approved scope and materials', [row('Scope', job.productionNotes.scopeSummary || job.insurance.lossDescription), row('Materials and equipment', job.productionNotes.materialsAndEquipment)]),
    section('Financial context - review required', [row('Approved RCV', dollars(toCents(job.financials.totalApprovedRcv))), row('Deductible', dollars(toCents(job.financials.deductible))),
      row('Reviewed contract baseline', dollars(workflow.contractBaseAmountCents)), row('Brought-forward changes', dollars(workflow.openingPreviousChangesCents)),
      row('Customer-authorized contract total', dollars(authorizedContractTotal(workflow, itemOf(items, 'change')))), row('Initial payment status', workflow.confirmations.initialPayment)]),
    section('Site access, schedule and safety - internal use', [row('Schedule and access', job.productionNotes.scheduleAndAccess), row('Start date', job.checklist.startDate),
      row('Finish date', job.checklist.finishDate), row('Safety considerations', job.productionNotes.safetyConsiderations), row('Communication notes', job.productionNotes.communicationNotes),
      row('PM notes', job.checklist.projectManagerNotes), row('Additional notes', job.productionNotes.additionalNotes)]),
    section('Operational confirmations', [row('Contract recorded signed', workflow.confirmations.contractSigned ? 'Recorded' : 'Pending'),
      row('Approved scope reviewed', workflow.confirmations.scopeReviewed ? 'Reviewed' : 'Pending'), row('Mortgage prerequisite review', workflow.confirmations.mortgageReviewed),
      row('Readiness override reason', workflow.handoffOverrideReason)]),
    section('Outstanding selections', itemOf(items, 'selection').filter(item => item.payload.decision.status !== 'approved').map(item => row(
      [item.payload.room, item.payload.item].filter(Boolean).join(' / '), `${item.payload.specification || 'Specification not recorded'}; ${item.payload.decision.status}; needed ${present(item.payload.neededBy)}`))),
    section('Open changes', itemOf(items, 'change').filter(item => !['void', 'closed'].includes(item.payload.lifecycle)).map(item => row(item.payload.number || 'Draft change',
      `${item.payload.scope}; ${dollars(item.payload.amountCents)}; customer ${item.payload.customerDecision.status}; carrier ${item.payload.carrierDecision.status}`))),
  ];
  return makeSnapshot(job, items, 'handoff', 'internal', sections, blockers.map(blocker => `Missing: ${blocker}`), options);
}

export function buildCloseoutSnapshot(job: RestorationJobData, sourceItems: JobItem[], audience: ExportAudience, options: SnapshotOptions = {}): WorkflowSnapshot {
  if (!['internal', 'customer', 'carrier'].includes(audience)) throw new Error('Choose an internal, customer, or carrier closeout audience.');
  const items = scopedItems(job, sourceItems);
  const closeout = itemOf(items, 'closeout')[0]?.payload || createCloseout();
  const blockers = closeoutBlockers(closeout);
  if (!closeout.completionDate) blockers.unshift('Completion date');
  if (options.reviewState === 'final' && blockers.length && !closeout.completionOverrideReason.trim()) {
    throw new Error(`Closeout needs review: ${blockers.join(', ')}. Resolve these items or record an override reason.`);
  }
  // External summaries are built field-by-field. Never spread job/notes/financials into them.
  const sections = [identity(job), section('Completion record', [row('Completion date', closeout.completionDate), row('Record type',
    audience === 'carrier' ? 'Carrier / depreciation supporting documentation' : 'Completion summary'),
  row('Review note', 'This summary records documented completion information. It does not confirm payment, claim acceptance, or an electronic signature.')]),
  section('Completion checklist', closeout.checklist.map(item => row(item.label,
    audience === 'internal' ? `${item.state}${item.note ? ` - ${item.note}` : ''}` : item.state))),
  section('Punch items', closeout.punchItems.map(item => row(item.title, `${item.state}${item.dueDate ? `; due ${item.dueDate}` : ''}`)))];
  if (audience === 'carrier') sections.splice(1, 0, section('Claim reference', [row('Carrier', job.insurance.carrier), row('Claim number', job.insurance.claimNumber), row('Date of loss', job.insurance.dateOfLoss)]));
  if (audience === 'internal') sections.push(section('Internal review', [row('Stage', STAGE_LABELS[workflowOf(job, items).stage]),
    row('Production scope', job.productionNotes.scopeSummary), row('Internal PM notes', job.checklist.projectManagerNotes),
    row('Completion override reason', closeout.completionOverrideReason)]));
  // Warning labels are controlled checklist labels; free-form override notes stay internal.
  return makeSnapshot(job, items, 'closeout', audience, sections, blockers.map(blocker => `Unresolved: ${blocker}`), options);
}

/** Wrap by measured glyph widths, including words that have no spaces. */
function wrappedLines(value: string, font: PDFFont, size: number, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of String(value).replace(/\r\n?/g, '\n').split('\n')) {
    const words = cleanTextForPdf(paragraph).split(/\s+/).filter(Boolean);
    if (!words.length) { result.push(''); continue; }
    let line = '';
    for (const word of words) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) <= width) { line += ` ${word}`; continue; }
      if (line) { result.push(line); line = ''; }
      let part = '';
      for (const character of word) {
        if (part && font.widthOfTextAtSize(part + character, size) > width) { result.push(part); part = ''; }
        part += character;
      }
      line = part;
    }
    if (line) result.push(line);
  }
  return result;
}

async function summaryPdf(snapshot: WorkflowSnapshot): Promise<PDFDocument> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(snapshot.type === 'handoff' ? 'Internal production handoff' : 'Completion summary');
  pdf.setAuthor('Hays + Sons Complete Restoration');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page!: PDFPage;
  let y = 0;
  const text = (value: string, size = 10, font: PDFFont = regular, color = INK) => {
    for (const line of wrappedLines(value, font, size, 516)) {
      if (y < 66) addPage();
      if (line) page.drawText(line, { x: 48, y, size, font, color });
      y -= size + 4;
    }
  };
  const addPage = () => {
    page = pdf.addPage([612, 792]);
    page.drawText('Hays+Sons', { x: 48, y: 746, size: 22, font: bold, color: INK });
    page.drawRectangle({ x: 48, y: 724, width: 516, height: 3, color: RED });
    const title = snapshot.type === 'handoff' ? 'PRODUCTION HANDOFF' : 'COMPLETION SUMMARY';
    page.drawText(title, { x: 48, y: 700, size: 15, font: bold, color: INK });
    const label = `${snapshot.reviewState === 'draft' ? 'DRAFT - ' : ''}${snapshot.audience === 'internal' ? 'Internal use' : snapshot.audience === 'customer' ? 'Customer copy' : 'Carrier / depreciation support'}`;
    page.drawText(label, { x: 48, y: 681, size: 9, font: bold, color: snapshot.reviewState === 'draft' ? RED : MUTED });
    y = 655;
  };
  addPage();
  const generated = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indianapolis', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(snapshot.generatedAt));
  text(`Prepared ${generated} (America/Indianapolis)${snapshot.generatedBy ? ` by ${snapshot.generatedBy}` : ''}`, 8, regular, MUTED);
  if (snapshot.reviewWarnings.length) {
    y -= 8;
    text('Items requiring review', 10, bold, RED);
    snapshot.reviewWarnings.forEach(warning => text(`- ${warning}`, 9));
  }
  for (const current of snapshot.sections) {
    if (y < 110) addPage();
    y -= 12;
    text(current.title, 11, bold);
    page.drawLine({ start: { x: 48, y: y + 4 }, end: { x: 564, y: y + 4 }, thickness: 0.5, color: RULE });
    y -= 5;
    if (!current.rows.length) text('None recorded', 9, regular, MUTED);
    for (const value of current.rows) {
      if (y < 92) addPage();
      text(value.label, 8, bold, MUTED);
      text(value.value, 10);
      y -= 5;
    }
  }
  const total = pdf.getPageCount();
  for (const [index, current] of pdf.getPages().entries()) {
    current.drawLine({ start: { x: 48, y: 48 }, end: { x: 564, y: 48 }, thickness: 0.5, color: RULE });
    const footer = `${safeAttachmentName(snapshot.jobNumber || 'Job')} | Hays + Sons | Page ${index + 1} of ${total}`;
    current.drawText(cleanTextForPdf(footer), { x: 48, y: 32, size: 8, font: regular, color: MUTED, maxWidth: 516 });
  }
  return pdf;
}

export async function generateWorkflowSummary(snapshot: WorkflowSnapshot): Promise<Uint8Array> {
  const bytes = await (await summaryPdf(snapshot)).save();
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('The generated summary exceeds 5 MiB. Reduce the included notes or split the export.');
  return bytes;
}

export function buildRegisteredChangeOrderData(job: RestorationJobData, change: JobItem<'change'>,
  workflow: WorkflowPayload, priorChanges: JobItem<'change'>[]): RestorationJobData {
  if (change.jobId !== (job.recordId || job.id)) throw new Error('The selected change belongs to a different job.');
  const copy = structuredClone(job);
  if (change.payload.legacy && !workflow.baselineReviewed) {
    copy.changeOrder = structuredClone(change.payload.legacy);
    return copy;
  }
  if (workflow.contractBaseAmountCents === null || !workflow.baselineReviewed) throw new Error('Review and save the contract baseline before preparing this change order.');
  const cents = [workflow.contractBaseAmountCents, workflow.openingPreviousChangesCents, change.payload.amountCents];
  if (!cents.every(Number.isSafeInteger)) throw new Error('Change-order amounts must be exact integer cents.');
  const prior = [...new Map(priorChanges.filter(item => item.itemId !== change.itemId).map(item => [item.itemId, item])).values()];
  if (prior.some(item => item.jobId !== change.jobId)) throw new Error('Previous changes belong to a different job.');
  const previous = workflow.openingPreviousChangesCents + prior.filter(item => !item.deletedAt && item.payload.lifecycle !== 'void'
    && item.payload.customerDecision.status === 'approved').reduce((sum, item) => sum + item.payload.amountCents, 0);
  if (!Number.isSafeInteger(previous) || !Number.isSafeInteger(workflow.contractBaseAmountCents + previous + change.payload.amountCents)) {
    throw new Error('The revised contract amount exceeds the supported exact-cent range.');
  }
  copy.changeOrder = { changeOrderNumber: change.payload.number || 'DRAFT', changeOrderDate: change.payload.customerDecision.date || change.createdAt.slice(0, 10),
    isInsuranceRelated: change.payload.insuranceRelated, scopeDescription: change.payload.scope,
    originalContractSum: workflow.contractBaseAmountCents / 100, netPreviousChanges: previous / 100,
    changeAmount: Math.abs(change.payload.amountCents) / 100,
    changeType: change.payload.amountCents < 0 ? 'decrease' : change.payload.amountCents > 0 ? 'increase' : 'unchanged', addedDays: change.payload.addedDays };
  return copy;
}

export async function generateRegisteredChangeOrder(job: RestorationJobData, change: JobItem<'change'>,
  workflow: WorkflowPayload, priorChanges: JobItem<'change'>[]): Promise<Uint8Array> {
  const adapted = buildRegisteredChangeOrderData(job, change, workflow, priorChanges);
  const original = await generateChangeOrder(adapted);
  const pdf = await PDFDocument.load(original);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  if (wrappedLines(adapted.changeOrder.scopeDescription, font, 8.5, 480).length <= 9) return original;
  // Preserve the approved original form; append the complete scope when its fixed box is too small.
  const snapshot = makeSnapshot(job, [change], 'handoff', 'internal', [section('Complete change-order scope', [
    row('Change number', adapted.changeOrder.changeOrderNumber), row('Scope - continuation of original change order', adapted.changeOrder.scopeDescription),
  ])], [], { reviewState: change.payload.documentArtifactId ? 'final' : 'draft' });
  const appendix = await PDFDocument.load(await generateWorkflowSummary(snapshot));
  const copied = await pdf.copyPages(appendix, appendix.getPageIndices());
  copied.forEach(page => pdf.addPage(page));
  const bytes = await pdf.save();
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('The generated change order exceeds 5 MiB. Reduce the included scope or split its supporting files.');
  return bytes;
}

async function output(fileName: string, mimeType: string, bytes: Uint8Array): Promise<WorkflowOutput> {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`${fileName} exceeds 5 MiB. Split the export before publishing.`);
  return { fileName, mimeType, bytes, sha256: await sha256Bytes(bytes) };
}

async function photoAppendices(photos: SelectedExportFile[], snapshot: WorkflowSnapshot): Promise<WorkflowOutput[]> {
  const outputs: WorkflowOutput[] = [];
  let current: SelectedExportFile[] = [];
  const render = async (selected: SelectedExportFile[]) => {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const photo of selected) {
      const mime = photo.attachment.payload.mimeType;
      const imageBytes = mime === 'image/webp' ? new Uint8Array(await (await normalizeSupportingPhoto(new Blob([Uint8Array.from(photo.bytes).buffer], { type: mime }))).arrayBuffer()) : photo.bytes;
      const image = mime === 'image/png' ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
      const page = pdf.addPage([612, 792]);
      page.drawText('Hays+Sons', { x: 48, y: 746, size: 20, font: bold, color: INK });
      page.drawText(`COMPLETION PHOTOS${snapshot.reviewState === 'draft' ? ' - DRAFT' : ''}`, { x: 48, y: 714, size: 13, font: bold, color: RED });
      page.drawRectangle({ x: 48, y: 700, width: 516, height: 2, color: RED });
      const title = photo.attachment.payload.caption || photo.attachment.payload.filename;
      const captionLines = wrappedLines(title, regular, 9, 516);
      // A very long caption uses separate continuation pages, never clips the photo or text.
      const captionHeight = Math.min(captionLines.length, 8) * 13;
      const maxHeight = 590 - captionHeight;
      const scale = Math.min(516 / image.width, maxHeight / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, { x: 48 + (516 - width) / 2, y: 676 - height, width, height });
      captionLines.slice(0, 8).forEach((line, index) => page.drawText(line, { x: 48, y: 676 - height - 20 - index * 13, size: 9, font: regular, color: INK }));
      for (let start = 8; start < captionLines.length; start += 44) {
        const continuation = pdf.addPage([612, 792]);
        continuation.drawText('Photo caption continued', { x: 48, y: 742, size: 13, font: bold, color: INK });
        captionLines.slice(start, start + 44).forEach((line, index) => continuation.drawText(line, { x: 48, y: 710 - index * 14, size: 9, font: regular, color: INK }));
      }
    }
    pdf.getPages().forEach((page, index) => page.drawText(`${safeAttachmentName(snapshot.jobNumber || 'Job')} | ${snapshot.audience} | Page ${index + 1} of ${pdf.getPageCount()}`,
      { x: 48, y: 32, size: 8, font: regular, color: MUTED }));
    return pdf.save();
  };
  for (const photo of photos) {
    const trial = await render([...current, photo]);
    if (trial.byteLength <= MAX_ATTACHMENT_BYTES) { current.push(photo); continue; }
    if (!current.length) throw new Error(`${photo.attachment.payload.filename} creates a photo appendix larger than 5 MiB. Prepare a smaller supporting photo.`);
    outputs.push(await output(`photo-appendix-${String(outputs.length + 1).padStart(2, '0')}.pdf`, 'application/pdf', await render(current)));
    current = [photo];
    if ((await render(current)).byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`${photo.attachment.payload.filename} creates a photo appendix larger than 5 MiB. Prepare a smaller supporting photo.`);
  }
  if (current.length) outputs.push(await output(`photo-appendix-${String(outputs.length + 1).padStart(2, '0')}.pdf`, 'application/pdf', await render(current)));
  return outputs;
}

export async function createCloseoutExport(job: RestorationJobData, sourceItems: JobItem[], audience: ExportAudience,
  selectedFiles: SelectedExportFile[], options: SnapshotOptions = {}): Promise<CloseoutExport> {
  const items = scopedItems(job, sourceItems);
  if (selectedFiles.reduce((sum, file) => sum + file.bytes.byteLength, 0) > MAX_EXPORT_SOURCE_BYTES) {
    throw new Error('Selected source files exceed 25 MiB. Split the export; no files have been omitted.');
  }
  const seen = new Set<string>();
  const verifiedFiles: SelectedExportFile[] = [];
  const available = new Map(itemOf(items, 'attachment').map(item => [item.itemId, item]));
  for (const selected of selectedFiles) {
    const { attachment, bytes } = selected;
    if (seen.has(attachment.itemId)) throw new Error(`Duplicate selected attachment: ${attachment.payload.filename}.`);
    seen.add(attachment.itemId);
    const canonical = available.get(attachment.itemId);
    if (!canonical || canonical.revision !== attachment.revision || attachment.jobId !== (job.recordId || job.id)) throw new Error(`Attachment metadata is not available for ${attachment.payload.filename}. Refresh and retry.`);
    if (canonical.payload.uploadState !== 'ready' || attachment.payload.uploadState !== 'ready') throw new Error(`${canonical.payload.filename} is not ready. Wait for its upload or remove it from the selection.`);
    if (bytes.byteLength !== canonical.payload.byteSize || bytes.byteLength > MAX_ATTACHMENT_BYTES || !bytes.byteLength) throw new Error(`${canonical.payload.filename} has unavailable or mismatched bytes. Download it again before exporting.`);
    if (detectAttachmentMime(bytes) !== canonical.payload.mimeType) throw new Error(`${canonical.payload.filename} has an invalid file signature.`);
    if (await sha256Bytes(bytes) !== canonical.payload.sha256) throw new Error(`${canonical.payload.filename} has a mismatched file hash. Download it again before exporting.`);
    // Use canonical metadata, so caller-supplied names/captions never bypass the reviewed record.
    verifiedFiles.push({ attachment: canonical, bytes });
  }
  const snapshot = buildCloseoutSnapshot(job, items, audience, options);
  const outputs = [await output('completion-summary.pdf', 'application/pdf', await generateWorkflowSummary(snapshot)),
    ...await photoAppendices(verifiedFiles.filter(file => file.attachment.payload.mimeType.startsWith('image/')), snapshot)];
  const zip = new JSZip();
  const selectedManifest: CloseoutManifest['selectedFiles'] = [];
  for (const [index, selected] of verifiedFiles.entries()) {
    const metadata = selected.attachment.payload;
    const path = `evidence/${String(index + 1).padStart(2, '0')}-${safeAttachmentName(metadata.filename)}`;
    zip.file(path, selected.bytes);
    selectedManifest.push({ attachmentId: selected.attachment.itemId, revision: selected.attachment.revision, path,
      mimeType: metadata.mimeType, byteSize: metadata.byteSize, sha256: metadata.sha256, caption: metadata.caption || '' });
  }
  outputs.forEach(file => zip.file(file.fileName, file.bytes));
  const manifest: CloseoutManifest = freezeCopy({ version: 1, audience, reviewState: snapshot.reviewState, generatedAt: snapshot.generatedAt,
    jobNumber: snapshot.jobNumber, sourceRevisions: snapshot.sourceRevisions,
    entries: [...outputs.map(file => file.fileName), ...selectedManifest.map(file => file.path), 'manifest.json'], selectedFiles: selectedManifest,
    generatedFiles: outputs.map(file => ({ path: file.fileName, byteSize: file.bytes.byteLength, sha256: file.sha256 })), reviewWarnings: snapshot.reviewWarnings });
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  zip.file('manifest.json', manifestBytes);
  outputs.push(await output('manifest.json', 'application/json', manifestBytes));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 5 } });
  return { bytes, fileName: `${safeAttachmentName(job.customer.jobNumber || 'Job')}-${audience}-closeout.zip`, manifest, snapshot, outputs };
}
