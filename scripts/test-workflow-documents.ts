import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { createEmptyJob } from '../src/types/jobData';
import {
  buildHandoffSnapshot, buildCloseoutSnapshot, generateWorkflowSummary,
  createCloseoutExport, buildRegisteredChangeOrderData, generateRegisteredChangeOrder,
} from '../src/services/workflowDocuments';
import { base64ToBlob, blobToBase64, prepareAttachment } from '../src/services/workflowAttachments';

const job = () => {
  const value = createEmptyJob();
  value.recordId = 'export-job';
  value.customer.customerName = 'Example Customer';
  value.customer.jobNumber = 'EXPORT-1';
  value.customer.lossAddress = '123 Example Street';
  value.insurance.carrier = 'Example carrier';
  value.insurance.claimNumber = 'CLAIM-1';
  value.productionNotes.scopeSummary = 'Repair kitchen and hall.';
  value.productionNotes.scheduleAndAccess = 'PRIVATE-LOCKBOX-4821';
  value.productionNotes.safetyConsiderations = 'PRIVATE-HAZARD';
  value.productionNotes.additionalNotes = 'PRIVATE-INTERNAL-COMMENT';
  value.mortgage.last4Ssn = 'PRIVATE-SSN';
  value.mortgage.loanNumber = 'PRIVATE-LOAN';
  value.financials.totalApprovedRcv = '';
  return value;
};

function item(kind: string, itemId: string, payload: unknown, revision = 1) {
  return { kind, itemId, jobId: 'export-job', revision, createdAt: '2026-10-19T14:00:00Z',
    createdBy: 'author@example.com', updatedAt: '2026-10-19T14:00:00Z',
    updatedBy: 'author@example.com', deletedAt: null, lastMutationId: `mutation-${itemId}`, payload };
}
const workflow = () => ({ stage: 'in_production', nextAction: null, holdReason: '',
  contractBaseAmountCents: 100001, openingPreviousChangesCents: 99, baselineReviewed: true, latestHandoffArtifactId: null,
  confirmations: { contractSigned: true, scopeReviewed: true, initialPayment: 'recorded', mortgageReviewed: 'not_applicable' }, handoffOverrideReason: '' });
const decision = (status: string) => ({ status, name: 'Customer', date: '2026-10-19', note: '', evidenceIds: [] });
const change = (id: string, amountCents: number, status = 'approved') => item('change', id, {
  number: id, scope: 'Reviewed extra work', insuranceRelated: true, amountCents, addedDays: 0,
  lifecycle: 'submitted', customerDecision: decision(status), carrierDecision: decision('pending'),
  attachmentIds: [], linkedSelectionIds: [], documentArtifactId: null,
});

async function readPdf(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  const text: string[] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    for (const entry of content.items) {
      if (!('str' in entry) || !entry.str.trim()) continue;
      assert.ok(entry.transform[4] >= 35 && entry.transform[4] + entry.width <= 577,
        `Text must remain within horizontal page margins: ${entry.str}`);
      assert.ok(entry.transform[5] >= 26 && entry.transform[5] <= 760,
        `Text must remain within vertical page margins: ${entry.str}`);
      text.push(entry.str);
    }
  }
  return { text: text.join(' '), pages: doc.numPages };
}

test('handoff snapshot is detached, frozen, internally labeled and retains missing amounts', async () => {
  const data = job();
  const items = [item('workflow', 'workflow:export-job', workflow())];
  const snapshot = buildHandoffSnapshot(data, items as never);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.sections));
  const original = JSON.stringify(snapshot);
  data.productionNotes.scheduleAndAccess = 'Changed later';
  items[0].revision = 99;
  assert.equal(JSON.stringify(snapshot), original);
  assert.match(original, /PRIVATE-LOCKBOX-4821/);
  const pdf = await readPdf(await generateWorkflowSummary(snapshot));
  assert.match(pdf.text, /Internal use/);
  assert.match(pdf.text, /Not recorded/);
});

test('external closeout snapshot uses an allowlist and excludes private source data and internal notes', async () => {
  for (const audience of ['customer', 'carrier'] as const) {
    const snapshot = buildCloseoutSnapshot(job(), [item('activity', 'secret', {
      note: 'PRIVATE-ACTIVITY', occurredAt: '2026-10-19T14:00:00Z', source: 'manual', attachmentIds: [],
    })] as never, audience);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-|mortgage|downPayment|communicationNotes/);
    const pdf = await readPdf(await generateWorkflowSummary(snapshot));
    assert.match(pdf.text, /Example Customer/);
    assert.doesNotMatch(pdf.text, /PRIVATE-/);
  }
});

test('source manifests are stable regardless of item order and include revisions without generated artifacts', () => {
  const items = [item('selection', 'b', { room: '', item: 'Floor', specification: '', neededBy: '', decision: decision('pending') }), item('workflow', 'a', workflow()), item('artifact', 'ignored', {})];
  const first = buildHandoffSnapshot(job(), items as never);
  const second = buildHandoffSnapshot(job(), [...items].reverse() as never);
  assert.deepEqual(first.sourceManifest, second.sourceManifest);
  assert.doesNotMatch(JSON.stringify(first.sourceManifest), /ignored/);
});

test('long content, unbroken words, unicode, and page transitions render every tail without clipping', async () => {
  const data = job();
  data.productionNotes.scopeSummary = Array.from({ length: 80 }, (_, i) => `Room ${i}: restore ceiling and walls.`).join('\n');
  data.productionNotes.additionalNotes = `BEGIN-LONG-WORD ${'W'.repeat(1200)} END-LONG-WORD 😃`;
  const result = await readPdf(await generateWorkflowSummary(buildHandoffSnapshot(data, [])));
  assert.ok(result.pages >= 3);
  assert.match(result.text, /Room 79/);
  assert.match(result.text, /END-LONG-WORD/);
});

test('change adapter counts exact signed cents once, independent of carrier decision and selected change', async () => {
  const selected = change('CO-04', -123);
  const prior = [change('CO-01', 150), change('CO-02', -50), change('CO-03', 1000, 'pending'), selected];
  prior.push({ ...change('CO-VOID', 100000), payload: { ...change('x', 0).payload as object, lifecycle: 'void', amountCents: 100000 } });
  const data = buildRegisteredChangeOrderData(job(), selected as never, workflow() as never, prior as never);
  assert.equal(data.changeOrder.originalContractSum, 1000.01);
  assert.equal(data.changeOrder.netPreviousChanges, 1.99);
  assert.equal(data.changeOrder.changeAmount, 1.23);
  assert.equal(data.changeOrder.changeType, 'decrease');
  const pdf = await PDFDocument.load(await generateRegisteredChangeOrder(job(), selected as never, workflow() as never, prior as never));
  assert.equal(pdf.getPageCount(), 1);
  assert.throws(() => buildRegisteredChangeOrderData(job(), selected as never,
    { ...workflow(), contractBaseAmountCents: null } as never, []), /baseline/i);
});

async function pdfAttachment(id = 'evidence') {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = await pdf.save();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { attachment: item('attachment', id, { filename: '../invoice.pdf', mimeType: 'application/pdf',
    byteSize: bytes.length, sha256, driveFileId: `drive-${id}`, parent: { kind: 'closeout', itemId: 'closeout:export-job' },
    uploadState: 'ready', caption: 'Reviewed invoice', category: 'invoice' }), bytes };
}

test('closeout export includes exactly the manifest entries and supplied PDF unchanged; never source JSON', async () => {
  const source = await pdfAttachment();
  const exported = await createCloseoutExport(job(), [source.attachment] as never, 'customer', [source] as never);
  const zip = await JSZip.loadAsync(exported.bytes);
  const files = Object.keys(zip.files).filter((path) => !zip.files[path].dir).sort();
  assert.deepEqual(files, [...exported.manifest.entries].sort());
  assert.ok(files.includes('manifest.json'));
  assert.ok(files.some((path) => /completion-summary\.pdf$/.test(path)));
  assert.ok(files.every((path) => !path.includes('..') && !/snapshot|production.packet/i.test(path)));
  const supplied = files.find((path) => path.startsWith('evidence/'))!;
  assert.deepEqual(await zip.file(supplied)!.async('uint8array'), source.bytes);
  assert.doesNotMatch(await zip.file('manifest.json')!.async('string'), /PRIVATE-/);
  assert.ok(exported.outputs.every((output) => output.bytes.byteLength <= 5 * 1024 * 1024));
});

test('exports reject unavailable, mismatched and duplicate selected files and size overflow instead of omitting them', async () => {
  const source = await pdfAttachment();
  await assert.rejects(createCloseoutExport(job(), [] as never, 'customer', [source] as never), /available|metadata/i);
  await assert.rejects(createCloseoutExport(job(), [source.attachment] as never, 'customer', [source, source] as never), /duplicate/i);
  const corrupt = { ...source, bytes: new Uint8Array(source.bytes.length) };
  await assert.rejects(createCloseoutExport(job(), [source.attachment] as never, 'customer', [corrupt] as never), /hash|signature/i);
  const pending = { ...source.attachment, payload: { ...source.attachment.payload as object, uploadState: 'reserved' } };
  await assert.rejects(createCloseoutExport(job(), [pending] as never, 'customer', [{ ...source, attachment: pending }] as never), /ready|available/i);
  const huge = Array.from({ length: 6 }, (_, index) => ({ attachment: item('attachment', `huge-${index}`,
    { ...source.attachment.payload as object, byteSize: 5 * 1024 * 1024 }), bytes: new Uint8Array(5 * 1024 * 1024) }));
  await assert.rejects(createCloseoutExport(job(), huge.map((entry) => entry.attachment) as never,
    'customer', huge as never), /25 MiB/);
});

test('PDF attachment preparation preserves bytes, sanitizes name and returns a verified hash', async () => {
  const source = await pdfAttachment();
  const file = new File([source.bytes], '../invoice.pdf', { type: 'application/pdf' });
  const prepared = await prepareAttachment(file);
  assert.equal(prepared.mimeType, 'application/pdf');
  assert.equal(prepared.name, 'invoice.pdf');
  assert.equal(prepared.size, source.bytes.length);
  assert.equal(prepared.sha256, (source.attachment.payload as { sha256: string }).sha256);
  assert.deepEqual(new Uint8Array(await prepared.blob.arrayBuffer()), source.bytes);
  const roundTrip = base64ToBlob(await blobToBase64(prepared.blob), prepared.mimeType);
  assert.deepEqual(new Uint8Array(await roundTrip.arrayBuffer()), source.bytes);
});

test('attachment preparation rejects unsupported HEIC, signature mismatch, and oversized originals clearly', async () => {
  await assert.rejects(prepareAttachment(new File(['heic'], 'camera.HEIC', { type: 'image/heic' })), /HEIC/);
  await assert.rejects(prepareAttachment(new File(['not-a-pdf'], 'invoice.pdf', { type: 'application/pdf' })), /signature|PDF/i);
  await assert.rejects(prepareAttachment(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.pdf',
    { type: 'application/pdf' })), /5 MiB/);
  assert.throws(() => base64ToBlob('this is not base64!', 'application/pdf'), /base64/i);
});
