import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createEmptyJob } from '../src/types/jobData';
import { createWorkflow, itemOf } from '../src/types/workflow';
globalThis.indexedDB = new IDBFactory();
const legacyJob = { recordId: 'legacy-job', record: { customer: { customerName: 'Retained draft' }, customLegacyField: 'keep me' }, syncState: 'pending-save', owner: 'office@example.com' };
const legacyOperation = { id: 1, type: 'save', recordId: 'legacy-job', job: legacyJob.record, owner: 'office@example.com' };
await new Promise<void>((resolve, reject) => {
  const request = indexedDB.open('hays.docsuite', 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('jobs', { keyPath: 'recordId' });
    db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('drafts', { keyPath: 'id' });
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction(['jobs', 'outbox', 'drafts'], 'readwrite');
    tx.objectStore('jobs').put(legacyJob);
    tx.objectStore('outbox').put(legacyOperation);
    tx.objectStore('drafts').put({ id: 'legacy-draft', job: legacyJob.record });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => reject(tx.error);
  };
});
const store = await import('../src/services/workflowStore');
const owner = 'office@example.com';
const payload = createWorkflow(createEmptyJob());

test('v1 upgrade preserves jobs, unknown fields, drafts and pending writes while adding workflow stores', async () => {
  const { openWorkspaceDb } = await import('../src/services/localDb');
  const db = await openWorkspaceDb();
  assert.equal(db.version, 2);
  for (const name of ['workflowItems', 'workflowOutbox', 'workflowBlobs', 'workflowConflicts']) assert.ok(db.objectStoreNames.contains(name));
  const read = (name: string, key: IDBValidKey) => new Promise((resolve, reject) => {
    const request = db.transaction(name, 'readonly').objectStore(name).get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  assert.deepEqual(await read('jobs', 'legacy-job'), legacyJob);
  assert.deepEqual(await read('outbox', 1), legacyOperation);
  assert.deepEqual(await read('drafts', 'legacy-draft'), { id: 'legacy-draft', job: legacyJob.record });
});
test('queued items persist atomically and account switching does not expose them', async () => {
  await store.queueWorkflowItem(owner, 'job-1', 'workflow', 'workflow:job-1', payload);
  assert.equal((await store.cachedWorkflowItems(owner, 'job-1')).length, 1);
  assert.equal((await store.cachedWorkflowItems('other@example.com', 'job-1')).length, 0);
  assert.equal((await store.workflowOperations(owner)).length, 1);
});
test('lost response retries identical intent and does not duplicate an update', async () => {
  const intents: string[] = [];
  let fail = true;
  await store.flushWorkflowQueue(owner, async (op) => {
    intents.push(op.key);
    if (fail) { fail = false; throw Object.assign(new Error('network'), { code: 'network_error' }); }
    return { ...(await store.cachedWorkflowItems(owner, 'job-1'))[0], revision: 1 };
  });
  await store.retryWorkflowErrors(owner);
  await store.flushWorkflowQueue(owner, async (op) => { intents.push(op.key); return { ...(await store.cachedWorkflowItems(owner, 'job-1'))[0], revision: 1 }; });
  assert.equal(intents[0], intents[1]);
  assert.equal((await store.workflowOperations(owner)).length, 0);
});
test('stale server reads preserve local pending state and conflict blocks only its target', async () => {
  await store.queueWorkflowItem(owner, 'job-1', 'workflow', 'workflow:job-1', { ...payload, stage: 'in_production' });
  const local = itemOf(await store.cachedWorkflowItems(owner, 'job-1'), 'workflow')[0];
  await store.cacheWorkflowItems(owner, [{ ...local, revision: 3, payload }]);
  assert.equal(itemOf(await store.cachedWorkflowItems(owner, 'job-1'), 'workflow')[0].payload.stage, 'in_production');
  await store.queueWorkflowItem(owner, 'job-2', 'workflow', 'workflow:job-2', payload);
  await store.flushWorkflowQueue(owner, async op => {
    if (op.jobId === 'job-1') throw Object.assign(new Error('changed elsewhere'), { code: 'conflict', details: { current: { ...local, revision: 3, payload } } });
    return { ...(await store.cachedWorkflowItems(owner, op.jobId))[0], revision: 1 };
  });
  assert.equal((await store.workflowOperations(owner)).length, 1);
  assert.equal((await store.workflowConflicts(owner)).length, 1);
  await store.resolveWorkflowConflict(owner, 'job-1', 'workflow:job-1', 'server');
  assert.equal((await store.workflowOperations(owner)).length, 0);
  assert.equal((await store.cachedWorkflowItems(owner, 'job-1'))[0].revision, 3);
});
test('an acknowledgement cannot overwrite a newer local edit and its next base revision advances', async () => {
  await store.queueWorkflowItem(owner, 'job-race', 'workflow', 'workflow:job-race', payload);
  let calls = 0;
  await store.flushWorkflowQueue(owner, async op => {
    calls++;
    if (calls === 1) await store.queueWorkflowItem(owner, op.jobId, 'workflow', op.itemId, { ...payload, stage: 'closeout' });
    return { ...itemOf(await store.cachedWorkflowItems(owner, op.jobId), 'workflow')[0], revision: calls, payload: calls === 1 ? payload : { ...payload, stage: 'closeout' } };
  });
  const remaining = await store.workflowOperations(owner);
  if (remaining.length) {
    assert.equal(itemOf(await store.cachedWorkflowItems(owner, 'job-race'), 'workflow')[0].payload.stage, 'closeout');
    await store.flushWorkflowQueue(owner, async op => {
      assert.equal(op.expectedRevision, 1);
      return { ...(await store.cachedWorkflowItems(owner, op.jobId))[0], revision: 2 };
    });
  }
  assert.equal(itemOf(await store.cachedWorkflowItems(owner, 'job-race'), 'workflow')[0].payload.stage, 'closeout');
});
test('edits queued in the same millisecond replay in durable creation order', async () => {
  const original = Date.now; Date.now = () => 1000;
  try {
    await store.queueWorkflowItem(owner, 'job-order', 'workflow', 'workflow:job-order', payload);
    await store.queueWorkflowItem(owner, 'job-order', 'workflow', 'workflow:job-order', { ...payload, stage: 'closeout' });
  } finally { Date.now = original; }
  const stages: string[] = [];
  await store.flushWorkflowQueue(owner, async op => {
    stages.push((op.payload as typeof payload).stage);
    assert.equal(op.expectedRevision, stages.length - 1);
    return { ...(await store.cachedWorkflowItems(owner, op.jobId))[0], payload: op.payload, revision: stages.length } as any;
  });
  assert.deepEqual(stages, ['intake', 'closeout']);
});
test('a busy target blocks subsequent edits and dependent uploads but unrelated work continues', async () => {
  const { draftItem } = await import('../src/types/workflow');
  await store.queueWorkflowItem(owner, 'job-busy', 'activity', 'note', { note: 'First', occurredAt: new Date().toISOString(), source: 'manual', attachmentIds: [] });
  await store.queueWorkflowItem(owner, 'job-busy', 'activity', 'note', { note: 'Later', occurredAt: new Date().toISOString(), source: 'manual', attachmentIds: [] });
  await store.queueWorkflowFile(owner, draftItem('job-busy', 'attachment', 'file', { filename: 'evidence.pdf', mimeType: 'application/pdf', byteSize: 5, sha256: 'a'.repeat(64), driveFileId: '', parent: { kind: 'activity', itemId: 'note' }, uploadState: 'reserved' }), new Blob(['%PDF-']));
  await store.queueWorkflowItem(owner, 'job-independent', 'workflow', 'workflow:job-independent', payload);
  const sent: string[] = [];
  await store.flushWorkflowQueue(owner, async op => {
    sent.push(`${op.jobId}:${op.itemId}`);
    if (op.jobId === 'job-busy') throw Object.assign(new Error('Busy'), { code: 'busy' });
    return { ...(await store.cachedWorkflowItems(owner, op.jobId))[0], revision: 1 };
  });
  assert.deepEqual(sent, ['job-busy:note', 'job-independent:workflow:job-independent']);
  assert.equal((await store.workflowOperations(owner)).filter(op => op.jobId === 'job-busy').length, 3);
});
test('a publication persists every dependent step and resumes the same files after lost acknowledgement', async () => {
  const { draftItem } = await import('../src/types/workflow');
  const jobId = 'job-publication', artifactId = 'artifact';
  const artifact = draftItem(jobId, 'artifact', artifactId, { type: 'handoff', sourceRevisions: {}, generatedAt: new Date().toISOString(), generatedBy: owner, snapshotAttachmentId: 'snapshot', outputAttachmentIds: ['output'], reviewState: 'final' });
  const files = ['snapshot', 'output'].map(id => ({ blob: new Blob(['%PDF-']), item: draftItem(jobId, 'attachment', id, { filename: `${id}.pdf`, mimeType: 'application/pdf', byteSize: 5, sha256: 'b'.repeat(64), driveFileId: '', parent: { kind: 'artifact', itemId: artifactId }, uploadState: 'reserved' }) }));
  await store.queueArtifactPublication(owner, artifact, files);
  assert.equal((await store.workflowOperations(owner)).filter(op => op.jobId === jobId).length, 4);
  let failed = false;
  const sent: string[] = [], revisions = new Map<string, number>();
  const sender: typeof store.flushWorkflowQueue extends (owner: string, send: infer S, ...args: any[]) => any ? S : never = async op => {
    if (op.jobId !== jobId) throw Object.assign(new Error('busy'), { code: 'busy' });
    sent.push(op.key);
    if (op.itemId === 'output' && !failed) { failed = true; throw Object.assign(new Error('response lost'), { code: 'timeout' }); }
    const revision = (revisions.get(op.itemId) ?? 0) + 1; revisions.set(op.itemId, revision);
    return { ...(await store.cachedWorkflowItems(owner, jobId)).find(item => item.itemId === op.itemId)!, payload: op.kind === 'attachment' ? { ...op.payload, uploadState: 'ready', driveFileId: `drive-${op.itemId}` } : op.payload, revision } as any;
  };
  await store.flushWorkflowQueue(owner, sender);
  const pending = (await store.workflowOperations(owner)).filter(op => op.jobId === jobId);
  assert.equal(pending.length, 2);
  assert.equal(pending[0].itemId, 'output');
  assert.equal(pending[1].itemId, artifactId);
  assert.equal((await store.cachedWorkflowBlob(owner, jobId, 'output'))?.size, 5);
  await store.retryWorkflowErrors(owner);
  await store.flushWorkflowQueue(owner, sender);
  assert.equal(sent.filter(id => id === pending[0].key).length, 2);
  assert.equal((await store.workflowOperations(owner)).filter(op => op.jobId === jobId).length, 0);
  assert.equal(itemOf(await store.cachedWorkflowItems(owner, jobId), 'artifact')[0].revision, 2);
});
