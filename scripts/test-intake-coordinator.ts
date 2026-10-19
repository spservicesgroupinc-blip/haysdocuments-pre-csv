import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IntakeCoordinator } from '../src/services/intakeCoordinator';
import { parseRawIntakeText, type AiIntakePayload, type ProvenanceRecord } from '../src/services/intakeParser';
import { createEmptyJob } from '../src/types/jobData';

const payload = (fields: Partial<AiIntakePayload>): AiIntakePayload => ({
  customer: {}, insurance: {}, financials: {}, team: {}, mortgage: {},
  changeOrder: {}, productionNotes: {}, checklist: {}, ...fields,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(ai: (text: string, signal?: AbortSignal) => Promise<AiIntakePayload>, local = parseRawIntakeText) {
  let job = createEmptyJob();
  let provenance: ProvenanceRecord = {};
  let applies = 0;
  const coordinator = new IntakeCoordinator({
    getJob: () => job, getProvenance: () => provenance,
    apply: (result) => { job = result.jobData; provenance = result.provenance; applies++; },
    onChange: () => {}, analyzeAi: ai, parseLocal: local,
  });
  return { coordinator, get job() { return job; }, get applies() { return applies; }, get provenance() { return provenance; } };
}

test('local results apply before AI; complementary fields merge and conflicts require a choice', async () => {
  const ai = deferred<AiIntakePayload>();
  const h = harness(() => ai.promise);
  const pending = h.coordinator.start('Customer Name: Jane Smith\nClaim Number: LOCAL-1\nTotal Approved RCV: $12,000');
  assert.equal(h.job.customer.customerName, 'Jane Smith');
  assert.equal(h.coordinator.state.ai.status, 'running');
  ai.resolve(payload({ customer: { customerName: 'Jane Smith', email: 'jane@example.com' }, insurance: { claimNumber: 'AI-2' }, financials: { totalApprovedRcv: '12,000.00', deductible: 500 } }));
  await pending;
  assert.equal(h.job.customer.email, 'jane@example.com');
  assert.equal(h.job.insurance.claimNumber, 'LOCAL-1');
  assert.deepEqual(h.coordinator.state.conflicts.map(c => c.key), ['claimNumber']);
  assert.equal(h.job.financials.netClaimValue, 11500);
  h.coordinator.resolveConflict('claimNumber', true);
  assert.equal(h.job.insurance.claimNumber, 'AI-2');
  assert.equal(h.job.financials.deductible, 500);
  assert.equal(h.provenance.customerName.source, 'EXTRACTED');
});

test('equivalent dates and phone numbers agree after normalization', async () => {
  const h = harness(async () => payload({ customer: { mobilePhone: '260.555.0134' }, insurance: { dateOfLoss: '2025-01-15' } }));
  await h.coordinator.start('Mobile Phone: (260) 555-0134\nDate of Loss: 01/15/2025');
  assert.equal(h.coordinator.state.conflicts.length, 0);
});

test('AI failure preserves local extraction and retry does not reapply local values', async () => {
  let calls = 0;
  const h = harness(async () => { if (++calls === 1) throw new Error('Unavailable'); return payload({ customer: { email: 'retry@example.com' } }); });
  await h.coordinator.start('Customer Name: Local customer');
  assert.equal(h.coordinator.state.ai.status, 'error');
  h.job.customer.customerName = 'Manual correction';
  await h.coordinator.retryAi();
  assert.equal(h.job.customer.customerName, 'Manual correction');
  assert.equal(h.job.customer.email, 'retry@example.com');
});

test('a local parser exception does not prevent AI-only success', async () => {
  const h = harness(async () => payload({ customer: { customerName: 'AI customer' } }), () => { throw new Error('Local failure'); });
  await h.coordinator.start('unstructured source');
  assert.equal(h.coordinator.state.local.status, 'error');
  assert.equal(h.coordinator.state.ai.status, 'success');
  assert.equal(h.job.customer.customerName, 'AI customer');
});

test('both failures or empty extractions leave the existing record untouched', async () => {
  for (const fail of [true, false]) {
    const h = harness(async () => { if (fail) throw new Error('AI failure'); return payload({}); }, fail ? () => { throw new Error('Local failure'); } : parseRawIntakeText);
    h.job.customer.customerName = 'Existing';
    const before = JSON.stringify(h.job);
    await h.coordinator.start('???');
    assert.equal(JSON.stringify(h.job), before);
    assert.equal(h.applies, 0);
    assert.equal(h.coordinator.state.local.status, fail ? 'error' : 'empty');
    assert.equal(h.coordinator.state.ai.status, fail ? 'error' : 'empty');
  }
});

test('late AI protects existing fields, manual edits, and intentionally cleared values', async () => {
  const ai = deferred<AiIntakePayload>();
  const h = harness(() => ai.promise);
  h.job.customer.email = 'existing@example.com';
  const pending = h.coordinator.start('Customer Name: Local customer\nMobile Phone: 260-555-0134');
  h.job.customer.customerName = 'Manual correction';
  h.job.customer.mobilePhone = '';
  ai.resolve(payload({ customer: { customerName: 'AI customer', mobilePhone: '2605550199', email: 'ai@example.com' } }));
  await pending;
  assert.equal(h.job.customer.customerName, 'Manual correction');
  assert.equal(h.job.customer.mobilePhone, '');
  assert.equal(h.job.customer.email, 'existing@example.com');
  assert.equal(h.coordinator.state.conflicts.length, 3);
  h.coordinator.resolveConflict('customerName', false);
  assert.equal(h.job.customer.customerName, 'Manual correction');
});

test('cancelled and superseded runs never apply late responses', async () => {
  const first = deferred<AiIntakePayload>();
  let signal: AbortSignal | undefined;
  const h = harness((text, s) => { signal = s; return text.includes('First') ? first.promise : Promise.resolve(payload({ customer: { email: 'second@example.com' } })); });
  const old = h.coordinator.start('Customer Name: First customer');
  const firstSignal = signal!;
  await h.coordinator.start('Customer Name: Second customer');
  assert.equal(firstSignal.aborted, true);
  first.resolve(payload({ customer: { customerName: 'Stale customer' } }));
  await old;
  assert.equal(h.job.customer.customerName, 'Second customer');
  assert.equal(h.job.customer.email, 'second@example.com');
  const last = deferred<AiIntakePayload>();
  const cancelled = harness(() => last.promise);
  const pending = cancelled.coordinator.start('Customer Name: Before reset');
  cancelled.coordinator.cancel();
  const before = JSON.stringify(cancelled.job);
  last.resolve(payload({ customer: { email: 'late@example.com' } }));
  await pending;
  assert.equal(JSON.stringify(cancelled.job), before);
});

test('accepting a financial conflict recalculates from current financial inputs', async () => {
  const h = harness(async () => payload({ financials: { totalApprovedRcv: 20000 } }));
  await h.coordinator.start('Total Approved RCV: $12,000\nDeductible: $500');
  h.job.financials.deductible = 1000;
  h.coordinator.resolveConflict('totalApprovedRcv', true);
  assert.equal(h.job.financials.netClaimValue, 19000);
  assert.equal(h.job.financials.downPayment, 10000);
});

test('AI fills generated placeholders but preserves existing notes and separate mailing addresses', async () => {
  const h = harness(async () => payload({ insurance: { lossDescription: 'Burst kitchen supply line' }, productionNotes: { scopeSummary: 'AI scope' } }));
  h.job.productionNotes.scopeSummary = 'Office scope';
  h.job.customer.mailingAddress = 'PO Box 42';
  await h.coordinator.start('Customer Name: Jane Smith\nLoss Address: 123 Main St, Fort Wayne, IN 46805');
  assert.equal(h.job.insurance.lossDescription, 'Burst kitchen supply line');
  assert.equal(h.job.customer.mailingAddress, 'PO Box 42');
  assert.equal(h.job.productionNotes.scopeSummary, 'Office scope');
  assert.ok(h.coordinator.state.conflicts.some(c => c.key === 'scopeSummary'));
});

test('malformed AI field values are ignored without affecting local results', async () => {
  const h = harness(async () => payload({ customer: { customerName: { wrong: 'shape' } }, productionNotes: { scopeSummary: ['wrong'] } }));
  await h.coordinator.start('Claim Number: LOCAL-1');
  assert.equal(h.job.customer.customerName, '');
  assert.equal(h.job.productionNotes.scopeSummary, '');
  assert.equal(h.job.insurance.claimNumber, 'LOCAL-1');
  assert.equal(h.coordinator.state.ai.status, 'empty');
});

test('deadline stops a hanging AI call while local results remain usable', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal!: AbortSignal;
  const h = harness((_, s) => { signal = s!; return new Promise(() => {}); });
  const pending = h.coordinator.start('Customer Name: Local customer');
  t.mock.timers.tick(60_000);
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(h.coordinator.state.ai.status, 'error');
  assert.match(h.coordinator.state.ai.error!, /60 seconds/);
  assert.equal(h.job.customer.customerName, 'Local customer');
});

test('late AI does not regenerate defaults the user cleared while waiting', async () => {
  const ai = deferred<AiIntakePayload>();
  const h = harness(() => ai.promise);
  const pending = h.coordinator.start('Customer Name: Local customer\nMobile Phone: 260-555-0134');
  h.job.customer.jobName = '';
  h.job.customer.mainPhone = '';
  h.job.insurance.lossDescription = '';
  ai.resolve(payload({ customer: { email: 'ai@example.com' } }));
  await pending;
  assert.equal(h.job.customer.jobName, '');
  assert.equal(h.job.customer.mainPhone, '');
  assert.equal(h.job.insurance.lossDescription, '');
  assert.equal(h.job.customer.email, 'ai@example.com');
});

test('manual clearing of an existing field AI alone found is protected', async () => {
  const ai = deferred<AiIntakePayload>();
  const h = harness(() => ai.promise);
  h.job.customer.email = 'existing@example.com';
  const pending = h.coordinator.start('Claim Number: LOCAL-1');
  h.job.customer.email = '';
  ai.resolve(payload({ customer: { email: 'ai@example.com' } }));
  await pending;
  assert.equal(h.job.customer.email, '');
  assert.equal(h.coordinator.state.conflicts[0].key, 'email');
});
