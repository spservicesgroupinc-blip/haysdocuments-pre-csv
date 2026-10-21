/** Current backend contract: preserve JSON values; frontend owns normalization. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { environment } from './test-apps-script-harness';

test('save/get/list preserve hostile legacy values, blanks, zero, booleans and unknown fields', () => {
  const e = environment();
  const hostile = {
    recordId: 'legacy-roundtrip', status: 'Draft',
    customer: { customerName: 'Test', jobNumber: 'FW-001', unknown: 'preserve' },
    financials: { totalApprovedRcv: '$24,850.00', deductible: '   ', netClaimValue: 0, downPayment: 0, midProgressPayment: 0, balancePayment: 0, commenceDays: 10, completeDays: 60 },
    insurance: { roughEstimateAmount: ',1,234.56', specialInstructions: '' },
    mortgage: { hasMortgage: false },
    changeOrder: { changeType: 'INCREASE', changeAmount: '3200', addedDays: '', netPreviousChanges: '' },
    checklist: { hasDeductibleBeenCollected: 'yes', isSelfPay: false, isProgramClaim: false, depreciationAmount: '' },
    unknownFutureSection: { original: true },
  };
  const saved = e.call('saveJob_', e.editor, hostile, { protocolVersion: 2, mutationId: randomUUID(), expectedRevision: 0 });
  const loaded = e.call('getJob_', e.viewer, hostile.recordId);
  for (const [key, value] of Object.entries(hostile)) assert.deepEqual(loaded[key], value, `${key} survives without coercion`);
  assert.equal(saved.recordId, hostile.recordId); assert.equal(saved.schemaVersion, 2); assert.equal(saved.revision, 1);
  const listed = e.call('listJobs_', e.viewer, { fullRecords: true });
  assert.equal(listed.length, 1); assert.equal(listed[0].jobNumber, 'FW-001'); assert.deepEqual(listed[0].record, loaded);
  const again = e.call('saveJob_', e.editor, loaded, { protocolVersion: 2, mutationId: randomUUID(), expectedRevision: 1 });
  for (const [key, value] of Object.entries(hostile)) assert.deepEqual(again[key], value, `${key} survives a second round trip`);
});

test('template preserves numeric defaults separately from unknown monetary amounts', () => {
  const e = environment(); const record = e.call('emptyRecordTemplate_');
  assert.equal(record.financials.commenceDays, 10); assert.equal(record.financials.completeDays, 60);
  assert.equal(record.financials.netClaimValue, 0); assert.equal(record.financials.totalApprovedRcv, '');
  assert.equal(record.financials.deductible, ''); assert.equal(record.changeOrder.addedDays, '');
  assert.equal(record.changeOrder.changeAmount, ''); assert.equal(record.changeOrder.changeType, 'increase');
  assert.equal(record.mortgage.hasMortgage, false); assert.equal(record.checklist.isSelfPay, false);
  assert.equal(record.checklist.isProgramClaim, false); assert.equal(record.checklist.hasDeductibleBeenCollected, 'No');
  for (const key of ['insurance', 'financials', 'mortgage', 'changeOrder', 'checklist', 'productionNotes']) assert.ok(record[key]);
});

test('salted password hashing is deterministic, case-sensitive and never stores plaintext', () => {
  const e = environment(); const password = 'correct horse battery';
  const first = e.call('hashPassword_', password, 'salt-aaaaaaaaaaaaaaaaaaaa');
  assert.equal(first, e.call('hashPassword_', password, 'salt-aaaaaaaaaaaaaaaaaaaa'));
  assert.notEqual(first, e.call('hashPassword_', password, 'salt-bbbbbbbbbbbbbbbbbbbb'));
  assert.notEqual(first, e.call('hashPassword_', 'Correct horse battery', 'salt-aaaaaaaaaaaaaaaaaaaa'));
  assert.notEqual(first, password); assert.equal(first.includes('correct'), false);
  assert.equal(Buffer.from(first, 'base64').length, 32);
});

test('routing and shared-secret bypass fail closed unless explicitly configured', () => {
  const e = environment();
  const route = (payload: unknown) => JSON.parse(e.sandbox.doPost({ postData: { contents: JSON.stringify(payload) } }));
  delete e.properties.SHARED_SECRET;
  assert.equal(route({ action: 'getCapabilities', sharedSecret: 'test-only' }).code, 'unauthorized');
  e.properties.SHARED_SECRET = 'test-only';
  assert.equal(route({ action: 'getCapabilities', sharedSecret: 'test-only' }).ok, true);
  assert.equal(route({ action: 'getCapabilities', sharedSecret: 'wrong' }).code, 'unauthorized');
  assert.equal(route({ action: 'getCapabilities', sessionToken: 'unknown' }).code, 'session_expired');
});
