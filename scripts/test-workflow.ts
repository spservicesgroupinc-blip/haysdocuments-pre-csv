import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyJob } from '../src/types/jobData';
import { createWorkflow, migrateLegacyChange, authorizedContractTotal, isOverdue, validatePayload, handoffBlockers } from '../src/types/workflow';

test('unknown money stays unknown and blank legacy changes do not become requests', () => {
  const job = createEmptyJob();
  assert.equal(createWorkflow(job).contractBaseAmountCents, null);
  assert.equal(migrateLegacyChange(job), null);
});
test('legacy changes retain exact values without inventing approval', () => {
  const job = createEmptyJob();
  job.changeOrder.scopeDescription = 'Additional drywall';
  job.changeOrder.changeAmount = 125.35;
  job.changeOrder.changeType = 'decrease';
  const change = migrateLegacyChange(job)!;
  assert.equal(change.payload.amountCents, -12535);
  assert.equal(change.payload.customerDecision.status, 'pending');
  assert.equal(migrateLegacyChange(job)!.itemId, change.itemId);
});
test('authorized contract total counts only authorized non-void signed amounts once', () => {
  const job = createEmptyJob();
  const workflow = { ...createWorkflow(job), contractBaseAmountCents: 10000, openingPreviousChangesCents: 125 };
  job.changeOrder.scopeDescription = 'Credit';
  job.changeOrder.changeAmount = 1.25;
  job.changeOrder.changeType = 'decrease';
  const change = migrateLegacyChange(job)!;
  assert.equal(authorizedContractTotal(workflow, [change]), 10125);
  change.payload.customerDecision = { status: 'approved', name: 'Customer', date: '2026-10-19', note: '', evidenceIds: [] };
  assert.equal(authorizedContractTotal(workflow, [change, change]), 10000);
  change.payload.lifecycle = 'void';
  assert.equal(authorizedContractTotal(workflow, [change]), 10125);
});
test('overdue uses Indianapolis calendar dates and never treats today as overdue', () => {
  assert.equal(isOverdue('2026-10-19', '2026-10-20T03:59:00Z'), false);
  assert.equal(isOverdue('2026-10-19', '2026-10-20T04:01:00Z'), true);
  assert.equal(isOverdue('', '2026-10-20T04:01:00Z'), false);
});
test('decisions and cents are validated at boundaries', () => {
  const workflow = createWorkflow(createEmptyJob());
  assert.throws(() => validatePayload('workflow', { ...workflow, stage: 'whatever' }));
  assert.throws(() => validatePayload('workflow', { ...workflow, contractBaseAmountCents: 1.5 }));
  assert.throws(() => validatePayload('selection', { item: 'Floor', decision: { status: 'approved' } }));
});

test('decision dates reject calendar rollover and respect leap years', () => {
  const job = createEmptyJob();
  job.changeOrder.scopeDescription = 'Calendar validation';
  const payload = migrateLegacyChange(job)!.payload;
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01']) {
    assert.throws(() => validatePayload('change', { ...payload,
      customerDecision: { status: 'approved', name: 'Customer', date, note: '', evidenceIds: [] } }));
  }
  assert.doesNotThrow(() => validatePayload('change', { ...payload,
    customerDecision: { status: 'approved', name: 'Customer', date: '2028-02-29', note: '', evidenceIds: [] } }));
});

test('handoff reuses financial readiness while self-pay omits insurance prerequisites', () => {
  const job = createEmptyJob();
  job.financials.totalApprovedRcv = 0;
  job.financials.deductible = '';
  assert.ok(handoffBlockers(job, createWorkflow(job)).includes('Deductible'));
  job.checklist.isSelfPay = true;
  const blockers = handoffBlockers(job, createWorkflow(job));
  assert.ok(!blockers.includes('Insurance carrier'));
  assert.ok(!blockers.includes('Claim number'));
  assert.ok(!blockers.includes('Deductible'));
  assert.ok(!blockers.includes('Approved amount'));
});

test('authorized totals reject unsafe integer overflow rather than round money silently', () => {
  const workflow = { ...createWorkflow(createEmptyJob()), contractBaseAmountCents: Number.MAX_SAFE_INTEGER,
    openingPreviousChangesCents: 1 };
  assert.throws(() => authorizedContractTotal(workflow, []), /range|cents/i);
});
