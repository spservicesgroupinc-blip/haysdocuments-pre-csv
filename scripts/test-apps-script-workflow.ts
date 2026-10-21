import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { environment } from './test-apps-script-harness';

const workflow = { stage: 'intake', nextAction: null, holdReason: '', contractBaseAmountCents: null, openingPreviousChangesCents: 0, baselineReviewed: false, latestHandoffArtifactId: null, confirmations: { contractSigned: false, scopeReviewed: false, initialPayment: 'pending', mortgageReviewed: 'not_applicable' }, handoffOverrideReason: '' };
const activity = (note = 'Progress') => ({ note, occurredAt: '2026-10-19T12:00:00.000Z', source: 'manual', attachmentIds: [] });
const errorCode = (code: string) => (error: any) => error.code === code;

test('provisions additive sheets/columns idempotently and exposes authenticated capabilities', () => {
  const e = environment();
  const result = e.call('getCapabilities_', e.viewer);
  assert.equal(result.apiVersion, 2);
  assert.equal(result.revisionEnforcement, false);
  e.call('getCapabilities_', e.viewer);
  assert.equal(e.sheets.get('JobItems')?.rows.length, 1);
  assert.equal(e.sheets.get('JobMutations')?.rows.length, 1);
  assert.deepEqual(e.sheets.get('Jobs')?.rows[0].slice(0, 16), Array.from(e.sandbox.JOB_HEADERS.slice(0, 16)));
  assert.equal(e.sheets.get('Jobs')?.rows[0].filter(x => x === 'Revision').length, 1);
  assert.throws(() => e.call('getCapabilities_', null), errorCode('unauthorized'));
});

test('core creates at revision one, rejects stale saves/deletes and preserves original acknowledgments', () => {
  const e = environment(); const job = e.createJob();
  assert.equal(job.revision, 1);
  const request = { protocolVersion: 2, mutationId: randomUUID(), expectedRevision: 1 };
  const updated = e.call('saveJob_', e.editor, { ...job, status: 'Active' }, request);
  assert.equal(updated.revision, 2);
  assert.throws(() => e.call('saveJob_', e.editor, job, { ...request, mutationId: randomUUID() }), errorCode('conflict'));
  assert.throws(() => e.call('deleteJob_', e.editor, job.recordId, { ...request, mutationId: randomUUID() }), errorCode('conflict'));
  e.call('saveJob_', e.editor, { ...updated, status: 'On Hold' }, { ...request, expectedRevision: 2, mutationId: randomUUID() });
  assert.deepEqual(e.call('saveJob_', e.editor, { ...job, status: 'Active' }, request), updated);
  assert.throws(() => e.call('saveJob_', e.other, { ...job, status: 'Active' }, request), errorCode('idempotency_conflict'));
});

test('compatibility keeps legacy writers until explicit revision protection and blocks shared draft afterward', () => {
  const e = environment(); const job = e.createJob();
  e.call('saveJob_', e.editor, job);
  e.properties.WORKFLOW_ENFORCE_REVISIONS = 'true';
  assert.throws(() => e.call('saveJob_', e.editor, job), errorCode('client_upgrade_required'));
  assert.throws(() => e.call('deleteJob_', e.editor, job.recordId), errorCode('client_upgrade_required'));
  assert.throws(() => e.call('saveDraft_', e.editor, { job }), errorCode('client_upgrade_required'));
});

test('typed items enforce roles, bounds, revisions and same-key payload binding', () => {
  const e = environment(); e.createJob();
  assert.throws(() => e.mutate('workflow', 'workflow:job-1', workflow, {}, e.viewer), errorCode('forbidden'));
  assert.throws(() => e.mutate('unknown', 'bad', {}), errorCode('bad_request'));
  assert.throws(() => e.mutate('workflow', 'workflow:job-1', { ...workflow, stage: 'on_hold' }), errorCode('bad_request'));
  assert.throws(() => e.mutate('activity', 'huge', activity('x'.repeat(40001))), errorCode('record_too_large'));
  const request = { mutationId: randomUUID() };
  const created = e.mutate('workflow', 'workflow:job-1', workflow, request);
  assert.equal(created.item.revision, 1);
  assert.equal(created.item.createdBy, e.editor.email);
  assert.deepEqual(e.mutate('workflow', 'workflow:job-1', workflow, request), created);
  assert.throws(() => e.mutate('workflow', 'workflow:job-1', { ...workflow, stage: 'complete' }, request), errorCode('idempotency_conflict'));
  assert.throws(() => e.mutate('workflow', 'workflow:job-1', workflow, { operation: 'update', expectedRevision: 0 }), errorCode('conflict'));
});

test('different activity items survive, manual corrections require author/admin, generated activity is immutable', () => {
  const e = environment(); e.createJob();
  e.mutate('activity', 'a', activity('First'));
  e.mutate('activity', 'b', activity('Second'), {}, e.other);
  assert.throws(() => e.mutate('activity', 'a', activity('Changed'), { operation: 'update', expectedRevision: 1 }, e.other), errorCode('forbidden'));
  e.mutate('activity', 'a', activity('Corrected'), { operation: 'update', expectedRevision: 1 });
  assert.throws(() => e.mutate('activity', 'system-forged', { ...activity(), source: 'system', eventCode: 'forged', sourceMutationId: randomUUID() }), errorCode('forbidden'));
  const result = e.call('listJobItems_', e.viewer, { jobId: 'job-1', kinds: ['activity'] });
  assert.ok(result.items.some((i: any) => i.payload.note === 'Corrected'));
  assert.ok(result.items.some((i: any) => i.payload.note === 'Second'));
});

test('journal recovers an interrupted row before a subsequent target mutation and replays the earlier acknowledgment', () => {
  const e = environment(); e.createJob();
  const mutationId = randomUUID();
  e.crashOn((name, values) => name === 'JobItems' && values.some(row => row[2] === 'a'));
  assert.throws(() => e.mutate('activity', 'a', activity('First'), { mutationId }), /interrupted/);
  const next = e.mutate('activity', 'a', activity('Second'), { operation: 'update', expectedRevision: 1 });
  assert.equal(next.item.revision, 2);
  const replay = e.mutate('activity', 'a', activity('First'), { mutationId });
  assert.equal(replay.item.revision, 1);
  assert.equal(replay.item.payload.note, 'First');
});

test('journal repairs a lost acknowledgment after row commit without applying the row twice', () => {
  const e = environment(); e.createJob(); const mutationId = randomUUID();
  e.crashOn((name, values) => name === 'JobMutations' && values.some(row => row.includes('applied')));
  assert.throws(() => e.mutate('activity', 'a', activity(), { mutationId }), /interrupted/);
  const replay = e.mutate('activity', 'a', activity(), { mutationId });
  assert.equal(replay.item.revision, 1);
  assert.equal(e.call('listJobItems_', e.viewer, { jobId: 'job-1', kinds: ['activity'] }).items.filter((x: any) => x.itemId === 'a').length, 1);
});

test('stable pagination retains tombstones and rejects cursor reuse for another filter', () => {
  const e = environment(); e.createJob();
  for (let i = 0; i < 5; i++) e.mutate('activity', `a-${i}`, activity(`Note ${i}`));
  e.mutate('activity', 'a-1', undefined, { operation: 'delete', expectedRevision: 1 });
  const first = e.call('listJobItems_', e.viewer, { jobId: 'job-1', kinds: ['activity'], pageSize: 2 });
  assert.equal(first.items.length, 2); assert.ok(first.nextCursor); assert.ok(first.items.find((x: any) => x.itemId === 'a-1').deletedAt);
  const second = e.call('listJobItems_', e.viewer, { jobId: 'job-1', kinds: ['activity'], pageSize: 2, cursor: first.nextCursor });
  assert.equal(second.items[0].itemId, 'a-2');
  assert.throws(() => e.call('listJobItems_', e.viewer, { jobId: 'job-1', kinds: ['workflow'], cursor: first.nextCursor }), errorCode('bad_request'));
});

test('scoped cloud drafts isolate account/device/job while leaving shared recovery readable', () => {
  const e = environment(); const job = e.createJob();
  e.call('saveDraft_', e.editor, { job });
  e.call('saveWorkspaceDraft_', e.editor, { jobId: 'job-1', deviceId: 'device-a', job, expectedRevision: 0, mutationId: randomUUID() });
  e.call('saveWorkspaceDraft_', e.other, { jobId: 'job-1', deviceId: 'device-a', job: { ...job, status: 'Active' }, expectedRevision: 0, mutationId: randomUUID() });
  assert.equal(e.call('listWorkspaceDrafts_', e.editor, { deviceId: 'device-b' }).drafts.length, 0);
  const mine = e.call('listWorkspaceDrafts_', e.editor, { deviceId: 'device-a' });
  assert.equal(mine.drafts.length, 1); assert.equal(mine.drafts[0].job.status, 'Draft');
  assert.ok(e.call('getDraft_', e.viewer).job);
});

function reserve(e: ReturnType<typeof environment>, bytes: Buffer, extra: any = {}, user = e.editor) {
  return e.call('reserveJobAttachment_', user, { jobId: 'job-1', parent: { kind: 'activity', itemId: 'note' }, attachmentId: 'file-1', mutationId: randomUUID(), filename: 'evidence.pdf', mimeType: 'application/pdf', byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...extra });
}

test('private attachment reservation requires configured root, allowed type, parent ownership and editor', () => {
  const e = environment(); e.createJob(); e.mutate('activity', 'note', activity()); const bytes = Buffer.from('%PDF-1.7\nTest');
  assert.throws(() => reserve(e, bytes), errorCode('not_configured'));
  e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root';
  assert.throws(() => reserve(e, bytes, {}, e.viewer), errorCode('forbidden'));
  assert.throws(() => reserve(e, bytes, { mimeType: 'image/heic' }), errorCode('unsupported_file_type'));
  assert.throws(() => reserve(e, bytes, { byteSize: 5 * 1024 * 1024 + 1 }), errorCode('file_too_large'));
  assert.throws(() => reserve(e, bytes, { parent: { kind: 'activity', itemId: 'another-job-note' } }), errorCode('not_found'));
  const saved = reserve(e, bytes);
  assert.equal(saved.item.payload.uploadState, 'reserved'); assert.ok(saved.item.payload.driveFileId);
});

test('upload reconciles a lost Drive response with exact pre-generated file ID and validates byte hash', () => {
  const e = environment(); e.createJob(); e.mutate('activity', 'note', activity()); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root';
  const bytes = Buffer.from('%PDF-1.7\nTest'); const saved = reserve(e, bytes); const mutationId = randomUUID();
  assert.throws(() => e.call('uploadJobAttachment_', e.editor, { jobId: 'job-1', attachmentId: 'file-1', mutationId, base64: Buffer.from('wrong').toString('base64') }), errorCode('invalid_file'));
  e.loseDriveAck();
  assert.throws(() => e.call('uploadJobAttachment_', e.editor, { jobId: 'job-1', attachmentId: 'file-1', mutationId, base64: bytes.toString('base64') }), /response lost/);
  const ready = e.call('uploadJobAttachment_', e.editor, { jobId: 'job-1', attachmentId: 'file-1', mutationId, base64: bytes.toString('base64') });
  assert.equal(ready.item.payload.uploadState, 'ready'); assert.equal(ready.item.payload.driveFileId, saved.item.payload.driveFileId); assert.equal(e.driveCreates(), 1);
  const fetched = e.call('getJobAttachment_', e.viewer, { jobId: 'job-1', attachmentId: 'file-1' }); assert.equal(fetched.base64, bytes.toString('base64'));
  e.createJob('job-2');
  assert.throws(() => e.call('getJobAttachment_', e.viewer, { jobId: 'job-2', attachmentId: 'file-1' }), errorCode('not_found'));
  assert.ok([...e.files.values()].every(file => !('permissions' in file)));
});

test('deleted jobs reject new supporting writes, upload and file reads', () => {
  const e = environment(); const job = e.createJob(); e.mutate('activity', 'note', activity()); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root'; const bytes = Buffer.from('%PDF-1.7\nTest'); reserve(e, bytes);
  e.call('deleteJob_', e.editor, job.recordId, { protocolVersion: 2, expectedRevision: 1, mutationId: randomUUID() });
  assert.throws(() => e.mutate('activity', 'new', activity()), errorCode('not_found'));
  assert.throws(() => e.call('uploadJobAttachment_', e.editor, { jobId: 'job-1', attachmentId: 'file-1', mutationId: randomUUID(), base64: bytes.toString('base64') }), errorCode('not_found'));
  assert.throws(() => e.call('getJobAttachment_', e.viewer, { jobId: 'job-1', attachmentId: 'file-1' }), errorCode('not_found'));
});

const decision = (status = 'pending') => ({ status, name: status === 'approved' ? 'Customer' : '', date: status === 'approved' ? '2026-10-20' : '', note: '', evidenceIds: [] });
const change = (scope = 'Additional work') => ({ number: '', scope, insuranceRelated: false, amountCents: 12501, addedDays: 0, lifecycle: 'draft', customerDecision: decision(), carrierDecision: decision('not_applicable'), attachmentIds: [], linkedSelectionIds: [], documentArtifactId: null });

test('selection edits reset approval and cross-job supporting references are rejected', () => {
  const e = environment(); e.createJob(); e.createJob('job-2');
  const selection = { room: 'Kitchen', item: 'Flooring', specification: 'Oak', allowanceCents: null, neededBy: '2026-10-21', responsiblePerson: { name: 'PM', email: 'pm@example.com' }, decision: decision('approved'), attachmentIds: [] };
  const created = e.mutate('selection', 'finish', selection);
  assert.equal(created.item.payload.decision.status, 'approved');
  const edited = e.mutate('selection', 'finish', { ...selection, specification: 'Maple' }, { operation: 'update', expectedRevision: 1 });
  assert.equal(edited.item.payload.decision.status, 'pending');
  e.call('mutateJobItem_', e.editor, { jobId: 'job-2', kind: 'selection', itemId: 'elsewhere', operation: 'create', expectedRevision: 0, mutationId: randomUUID(), payload: selection });
  assert.throws(() => e.mutate('change', 'cross-job', { ...change(), linkedSelectionIds: ['elsewhere'] }), errorCode('not_found'));
  assert.throws(() => e.mutate('selection', 'date-invalid', { ...selection, neededBy: '2026-02-31' }), errorCode('bad_request'));
});

test('server finalization allocates unique numbers after recovering pending intents and freezes baseline', () => {
  const e = environment(); e.createJob();
  e.mutate('change', 'one', change());
  assert.throws(() => e.mutate('change', 'one', { ...change(), lifecycle: 'submitted' }, { operation: 'update', expectedRevision: 1 }), errorCode('dependency_pending'));
  e.mutate('workflow', 'workflow:job-1', { ...workflow, baselineReviewed: true, contractBaseAmountCents: 100000, openingPreviousChangesCents: 1000 });
  e.mutate('change', 'two', change('Second'));
  const firstMutation = randomUUID();
  e.crashOn((name, rows) => name === 'JobItems' && rows.some(row => row[2] === 'one'));
  assert.throws(() => e.mutate('change', 'one', { ...change(), lifecycle: 'submitted' }, { operation: 'update', expectedRevision: 1, mutationId: firstMutation }), /interrupted/);
  const second = e.mutate('change', 'two', { ...change('Second'), lifecycle: 'submitted' }, { operation: 'update', expectedRevision: 1 });
  const first = e.mutate('change', 'one', { ...change(), lifecycle: 'submitted' }, { operation: 'update', expectedRevision: 1, mutationId: firstMutation });
  assert.equal(first.item.payload.number, 'CO-001'); assert.equal(second.item.payload.number, 'CO-002');
  assert.throws(() => e.mutate('workflow', 'workflow:job-1', { ...workflow, baselineReviewed: true, contractBaseAmountCents: 100001, openingPreviousChangesCents: 1000 }, { operation: 'update', expectedRevision: 1 }), errorCode('immutable_baseline'));
  assert.throws(() => e.mutate('change', 'forged-number', { ...change(), number: 'CO-099' }), errorCode('bad_request'));
});

test('legacy import preserves source fields, remains pending and never renumbers old documents', () => {
  const e = environment(); const legacy = { changeOrderNumber: '17', scopeDescription: 'Historic scope', changeAmount: 100, changeType: 'increase', addedDays: 0 };
  e.call('saveJob_', e.editor, { recordId: 'job-1', changeOrder: legacy }, { protocolVersion: 2, expectedRevision: 0, mutationId: randomUUID() });
  const imported = e.mutate('change', 'legacy:job-1', { ...change('Historic scope'), number: '17', legacy });
  assert.equal(imported.item.payload.number, '17'); assert.deepEqual(imported.item.payload.legacy, legacy); assert.equal(imported.item.payload.customerDecision.status, 'pending');
  assert.throws(() => e.mutate('change', 'other-legacy', { ...change(), legacy }), errorCode('forbidden'));
});

function artifactPayload(type = 'handoff') { return { type, sourceRevisions: { 'job:job-1': 1 }, generatedAt: '2026-10-20T12:00:00.000Z', generatedBy: 'spoofed@example.com', snapshotAttachmentId: 'snapshot', outputAttachmentIds: ['output'], reviewState: 'draft', audience: 'internal' }; }
function uploadArtifactFile(e: ReturnType<typeof environment>, id: string, bytes: Buffer, mimeType: string, artifactId = 'artifact') {
  e.call('reserveJobAttachment_', e.editor, { jobId: 'job-1', parent: { kind: 'artifact', itemId: artifactId }, attachmentId: id, mutationId: randomUUID(), filename: mimeType === 'application/json' ? 'source.json' : 'output.pdf', mimeType, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  return e.call('uploadJobAttachment_', e.editor, { jobId: 'job-1', attachmentId: id, mutationId: randomUUID(), base64: bytes.toString('base64') });
}

test('artifact publication requires ready owned files and immutable source revision manifests', () => {
  const e = environment(); e.createJob(); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root';
  const p = artifactPayload(); const draft = e.mutate('artifact', 'artifact', p);
  assert.equal(draft.item.payload.generatedBy, e.editor.email);
  assert.throws(() => e.mutate('artifact', 'artifact', { ...p, reviewState: 'final' }, { operation: 'update', expectedRevision: 1 }), errorCode('not_found'));
  uploadArtifactFile(e, 'snapshot', Buffer.from('{"job":{"customerName":"Frozen"}}'), 'application/json');
  uploadArtifactFile(e, 'output', Buffer.from('%PDF-1.7\nFrozen'), 'application/pdf');
  const published = e.mutate('artifact', 'artifact', { ...p, reviewState: 'final' }, { operation: 'update', expectedRevision: 1 });
  assert.equal(published.item.payload.reviewState, 'final');
  assert.throws(() => e.mutate('artifact', 'artifact', p, { operation: 'update', expectedRevision: 2 }), errorCode('immutable_artifact'));
  assert.throws(() => e.mutate('attachment', 'output', undefined, { operation: 'delete', expectedRevision: 2 }), errorCode('referenced_attachment'));
  const job = e.call('getJob_', e.viewer, 'job-1');
  e.call('saveJob_', e.editor, { ...job, status: 'Active' }, { protocolVersion: 2, expectedRevision: 1, mutationId: randomUUID() });
  const snapshot = e.call('getJobAttachment_', e.viewer, { jobId: 'job-1', attachmentId: 'snapshot' });
  assert.equal(Buffer.from(snapshot.base64, 'base64').toString(), '{"job":{"customerName":"Frozen"}}');
});

test('changed sources block final artifact publication without changing the draft', () => {
  const e = environment(); const job = e.createJob(); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root'; const p = artifactPayload(); e.mutate('artifact', 'artifact', p);
  uploadArtifactFile(e, 'snapshot', Buffer.from('{}'), 'application/json'); uploadArtifactFile(e, 'output', Buffer.from('%PDF-1.7\nTest'), 'application/pdf');
  e.call('saveJob_', e.editor, { ...job, status: 'Active' }, { protocolVersion: 2, expectedRevision: 1, mutationId: randomUUID() });
  assert.throws(() => e.mutate('artifact', 'artifact', { ...p, reviewState: 'final' }, { operation: 'update', expectedRevision: 1 }), errorCode('conflict'));
  const records = e.call('listJobItems_', e.viewer, { jobId: 'job-1', kinds: ['artifact'] }); assert.equal(records.items[0].payload.reviewState, 'draft');
});

test('file type signatures, storage permissions and transfer mutation actor binding are enforced', () => {
  const e = environment(); e.createJob(); e.mutate('activity', 'note', activity()); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root';
  e.sandbox.Drive.Permissions.list = () => ({ permissions: [{ type: 'anyone', role: 'reader' }] });
  assert.throws(() => reserve(e, Buffer.from('%PDF-1.7\nTest')), errorCode('storage_not_private'));
  e.sandbox.Drive.Permissions.list = () => ({ permissions: [] });
  const fakePDF = Buffer.from('Pretend PDF'); reserve(e, fakePDF);
  assert.throws(() => e.call('uploadJobAttachment_', e.editor, { jobId: 'job-1', attachmentId: 'file-1', mutationId: randomUUID(), base64: fakePDF.toString('base64') }), errorCode('invalid_file'));
  const journalText = JSON.stringify(e.sheets.get('JobMutations')?.rows);
  assert.equal(journalText.includes(fakePDF.toString('base64')), false);
});

test('workflow summaries derive legacy status, manual latest update and outstanding counts', () => {
  const e = environment(); e.createJob(); e.mutate('workflow', 'workflow:job-1', { ...workflow, stage: 'in_production' }); e.mutate('activity', 'note', activity('Latest manual note'));
  e.mutate('selection', 'finish', { room: '', item: 'Paint', specification: '', allowanceCents: null, neededBy: '', responsiblePerson: { name: '' }, decision: decision(), attachmentIds: [] });
  e.mutate('change', 'draft', change());
  const result = e.call('listJobWorkflowSummaries_', e.viewer, { jobIds: ['job-1'] });
  assert.equal(result.summaries[0].stage, 'in_production'); assert.equal(result.summaries[0].latestUpdate.payload.note, 'Latest manual note'); assert.equal(result.summaries[0].outstandingSelections, 1); assert.equal(result.summaries[0].openChanges, 1);
  assert.throws(() => e.call('listJobWorkflowSummaries_', e.viewer, { jobIds: Array.from({ length: 101 }, () => 'job-1') }), errorCode('bad_request'));
});

test('workflow summaries include dated selection/punch reminders and suppress completed/cancelled jobs', () => {
  const e = environment(); e.createJob();
  e.mutate('workflow', 'workflow:job-1', workflow);
  e.mutate('selection', 'finish', { room: '', item: 'Paint approval', specification: '', allowanceCents: null, neededBy: '2026-10-19', responsiblePerson: { name: 'PM', email: 'pm@example.com' }, decision: decision(), attachmentIds: [] });
  e.mutate('closeout', 'closeout:job-1', { completionDate: '', checklist: [], punchItems: [{ id: 'punch-1', title: 'Trim repair', state: 'open', dueDate: '2026-10-21', responsiblePerson: { name: 'Field', email: 'field@example.com' } }], attachmentIds: [], latestArtifactId: null, completionOverrideReason: '' });
  const summary = () => e.call('listJobWorkflowSummaries_', e.viewer, { jobIds: ['job-1'] }).summaries[0];
  assert.deepEqual(summary().reminders, [{ id: 'finish', kind: 'selection', title: 'Paint approval', dueDate: '2026-10-19', responsiblePerson: { name: 'PM', email: 'pm@example.com' } }, { id: 'punch-1', kind: 'punch', title: 'Trim repair', dueDate: '2026-10-21', responsiblePerson: { name: 'Field', email: 'field@example.com' } }]);
  e.mutate('workflow', 'workflow:job-1', { ...workflow, stage: 'complete' }, { operation: 'update', expectedRevision: 1 });
  assert.deepEqual(summary().reminders, []);
  e.mutate('workflow', 'workflow:job-1', { ...workflow, stage: 'intake' }, { operation: 'update', expectedRevision: 2 });
  assert.equal(summary().reminders.length, 2);
  e.mutate('workflow', 'workflow:job-1', { ...workflow, stage: 'cancelled' }, { operation: 'update', expectedRevision: 3 });
  assert.deepEqual(summary().reminders, []);
});

test('router rejects unauthenticated routes and error envelopes preserve canonical conflict details', () => {
  const e = environment(); const job = e.createJob();
  const unauthenticated = JSON.parse(e.sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'getCapabilities' }) } }));
  assert.equal(unauthenticated.code, 'unauthorized');
  const response = JSON.parse(e.sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'saveJob', sharedSecret: 'test-only', protocolVersion: 2, mutationId: randomUUID(), expectedRevision: 0, job }) } }));
  assert.equal(response.ok, false); assert.equal(response.code, 'conflict'); assert.equal(response.details.current.recordId, 'job-1'); assert.equal(response.details.current.revision, 1);
  const capabilities = JSON.parse(e.sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'getCapabilities', sharedSecret: 'test-only' }) } })); assert.equal(capabilities.ok, true); assert.equal(capabilities.data.apiVersion, 2);
});

test('legacy sheet migration appends metadata without replacing custom appended columns', () => {
  const e = environment(); const jobs = e.sheets.get('Jobs')!;
  const oldHeaders = [...jobs.rows[0].slice(0, 16), 'OfficeCustom']; const oldJob = { recordId: 'job-1', status: 'Draft', customer: { customerName: 'Legacy' }, unknownLegacy: { preserved: true } };
  jobs.rows = [oldHeaders, ['job-1', '', '', 'Legacy', '', '', '', '', '', 'Draft', '2026-01-01', '2026-01-01', e.editor.email, 1, JSON.stringify(oldJob), false, 'Preserve this column']];
  const loaded = e.call('getJob_', e.viewer, 'job-1'); assert.equal(loaded.revision, 1);
  const saved = e.call('saveJob_', e.editor, { ...loaded, status: 'Active' }, { protocolVersion: 2, expectedRevision: 1, mutationId: randomUUID() });
  assert.equal(saved.revision, 2); assert.equal(jobs.rows[1][16], 'Preserve this column'); assert.deepEqual(saved.unknownLegacy, { preserved: true });
  assert.equal(jobs.rows[0][17], 'Revision'); assert.equal(jobs.rows[0][18], 'LastMutationId'); assert.equal(jobs.rows[1][17], 2);
});

test('large valid PDF upload does not overflow base64 validation and never journals file bytes', () => {
  const e = environment(); e.createJob(); e.mutate('activity', 'note', activity()); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root';
  const bytes = Buffer.alloc(2 * 1024 * 1024, 32); Buffer.from('%PDF-1.7\n').copy(bytes);
  reserve(e, bytes); const encoded = bytes.toString('base64');
  const uploaded = e.call('uploadJobAttachment_', e.editor, { jobId: 'job-1', attachmentId: 'file-1', mutationId: randomUUID(), base64: encoded });
  assert.equal(uploaded.item.payload.uploadState, 'ready'); assert.ok(JSON.stringify(e.sheets.get('JobMutations')?.rows).length < 20000);
});

test('missing mutation payload returns a terminal validation error', () => {
  const e = environment(); e.createJob();
  assert.throws(() => e.mutate('activity', 'missing', undefined), errorCode('bad_request'));
});

test('upload transfers and byte verification happen outside the global write lock', () => {
  const e = environment(); e.createJob(); e.mutate('activity', 'note', activity()); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root';
  const bytes = Buffer.from('%PDF-1.7\nTest'); reserve(e, bytes);
  let locked = false;
  e.sandbox.LockService.getScriptLock = () => ({ tryLock: () => { locked = true; return true; }, releaseLock: () => { locked = false; } });
  const originalRead = e.sandbox.DriveApp.getFileById;
  e.sandbox.DriveApp.getFileById = (id: string) => { assert.equal(locked, false, 'Drive blob reads must not hold the global write lock'); return originalRead(id); };
  const originalCreate = e.sandbox.Drive.Files.create;
  e.sandbox.Drive.Files.create = (...args: any[]) => { assert.equal(locked, false, 'Drive upload must not hold the global write lock'); return originalCreate(...args); };
  e.call('uploadJobAttachment_', e.editor, { jobId: 'job-1', attachmentId: 'file-1', mutationId: randomUUID(), base64: bytes.toString('base64') });
});

test('core pending journal recovers before another write and preserves original acknowledgment after later deletion', () => {
  const e = environment(); const job = e.createJob(); const mutationId = randomUUID(); const request = { protocolVersion: 2, expectedRevision: 1, mutationId };
  e.crashOn((name, rows) => name === 'Jobs' && rows.some(row => row[0] === 'job-1'));
  assert.throws(() => e.call('saveJob_', e.editor, { ...job, status: 'Active' }, request), /interrupted/);
  const third = e.call('saveJob_', e.editor, { ...job, status: 'On Hold' }, { protocolVersion: 2, expectedRevision: 2, mutationId: randomUUID() });
  assert.equal(third.revision, 3);
  e.call('deleteJob_', e.editor, 'job-1', { protocolVersion: 2, expectedRevision: 3, mutationId: randomUUID() });
  const replay = e.call('saveJob_', e.editor, { ...job, status: 'Active' }, request);
  assert.equal(replay.revision, 2); assert.equal(replay.status, 'Active');
  assert.throws(() => e.call('saveJob_', e.editor, third, { protocolVersion: 2, expectedRevision: 4, mutationId: randomUUID() }), errorCode('not_found'));
});

test('upload mutation results remain actor-bound after a lost transfer response', () => {
  const e = environment(); e.createJob(); e.mutate('activity', 'note', activity()); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root'; const bytes = Buffer.from('%PDF-1.7\nTest'); reserve(e, bytes);
  const request = { jobId: 'job-1', attachmentId: 'file-1', mutationId: randomUUID(), base64: bytes.toString('base64') }; e.loseDriveAck();
  assert.throws(() => e.call('uploadJobAttachment_', e.editor, request), /response lost/);
  assert.throws(() => e.call('uploadJobAttachment_', e.other, request), errorCode('idempotency_conflict'));
  const uploaded = e.call('uploadJobAttachment_', e.editor, request); assert.equal(uploaded.item.revision, 2); assert.equal(e.driveCreates(), 1);
});

test('pending supporting intent cannot publish a new row after its job was deleted', () => {
  const e = environment(); const job = e.createJob(); const mutationId = randomUUID();
  e.crashOn((name, rows) => name === 'JobItems' && rows.some(row => row[2] === 'pending'));
  assert.throws(() => e.mutate('activity', 'pending', activity(), { mutationId }), /interrupted/);
  e.call('deleteJob_', e.editor, 'job-1', { protocolVersion: 2, expectedRevision: job.revision, mutationId: randomUUID() });
  assert.throws(() => e.mutate('activity', 'pending', activity(), { mutationId }), errorCode('not_found'));
  assert.equal(e.sheets.get('JobItems')?.rows.filter(row => row[2] === 'pending').length, 0);
});

test('number allocation freezes issued content before document upload and disallows draft reversion or deletion', () => {
  const e = environment(); e.createJob();
  e.mutate('workflow', 'workflow:job-1', { ...workflow, baselineReviewed: true, contractBaseAmountCents: 100000 });
  const issued = e.mutate('change', 'issued', { ...change(), lifecycle: 'submitted' });
  assert.equal(issued.item.payload.number, 'CO-001');
  assert.throws(() => e.mutate('change', 'issued', { ...issued.item.payload, scope: 'Silently revised' }, { operation: 'update', expectedRevision: 1 }), errorCode('immutable_artifact'));
  assert.throws(() => e.mutate('change', 'issued', { ...issued.item.payload, lifecycle: 'draft' }, { operation: 'update', expectedRevision: 1 }), errorCode('immutable_artifact'));
  assert.throws(() => e.mutate('change', 'issued', undefined, { operation: 'delete', expectedRevision: 1 }), errorCode('immutable_artifact'));
  const voided = e.mutate('change', 'issued', { ...issued.item.payload, lifecycle: 'void' }, { operation: 'update', expectedRevision: 1 });
  assert.equal(voided.item.payload.lifecycle, 'void');
});

test('pending finalization is recovered before a baseline edit can change frozen contract amounts', () => {
  const e = environment(); e.createJob();
  const baseline = { ...workflow, baselineReviewed: true, contractBaseAmountCents: 100000 };
  e.mutate('workflow', 'workflow:job-1', baseline);
  e.crashOn((name, values) => name === 'JobItems' && values.some(row => row[2] === 'issued'));
  assert.throws(() => e.mutate('change', 'issued', { ...change(), lifecycle: 'submitted' }), /interrupted/);
  assert.throws(() => e.mutate('workflow', 'workflow:job-1', { ...baseline, contractBaseAmountCents: 200000 }, { operation: 'update', expectedRevision: 1 }), errorCode('immutable_baseline'));
  assert.equal(e.call('listJobItems_', e.viewer, { jobId: 'job-1', kinds: ['change'] }).items[0].payload.number, 'CO-001');
});

test('direct change document publication requires reviewed baseline and a numbered change source', () => {
  const e = environment(); e.createJob(); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root';
  const p = artifactPayload('change_order'); e.mutate('artifact', 'artifact', p);
  uploadArtifactFile(e, 'snapshot', Buffer.from('{}'), 'application/json'); uploadArtifactFile(e, 'output', Buffer.from('%PDF-1.7\nTest'), 'application/pdf');
  assert.throws(() => e.mutate('artifact', 'artifact', { ...p, reviewState: 'final' }, { operation: 'update', expectedRevision: 1 }), errorCode('dependency_pending'));
  e.mutate('workflow', 'workflow:job-1', { ...workflow, baselineReviewed: true, contractBaseAmountCents: 100000 });
  assert.throws(() => e.mutate('artifact', 'artifact', { ...p, reviewState: 'final' }, { operation: 'update', expectedRevision: 1 }), errorCode('dependency_pending'));
  e.mutate('change', 'issued', { ...change(), lifecycle: 'submitted' });
  const published = e.mutate('artifact', 'artifact', { ...p, sourceRevisions: { ...p.sourceRevisions, 'change:issued': 1 }, reviewState: 'final' }, { operation: 'update', expectedRevision: 1 });
  assert.equal(published.item.payload.type, 'change_order');
  assert.throws(() => e.mutate('workflow', 'workflow:job-1', { ...workflow, baselineReviewed: true, contractBaseAmountCents: 100000, latestHandoffArtifactId: 'artifact' }, { operation: 'update', expectedRevision: 1 }), errorCode('bad_request'));
});

test('a public job subfolder is rejected even when its configured root is private', () => {
  const e = environment(); e.createJob(); e.mutate('activity', 'note', activity()); e.properties.WORKFLOW_DRIVE_ROOT_ID = 'private-root';
  e.sandbox.Drive.Permissions.list = (id: string) => ({ permissions: id === 'private-root' ? [] : [{ type: 'anyone', role: 'reader' }] });
  assert.throws(() => reserve(e, Buffer.from('%PDF-1.7\nTest')), errorCode('storage_not_private'));
  assert.equal(e.call('listJobItems_', e.viewer, { jobId: 'job-1', kinds: ['attachment'] }).items.length, 0);
});
