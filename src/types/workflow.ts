import type { RestorationJobData } from './jobData';

export const STAGES = ['intake', 'awaiting_contract', 'ready_for_production', 'in_production', 'on_hold', 'closeout', 'complete', 'cancelled'] as const;
export type JobStage = typeof STAGES[number];
export const STAGE_LABELS: Record<JobStage, string> = { intake: 'Intake', awaiting_contract: 'Awaiting contract', ready_for_production: 'Ready for production', in_production: 'In production', on_hold: 'On hold', closeout: 'Closeout', complete: 'Complete', cancelled: 'Cancelled' };
export interface ResponsiblePerson { name: string; email?: string }
export interface NextAction { id: string; title: string; responsiblePerson: ResponsiblePerson; dueDate?: string; completedAt?: string }
export interface RecordedDecision { status: 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'not_applicable'; name: string; date: string; note: string; evidenceIds: string[] }
export interface WorkflowPayload {
  stage: JobStage; nextAction: NextAction | null; holdReason: string;
  contractBaseAmountCents: number | null; openingPreviousChangesCents: number;
  baselineReviewed: boolean; latestHandoffArtifactId: string | null;
  confirmations: { contractSigned: boolean; scopeReviewed: boolean; initialPayment: 'pending' | 'recorded' | 'not_applicable'; mortgageReviewed: 'pending' | 'reviewed' | 'not_applicable' };
  handoffOverrideReason: string;
}
export interface ActivityPayload { note: string; occurredAt: string; source: 'manual' | 'system'; attachmentIds: string[]; eventCode?: string; sourceMutationId?: string }
export interface SelectionPayload { room: string; item: string; specification: string; allowanceCents: number | null; neededBy: string; responsiblePerson: ResponsiblePerson; decision: RecordedDecision; attachmentIds: string[] }
export interface ChangePayload {
  number: string; scope: string; insuranceRelated: boolean; amountCents: number; addedDays: number;
  lifecycle: 'draft' | 'submitted' | 'closed' | 'void'; customerDecision: RecordedDecision; carrierDecision: RecordedDecision;
  attachmentIds: string[]; linkedSelectionIds: string[]; documentArtifactId: string | null;
  legacy?: RestorationJobData['changeOrder']; predecessorId?: string;
}
export interface ChecklistDecision { id: string; label: string; state: 'pending' | 'done' | 'not_applicable'; note: string; evidenceIds: string[] }
export interface PunchItem { id: string; title: string; state: 'open' | 'done'; dueDate?: string; responsiblePerson?: ResponsiblePerson }
export interface CloseoutPayload { completionDate: string; checklist: ChecklistDecision[]; punchItems: PunchItem[]; attachmentIds: string[]; latestArtifactId: string | null; completionOverrideReason: string }
export type ItemKind = 'workflow' | 'activity' | 'selection' | 'change' | 'closeout' | 'attachment' | 'artifact';
export interface AttachmentPayload { filename: string; mimeType: string; byteSize: number; sha256: string; driveFileId: string; parent: { kind: ItemKind; itemId: string }; uploadState: 'reserved' | 'ready' | 'failed'; caption?: string; category?: string }
export interface ArtifactPayload { type: 'handoff' | 'change_order' | 'closeout'; sourceRevisions: Record<string, number>; generatedAt: string; generatedBy: string; snapshotAttachmentId: string; outputAttachmentIds: string[]; reviewState: 'draft' | 'final'; audience?: 'internal' | 'customer' | 'carrier' }
export interface ItemPayloads { workflow: WorkflowPayload; activity: ActivityPayload; selection: SelectionPayload; change: ChangePayload; closeout: CloseoutPayload; attachment: AttachmentPayload; artifact: ArtifactPayload }
export type JobItem<K extends ItemKind = ItemKind> = K extends ItemKind ? {
  jobId: string; kind: K; itemId: string; revision: number; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; deletedAt: string | null; lastMutationId: string; payload: ItemPayloads[K];
} : never;

export function newId(): string { return crypto.randomUUID(); }
export function blankDecision(): RecordedDecision { return { status: 'pending', name: '', date: '', note: '', evidenceIds: [] }; }
export function localDate(now: string | Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indianapolis', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function isOverdue(date?: string, now: string | Date = new Date()): boolean { return !!date && date < localDate(now); }
export function toCents(value: number | '' | undefined): number | null { return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null; }
export function createWorkflow(job: RestorationJobData): WorkflowPayload {
  const legacyStage = ({ Draft: 'intake', Active: 'in_production', 'On Hold': 'on_hold', Complete: 'complete', Cancelled: 'cancelled' } as Record<string, JobStage>)[String((job as RestorationJobData & { status?: string }).status)] || 'intake';
  return { stage: legacyStage, nextAction: null, holdReason: '', contractBaseAmountCents: null, openingPreviousChangesCents: 0, baselineReviewed: false, latestHandoffArtifactId: null,
    confirmations: { contractSigned: false, scopeReviewed: false, initialPayment: 'pending', mortgageReviewed: job.mortgage.hasMortgage ? 'pending' : 'not_applicable' }, handoffOverrideReason: '' };
}
export function createCloseout(): CloseoutPayload {
  return { completionDate: '', checklist: ['Work completion recorded', 'Punch items resolved', 'Completion / acceptance evidence recorded', 'Final invoice evidence reviewed', 'Completion photos reviewed', 'Depreciation submission status recorded'].map((label, index) => ({ id: `closeout-${index}`, label, state: 'pending', note: '', evidenceIds: [] })), punchItems: [], attachmentIds: [], latestArtifactId: null, completionOverrideReason: '' };
}
export function itemOf<K extends ItemKind>(items: JobItem[], kind: K): JobItem<K>[] { return items.filter(item => item.kind === kind && !item.deletedAt) as JobItem<K>[]; }
export function workflowOf(job: RestorationJobData, items: JobItem[]): WorkflowPayload { return itemOf(items, 'workflow')[0]?.payload ?? createWorkflow(job); }
export function draftItem<K extends ItemKind>(jobId: string, kind: K, itemId: string, payload: ItemPayloads[K], actor = ''): JobItem<K> {
  const now = new Date().toISOString();
  return { jobId, kind, itemId, payload, revision: 0, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, deletedAt: null, lastMutationId: '' } as JobItem<K>;
}
export function migrateLegacyChange(job: RestorationJobData): JobItem<'change'> | null {
  const old = job.changeOrder;
  if (!old.scopeDescription.trim() && old.changeAmount === '' && !Number(old.addedDays)) return null;
  return draftItem(job.recordId || job.id, 'change', `legacy:${job.recordId || job.id}`, { number: old.changeOrderNumber, scope: old.scopeDescription, insuranceRelated: old.isInsuranceRelated,
    amountCents: (toCents(old.changeAmount) ?? 0) * (old.changeType === 'decrease' ? -1 : old.changeType === 'unchanged' ? 0 : 1), addedDays: Number(old.addedDays) || 0, lifecycle: 'draft',
    customerDecision: blankDecision(), carrierDecision: old.isInsuranceRelated ? blankDecision() : { ...blankDecision(), status: 'not_applicable' }, attachmentIds: [], linkedSelectionIds: [], documentArtifactId: null, legacy: structuredClone(old) });
}
export function authorizedContractTotal(workflow: WorkflowPayload, changes: JobItem<'change'>[]): number | null {
  if (workflow.contractBaseAmountCents === null) return null;
  const unique = [...new Map(changes.map(item => [item.itemId, item])).values()];
  return workflow.contractBaseAmountCents + workflow.openingPreviousChangesCents + unique.filter(item => !item.deletedAt && item.payload.lifecycle !== 'void' && item.payload.customerDecision.status === 'approved').reduce((total, item) => total + item.payload.amountCents, 0);
}
export function handoffBlockers(job: RestorationJobData, workflow: WorkflowPayload): string[] {
  const result: string[] = [];
  if (!job.customer.customerName.trim()) result.push('Customer name');
  if (!job.customer.lossAddress.trim()) result.push('Loss property address');
  if (!job.checklist.isSelfPay && !job.insurance.carrier.trim()) result.push('Insurance carrier');
  if (!job.checklist.isSelfPay && !job.insurance.claimNumber.trim()) result.push('Claim number');
  if (job.financials.totalApprovedRcv === '') result.push('Approved amount');
  if (!job.productionNotes.scopeSummary.trim() && !job.insurance.lossDescription.trim()) result.push('Scope summary');
  if (!workflow.confirmations.contractSigned) result.push('Contract recorded signed');
  if (!workflow.confirmations.scopeReviewed) result.push('Approved scope reviewed');
  if (workflow.confirmations.initialPayment === 'pending') result.push('Initial payment status');
  if (job.mortgage.hasMortgage && workflow.confirmations.mortgageReviewed === 'pending') result.push('Mortgage prerequisite review');
  return result;
}
export function closeoutBlockers(closeout: CloseoutPayload): string[] { return [...closeout.checklist.filter(item => item.state === 'pending').map(item => item.label), ...closeout.punchItems.filter(item => item.state === 'open').map(item => `Punch item: ${item.title}`)]; }

function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 8000): value is string => typeof value === 'string' && value.length <= max;
const cents = (value: unknown) => value === null || Number.isSafeInteger(value);
const ids = (value: unknown) => Array.isArray(value) && value.length <= 100 && value.every(id => text(id, 200));
const date = (value: unknown) => value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)));
function person(value: unknown): value is ResponsiblePerson { return isObject(value) && text(value.name, 200) && (value.email === undefined || value.email === '' || (text(value.email, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value.email)))); }
function decision(value: unknown, allowed: string[]): boolean {
  return isObject(value) && allowed.includes(String(value.status)) && text(value.name, 200) && date(value.date) && text(value.note) && ids(value.evidenceIds)
    && (!['approved', 'rejected', 'changes_requested'].includes(String(value.status)) || (!!String(value.name).trim() && !!value.date));
}
export function validatePayload<K extends ItemKind>(kind: K, value: unknown): asserts value is ItemPayloads[K] {
  requireValue(isObject(value) && JSON.stringify(value).length < 40000, 'Invalid or oversized supporting record.');
  const p = value;
  if (kind === 'workflow') {
    requireValue(STAGES.includes(p.stage as JobStage) && text(p.holdReason) && cents(p.contractBaseAmountCents) && Number.isSafeInteger(p.openingPreviousChangesCents) && typeof p.baselineReviewed === 'boolean' && isObject(p.confirmations) && text(p.handoffOverrideReason), 'Invalid workflow.');
    requireValue(p.stage !== 'on_hold' || !!p.holdReason.trim(), 'Enter a reason for placing this job on hold.');
    const a = p.nextAction;
    requireValue(a === null || (isObject(a) && text(a.id, 200) && text(a.title, 500) && !!a.title.trim() && person(a.responsiblePerson) && !!String(a.responsiblePerson.name).trim() && (a.dueDate === undefined || date(a.dueDate))), 'Enter an action and responsible person.');
    requireValue(typeof p.confirmations.contractSigned === 'boolean' && typeof p.confirmations.scopeReviewed === 'boolean' && ['pending', 'recorded', 'not_applicable'].includes(String(p.confirmations.initialPayment)) && ['pending', 'reviewed', 'not_applicable'].includes(String(p.confirmations.mortgageReviewed)), 'Invalid handoff confirmations.');
  } else if (kind === 'activity') {
    requireValue(text(p.note) && !!p.note.trim() && ['manual', 'system'].includes(String(p.source)) && text(p.occurredAt, 40) && !Number.isNaN(Date.parse(p.occurredAt)) && ids(p.attachmentIds), 'Enter a valid update.');
  } else if (kind === 'selection') {
    requireValue(text(p.room, 300) && text(p.item, 300) && !!p.item.trim() && text(p.specification) && cents(p.allowanceCents) && date(p.neededBy) && person(p.responsiblePerson) && decision(p.decision, ['pending', 'approved', 'changes_requested']) && ids(p.attachmentIds), 'Enter a selection and complete any recorded decision.');
  } else if (kind === 'change') {
    requireValue(text(p.number, 100) && text(p.scope) && !!p.scope.trim() && typeof p.insuranceRelated === 'boolean' && Number.isSafeInteger(p.amountCents) && Number.isSafeInteger(p.addedDays) && Number(p.addedDays) >= 0 && ['draft', 'submitted', 'closed', 'void'].includes(String(p.lifecycle)) && decision(p.customerDecision, ['pending', 'approved', 'rejected']) && decision(p.carrierDecision, ['pending', 'approved', 'rejected', 'not_applicable']) && ids(p.attachmentIds) && ids(p.linkedSelectionIds), 'Enter a valid change and complete recorded decisions.');
  } else if (kind === 'closeout') {
    requireValue(date(p.completionDate) && Array.isArray(p.checklist) && Array.isArray(p.punchItems) && ids(p.attachmentIds) && text(p.completionOverrideReason), 'Invalid closeout.');
    requireValue(p.checklist.every(row => isObject(row) && text(row.id, 200) && text(row.label, 500) && ['pending', 'done', 'not_applicable'].includes(String(row.state)) && text(row.note) && ids(row.evidenceIds) && (row.state !== 'not_applicable' || !!row.note.trim())), 'Not-applicable closeout items need a reason.');
    requireValue(p.punchItems.every(row => isObject(row) && text(row.id, 200) && text(row.title, 500) && !!row.title.trim() && ['open', 'done'].includes(String(row.state)) && (row.dueDate === undefined || date(row.dueDate))), 'Invalid punch item.');
  } else if (kind === 'attachment') {
    requireValue(text(p.filename, 255) && text(p.mimeType, 100) && Number.isSafeInteger(p.byteSize) && Number(p.byteSize) > 0 && Number(p.byteSize) <= 5 * 1024 * 1024 && text(p.sha256, 64) && /^[a-f0-9]{64}$/.test(String(p.sha256)) && isObject(p.parent) && text(p.parent.itemId, 200) && ['reserved', 'ready', 'failed'].includes(String(p.uploadState)), 'Invalid attachment metadata.');
  } else if (kind === 'artifact') {
    requireValue(['handoff', 'change_order', 'closeout'].includes(String(p.type)) && isObject(p.sourceRevisions) && Object.values(p.sourceRevisions).every(Number.isSafeInteger) && text(p.generatedAt, 40) && text(p.generatedBy, 254) && text(p.snapshotAttachmentId, 200) && ids(p.outputAttachmentIds) && ['draft', 'final'].includes(String(p.reviewState)), 'Invalid artifact.');
  } else throw new Error('Unsupported supporting record type.');
}
