import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyJob } from '../src/types/jobData';
import { createWorkflow, migrateLegacyChange, authorizedContractTotal, isOverdue, validatePayload } from '../src/types/workflow';

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
