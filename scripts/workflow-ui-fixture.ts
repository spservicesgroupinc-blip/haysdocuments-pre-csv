import type { BrowserContext, Page, Route } from '@playwright/test';
import { createEmptyJob, type RestorationJobData } from '../src/types/jobData';
import { createWorkflow, draftItem, type ItemKind, type ItemPayloads, type JobItem } from '../src/types/workflow';

export const editor = { email: 'workflow-editor@example.com', name: 'Workflow Editor', role: 'editor' };
export const endpoint = 'https://script.google.com/macros/s/*/exec';
const now = () => new Date().toISOString();
const json = (route: Route, value: unknown) => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(value) });
export function fixtureJob(): RestorationJobData {
  const job = createEmptyJob();
  job.recordId = 'workflow-ui-job'; job.id = 'workflow-ui-job'; job.revision = 1; job.updatedAt = '2026-10-19T12:00:00Z';
  Object.assign(job.customer, { jobNumber: 'WF-UI-100', customerName: 'Workflow customer', lossAddress: '100 Review Street', mainPhone: '260-555-0100', email: 'customer@example.com' });
  Object.assign(job.insurance, { carrier: 'Fixture Carrier', claimNumber: 'WF-CLAIM-100', lossDescription: 'Kitchen water restoration' });
  job.financials.totalApprovedRcv = 10000; job.financials.deductible = 500;
  job.productionNotes.scopeSummary = 'Repair kitchen and replace damaged flooring.';
  job.productionNotes.scheduleAndAccess = 'PRIVATE-ACCESS-CODE-5192';
  job.checklist.projectManagerNotes = 'PRIVATE-INTERNAL-NOTE'; job.mortgage.last4Ssn = '9876';
  return job;
}

export class WorkflowMock {
  job = fixtureJob();
  items = new Map<string, JobItem>();
  calls: Record<string, unknown>[] = [];
  journal = new Map<string, unknown>();
  fileBytes = new Map<string, string>();
  staleReads = new Map<string, JobItem[]>();
  users = new Map<string, typeof editor>();
  blockWrites = false;
  loseUploadResponse = false;
  uploadAttempts = 0;
  nextNumber = 1;
  seed<K extends ItemKind>(kind: K, id: string, payload: ItemPayloads[K]) {
    const item = { ...draftItem(this.job.recordId!, kind, id, payload, editor.email), revision: 1 } as JobItem<K>;
    this.items.set(id, item); return item;
  }
  seedWorkflow() { return this.seed('workflow', `workflow:${this.job.recordId}`, createWorkflow(this.job)); }
  async install(context: BrowserContext, account = editor) {
    const token = `session-${account.email}`; this.users.set(token, account);
    await context.addInitScript(({ user, token: sessionToken }) => localStorage.setItem('hays.db.session', JSON.stringify({ token: sessionToken, expiresAt: '2099-01-01T00:00:00Z', user })), { user: account, token });
    await context.route(endpoint, route => this.handle(route));
  }
  summary() { return { recordId: this.job.recordId, revision: this.job.revision, jobNumber: this.job.customer.jobNumber, customerName: this.job.customer.customerName, jobName: '', lossAddress: this.job.customer.lossAddress, email: this.job.customer.email, carrier: this.job.insurance.carrier, claimNumber: this.job.insurance.claimNumber, status: 'Draft', createdAt: this.job.dateCreated, updatedAt: this.job.updatedAt, updatedBy: editor.email, schemaVersion: 2, deleted: false, record: this.job }; }
  async handle(route: Route) {
    const body = route.request().postDataJSON() as Record<string, any>;
    this.calls.push(body);
    const user = this.users.get(body.sessionToken) || editor;
    const ok = (data: unknown) => json(route, { ok: true, data });
    const fail = (code: string, error: string, details?: unknown) => json(route, { ok: false, code, error, details });
    const writes = ['saveJob', 'saveDraft', 'saveWorkspaceDraft', 'mutateJobItem', 'reserveJobAttachment', 'uploadJobAttachment', 'deleteJob'];
    if (writes.includes(body.action) && user.role === 'viewer') return fail('forbidden', 'Viewers cannot modify jobs.');
    if (writes.includes(body.action) && this.blockWrites) return route.abort('connectionfailed');
    if (body.action === 'checkSession') return ok({ user });
    if (body.action === 'getCapabilities') return ok({ apiVersion: 2, revisionProtection: true, features: ['workflow', 'job-items', 'attachments', 'artifacts', 'scoped-drafts'], attachmentConfigured: true, attachments: { configured: true, maxBytes: 5 * 1024 * 1024 } });
    if (body.action === 'listJobs') return ok({ jobs: [this.summary()], count: 1 });
    if (body.action === 'getJob') return ok({ job: this.job, updatedAt: this.job.updatedAt, updatedBy: editor.email });
    if (body.action === 'getDraft') return ok({ draft: { job: this.job, recordId: this.job.recordId, updatedAt: this.job.updatedAt, updatedBy: editor.email } });
    if (body.action === 'listWorkspaceDrafts') return ok({ drafts: [{ job: this.job, recordId: this.job.recordId, revision: 1, updatedAt: this.job.updatedAt, updatedBy: editor.email }] });
    if (body.action === 'saveWorkspaceDraft' || body.action === 'saveDraft') return ok({ job: body.job || body.draft.job, recordId: body.jobId || body.draft?.recordId, revision: 2, updatedAt: now(), updatedBy: user.email });
    if (body.action === 'saveJob') {
      if (this.journal.has(body.mutationId)) return ok(this.journal.get(body.mutationId));
      this.job = { ...body.job, revision: (this.job.revision || 0) + 1, updatedAt: now() };
      const result = { record: this.job, recordId: this.job.recordId, created: false }; this.journal.set(body.mutationId, result); return ok(result);
    }
    if (body.action === 'listJobWorkflowSummaries') {
      const workflow = [...this.items.values()].find(item => item.kind === 'workflow') as JobItem<'workflow'> | undefined;
      return ok({ summaries: [{ jobId: this.job.recordId, stage: workflow?.payload.stage || 'intake', nextAction: workflow?.payload.nextAction || null }] });
    }
    if (body.action === 'listJobItems') return ok({ items: this.staleReads.get(user.email) || [...this.items.values()], nextCursor: null });
    if (body.action === 'mutateJobItem') {
      if (this.journal.has(body.mutationId)) return ok(this.journal.get(body.mutationId));
      const prior = this.items.get(body.itemId);
      if ((prior?.revision || 0) !== body.expectedRevision) return fail('conflict', 'Another editor updated this record.', { current: prior });
      const payload = structuredClone(body.payload);
      if (body.kind === 'change' && payload.lifecycle === 'submitted' && !payload.number) payload.number = `CO-${String(this.nextNumber++).padStart(3, '0')}`;
      const item = { ...(prior || draftItem(body.jobId, body.kind, body.itemId, payload, user.email)), payload, revision: (prior?.revision || 0) + 1, updatedAt: now(), updatedBy: user.email, lastMutationId: body.mutationId, deletedAt: body.operation === 'delete' ? now() : null } as JobItem;
      this.items.set(item.itemId, item); const result = { item }; this.journal.set(body.mutationId, result); return ok(result);
    }
    if (body.action === 'reserveJobAttachment') {
      let item = this.items.get(body.attachmentId);
      if (!item) item = this.seed('attachment', body.attachmentId, { filename: body.filename, mimeType: body.mimeType, byteSize: body.byteSize, sha256: body.sha256, driveFileId: `private-${body.attachmentId}`, parent: body.parent, uploadState: 'reserved' });
      return ok({ item });
    }
    if (body.action === 'uploadJobAttachment') {
      this.uploadAttempts++;
      const prior = this.items.get(body.attachmentId) as JobItem<'attachment'>;
      this.fileBytes.set(body.attachmentId, body.base64);
      const item = prior.payload.uploadState === 'ready' ? prior : { ...prior, revision: prior.revision + 1, updatedAt: now(), payload: { ...prior.payload, uploadState: 'ready' as const } };
      this.items.set(body.attachmentId, item);
      if (this.loseUploadResponse) { this.loseUploadResponse = false; return route.abort('connectionfailed'); }
      return ok({ item });
    }
    if (body.action === 'getJobAttachment') { const item = this.items.get(body.attachmentId) as JobItem<'attachment'>; return ok({ base64: this.fileBytes.get(body.attachmentId), mimeType: item.payload.mimeType }); }
    return fail('unknown_action', `Unhandled fixture action: ${body.action}`);
  }
}

export async function openWorkflow(page: Page, section: 'Updates' | 'Handoff' | 'Selections' | 'Change Order' | 'Closeout') {
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Production', exact: true }).click();
  const picker = page.getByLabel('Production section', { exact: true });
  if (await picker.isVisible()) await picker.selectOption({ label: section });
  else await page.getByRole('navigation', { name: 'Production sections', exact: true }).getByRole('button', { name: section, exact: true }).click();
}
