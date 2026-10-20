import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createEmptyJob } from '../src/types/jobData';
import { createWorkflow, itemOf } from '../src/types/workflow';
globalThis.indexedDB = new IDBFactory();
const store = await import('../src/services/workflowStore');
const owner = 'office@example.com';
const payload = createWorkflow(createEmptyJob());
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
