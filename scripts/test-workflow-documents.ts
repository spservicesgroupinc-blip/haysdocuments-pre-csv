import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { createEmptyJob } from '../src/types/jobData';
import {
  buildHandoffSnapshot, buildCloseoutSnapshot, generateWorkflowSummary,
  createCloseoutExport, buildRegisteredChangeOrderData, generateRegisteredChangeOrder,
} from '../src/services/workflowDocuments';
import { base64ToBlob, blobToBase64, prepareAttachment } from '../src/services/workflowAttachments';

function qaFile(name: string, bytes: Uint8Array) {
  if (!process.env.WORKFLOW_PDF_QA_DIR) return;
  mkdirSync(process.env.WORKFLOW_PDF_QA_DIR, { recursive: true });
  writeFileSync(join(process.env.WORKFLOW_PDF_QA_DIR, name), bytes);
}

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
  qaFile('handoff.pdf', await generateWorkflowSummary(snapshot));
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
    qaFile(`${audience}-completion.pdf`, await generateWorkflowSummary(snapshot));
    assert.match(pdf.text, /Example Customer/);
    assert.doesNotMatch(pdf.text, /PRIVATE-/);
  }
});

test('source manifests are stable regardless of item order and include revisions without generated artifacts', () => {
  const items = [item('selection', 'b', { room: '', item: 'Floor', specification: '', neededBy: '', decision: decision('pending') }), item('workflow', 'a', workflow()), item('artifact', 'ignored', {}),
    item('attachment', 'generated-output', { parent: { kind: 'artifact', itemId: 'ignored' } })];
  const first = buildHandoffSnapshot(job(), items as never);
  const second = buildHandoffSnapshot(job(), [...items].reverse() as never);
  assert.deepEqual(first.sourceManifest, second.sourceManifest);
  assert.doesNotMatch(JSON.stringify(first.sourceManifest), /ignored/);
  assert.doesNotMatch(JSON.stringify(first.sourceManifest), /generated-output/);
});

test('long content, unbroken words, unicode, and page transitions render every tail without clipping', async () => {
  const data = job();
  data.productionNotes.scopeSummary = Array.from({ length: 80 }, (_, i) => `Room ${i}: restore ceiling and walls.`).join('\n');
  data.productionNotes.additionalNotes = `BEGIN-LONG-WORD ${'W'.repeat(1200)} END-LONG-WORD 😃`;
  data.customer.jobNumber = `FW-${'W'.repeat(160)}`;
  const bytes = await generateWorkflowSummary(buildHandoffSnapshot(data, []));
  qaFile('long-handoff.pdf', bytes);
  const result = await readPdf(bytes);
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

test('issued changes preserve the original form and append complete long scope without clipped words or draft labels', async () => {
  const source = change('CO-05', 100);
  const selected = { ...source, payload: { ...source.payload as object,
    scope: `Repair additional damage. ${'W'.repeat(1000)} COMPLETE-SCOPE-END`, lifecycle: 'submitted' } };
  const bytes = await generateRegisteredChangeOrder(job(), selected as never, workflow() as never, []);
  qaFile('registered-change-long.pdf', bytes);
  const rendered = await readPdf(bytes);
  assert.ok(rendered.pages >= 2);
  assert.match(rendered.text, /Change Order \/ Addendum/);
  assert.match(rendered.text, /COMPLETE-SCOPE-END/);
  assert.doesNotMatch(rendered.text, /PRODUCTION HANDOFF|DRAFT/);
});

async function pdfAttachment(id = 'evidence') {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = await pdf.save();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer));
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
  const file = new File([Uint8Array.from(source.bytes).buffer], '../invoice.pdf', { type: 'application/pdf' });
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

test('final summaries require a completed review or recorded override and retain the attributed reason internally', async () => {
  const data = job();
  assert.throws(() => buildHandoffSnapshot(data, [], { reviewState: 'final' }), /needs review/);
  const reviewed = { ...workflow(), handoffOverrideReason: 'Estimator reviewed missing RCV with PM.' };
  const snapshot = buildHandoffSnapshot(data, [item('workflow', 'workflow:export-job', reviewed)] as never,
    { reviewState: 'final', generatedBy: 'estimator@example.com' });
  const rendered = await readPdf(await generateWorkflowSummary(snapshot));
  assert.match(rendered.text, /estimator@example.com/);
  assert.match(rendered.text, /Estimator reviewed missing RCV/);
  assert.doesNotMatch(rendered.text, /DRAFT/);
  assert.throws(() => buildCloseoutSnapshot(data, [], 'customer', { reviewState: 'final' }), /needs review/);
});

/** Portable deterministic PNG fixture with incompressible RGB pixels and no runtime dependency. */
function photoPng(width: number, height: number, noisy = false): Uint8Array {
  function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  let random = 0x12345678;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width * 3; x++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      scanlines[y * (width * 3 + 1) + x + 1] = noisy ? random & 255 : (x % 3 === 1 ? 160 : 220);
    }
  }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]));
}

async function imageAttachment(id: string, bytes: Uint8Array, caption: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer));
  const sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return { attachment: item('attachment', id, { filename: `${id}.png`, mimeType: 'image/png', byteSize: bytes.byteLength,
    sha256, driveFileId: `drive-${id}`, parent: { kind: 'closeout', itemId: 'closeout:export-job' }, uploadState: 'ready', caption }), bytes };
}

test('closeout photo appendix preserves portrait proportions and renders full captions including continuation pages', async () => {
  const source = await imageAttachment('portrait', photoPng(160, 320), `Kitchen complete. ${'Caption note '.repeat(90)} CAPTION-END`);
  const result = await createCloseoutExport(job(), [source.attachment] as never, 'customer', [source] as never);
  const appendix = result.outputs.find(file => /photo-appendix/.test(file.fileName))!;
  qaFile(appendix.fileName, appendix.bytes);
  const rendered = await readPdf(appendix.bytes);
  assert.match(rendered.text, /CAPTION-END/);
  assert.ok(rendered.pages >= 2);
  const doc = await pdfjs.getDocument({ data: appendix.bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  const operators = await (await doc.getPage(1)).getOperatorList();
  const imageTransform = operators.fnArray.findIndex((fn, index) => fn === pdfjs.OPS.transform
    && Number(operators.argsArray[index][0]) > 1 && Number(operators.argsArray[index][3]) > 1);
  assert.ok(imageTransform >= 0, 'Photo has an explicit PDF image transform.');
  const [width, , , height] = operators.argsArray[imageTransform] as number[];
  assert.ok(height > width, 'Portrait photo remains taller than it is wide.');
});

test('large photo appendices split before 5 MiB with every selected source retained in the ZIP manifest', async () => {
  const source = photoPng(1100, 1300, true);
  const selected = await Promise.all([imageAttachment('large-1', source, 'First reviewed photo'), imageAttachment('large-2', source, 'Second reviewed photo')]);
  const result = await createCloseoutExport(job(), selected.map(file => file.attachment) as never, 'internal', selected as never);
  const appendices = result.outputs.filter(file => /photo-appendix/.test(file.fileName));
  assert.equal(appendices.length, 2);
  assert.equal(result.manifest.selectedFiles.length, 2);
  assert.ok(appendices.every(file => file.bytes.byteLength <= 5 * 1024 * 1024));
  for (const appendix of appendices) {
    const pdf = await PDFDocument.load(appendix.bytes);
    assert.equal(pdf.getPageCount(), 1);
  }
});

test('real browser normalizes EXIF-rotated photos into an upright portrait JPEG within dimension and size limits', async () => {
  const bundle = await build({ entryPoints: ['src/services/workflowAttachments.ts'], bundle: true, write: false,
    format: 'iife', globalName: 'attachmentPreparation', platform: 'browser' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('http://localhost:19871/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Photo processing test</title>' }));
    await page.goto('http://localhost:19871/');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const prepared = await page.evaluate(async () => {
      const api = (window as unknown as { attachmentPreparation: typeof import('../src/services/workflowAttachments') }).attachmentPreparation;
      const canvas = document.createElement('canvas'); canvas.width = 3200; canvas.height = 1600;
      const context = canvas.getContext('2d')!; context.fillStyle = '#d41229'; context.fillRect(0, 0, canvas.width, canvas.height);
      const original = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg', 0.95));
      const bytes = new Uint8Array(await original.arrayBuffer());
      // EXIF orientation 6: encoded landscape pixels must display as a portrait rotated clockwise.
      const exif = new Uint8Array([255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0,
        1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
      const oriented = new Uint8Array(bytes.length + exif.length);
      oriented.set(bytes.slice(0, 2)); oriented.set(exif, 2); oriented.set(bytes.slice(2), 2 + exif.length);
      const result = await api.prepareAttachment(new File([oriented.buffer], 'camera-portrait.jpg', { type: 'image/jpeg' }));
      const decoded = await createImageBitmap(result.blob);
      const dimensions = { width: decoded.width, height: decoded.height }; decoded.close();
      return { ...dimensions, mimeType: result.mimeType, size: result.size, name: result.name, sha256: result.sha256 };
    });
    assert.equal(prepared.mimeType, 'image/jpeg');
    assert.equal(prepared.name, 'camera-portrait.jpg');
    assert.ok(prepared.height > prepared.width);
    assert.equal(Math.max(prepared.width, prepared.height), 2000);
    assert.ok(prepared.size <= 2 * 1024 * 1024);
    assert.match(prepared.sha256, /^[a-f0-9]{64}$/);
  } finally { await browser.close(); }
});
