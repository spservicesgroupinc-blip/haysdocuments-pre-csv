import { useCallback, useEffect, useRef, useState } from 'react';
import type { RestorationJobData } from '../types/jobData';
import { draftItem, itemOf, migrateLegacyChange, newId, validatePayload, workflowOf, type JobItem, type ItemKind, type ItemPayloads, type ArtifactPayload } from '../types/workflow';
import { cachedWorkflowItems, cacheWorkflowItems, cachedWorkflowBlob, cacheWorkflowBlob, queueWorkflowItem, queueWorkflowFiles, queueArtifactPublication, workflowOperations, workflowConflicts, resolveWorkflowConflict, retryWorkflowErrors, flushWorkflowQueue, subscribeWorkflow, type WorkflowConflict } from './workflowStore';
import { discoverWorkflowCapabilities, fetchWorkflowItems, sendWorkflowOperation, workflowOwner } from './workflowClient';
import { callAuthenticatedAppsScript, DatabaseError, getCurrentUser } from './appsScriptService';
import { flushOutboxNow, saveJobOffline } from './jobSync';
import { getMirrorJob } from './localDb';

export interface WorkflowExportOptions { audience?: 'internal' | 'customer' | 'carrier'; changeId?: string; attachmentIds?: string[]; final?: boolean }
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The workflow could not synchronize. Your device copy is retained.';

export function useJobWorkflow(job: RestorationJobData, enabled: boolean, owner: string) {
  const [items, setItems] = useState<JobItem[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<WorkflowConflict[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(true);
  const ref = useRef(job); ref.current = job;
  const jobId = job.recordId || job.id;
  const alive = useRef(0);
  const flushBusy = useRef<Promise<void> | null>(null);
  const current = useCallback(() => owner === workflowOwner(), [owner]);
  const reloadLocal = useCallback(async () => {
    if (!owner) return;
    const token = alive.current;
    const [cached, queue, review] = await Promise.all([cachedWorkflowItems(owner, jobId), workflowOperations(owner), workflowConflicts(owner)]);
    if (!current() || token !== alive.current) return;
    setItems(cached); setPendingCount(queue.filter(op => op.jobId === jobId).length); setConflicts(review.filter(row => row.jobId === jobId));
    const failed = queue.find(op => op.jobId === jobId && op.error);
    if (failed) setError(failed.error!);
  }, [owner, jobId, current]);
  const flush = useCallback(async (): Promise<void> => {
    if (!owner || !current() || !navigator.onLine) return;
    // A note can start syncing before photo preparation finishes. Drain again after
    // that in-flight pass so newly queued files do not wait for the next poll.
    if (flushBusy.current) { await flushBusy.current; return flush(); }
    const task = (async () => {
      await flushOutboxNow(false);
      await flushWorkflowQueue(owner, op => sendWorkflowOperation(owner, op), current);
      if (current()) await reloadLocal();
    })().finally(() => { flushBusy.current = null; });
    flushBusy.current = task;
    return task;
  }, [owner, current, reloadLocal]);
  const refresh = useCallback(async (retryErrors = true) => {
    if (!enabled || !owner || !current()) return;
    const token = alive.current;
    setLoading(true);
    try {
      await reloadLocal();
      const caps = await discoverWorkflowCapabilities(true);
      if (!current() || token !== alive.current) return;
      setAvailable(!!caps?.features.includes('job_items'));
      if (!caps?.features.includes('job_items') || !navigator.onLine) { setFromCache(true); return; }
      if (retryErrors) await retryWorkflowErrors(owner);
      await flush();
      const latest = await fetchWorkflowItems(owner, jobId);
      if (!current() || token !== alive.current) return;
      await cacheWorkflowItems(owner, latest); await reloadLocal();
      setLastRefreshedAt(new Date().toISOString()); setFromCache(false);
      const ops = await workflowOperations(owner);
      if (!ops.some(op => op.jobId === jobId && op.error)) setError(null);
    } catch (err) {
      if (current() && token === alive.current) { setFromCache(true); if (!(err instanceof DatabaseError && err.code === 'not_found')) setError(errorText(err)); }
    } finally { if (current() && token === alive.current) setLoading(false); }
  }, [enabled, owner, jobId, current, reloadLocal, flush]);
  useEffect(() => {
    alive.current++; setItems([]); setError(null); setConflicts([]); setPendingCount(0); setAvailable(false); setLastRefreshedAt(null); setFromCache(true);
    if (!enabled || !owner) return;
    void refresh(false);
    const update = () => { void reloadLocal().catch(err => setError(errorText(err))); };
    const stop = subscribeWorkflow(update);
    const focus = () => { if (document.visibilityState !== 'hidden' && navigator.onLine) void refresh(false); };
    window.addEventListener('online', focus); window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    const timer = window.setInterval(focus, 60000);
    return () => { alive.current++; stop(); clearInterval(timer); window.removeEventListener('online', focus); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [enabled, owner, jobId]);

  const ensureJob = async () => {
    if (!current() || getCurrentUser()?.role === 'viewer') throw new Error('Your account cannot change this job.');
    const record = ref.current;
    const mirror = await getMirrorJob(jobId);
    const clean = (value: RestorationJobData) => JSON.stringify({ ...value, updatedAt: undefined, revision: undefined });
    if (!mirror?.record || clean(mirror.record) !== clean(record)) await saveJobOffline({ ...record, revision: mirror?.record?.revision ?? record.revision });
  };
  const save = async (kind: ItemKind, itemId: string, payload: ItemPayloads[ItemKind]) => {
    validatePayload(kind, payload); await ensureJob();
    await queueWorkflowItem(owner, jobId, kind, itemId, payload);
    await reloadLocal(); void flush().catch(err => { if (current()) setError(errorText(err)); });
  };
  const remove = async (item: JobItem) => {
    await ensureJob();
    await queueWorkflowItem(owner, jobId, item.kind, item.itemId, item.payload, 'delete');
    await reloadLocal(); void flush().catch(err => setError(errorText(err)));
  };
  const attach = async (parent: { kind: ItemKind; itemId: string }, files: File[]) => {
    await ensureJob();
    const { prepareAttachment, MAX_ATTACHMENT_BATCH } = await import('./workflowAttachments');
    if (files.length > MAX_ATTACHMENT_BATCH) throw new Error('Choose up to ten files at a time.');
    const preparedFiles = [];
    for (const file of files) {
      const prepared = await prepareAttachment(file);
      preparedFiles.push({ blob: prepared.blob, item: draftItem(jobId, 'attachment', newId(), { filename: prepared.name, mimeType: prepared.mimeType, byteSize: prepared.size, sha256: prepared.sha256, driveFileId: '', parent, uploadState: 'reserved' }, owner) });
    }
    if (!current()) throw new Error('Sign in again before attaching these files.');
    await queueWorkflowFiles(owner, preparedFiles);
    await reloadLocal(); void flush().catch(err => setError(errorText(err)));
  };
  const attachmentBlob = async (item: JobItem<'attachment'>) => {
    if (!current() || item.jobId !== jobId) throw new Error('Open this file from the current signed-in job.');
    const cached = await cachedWorkflowBlob(owner, jobId, item.itemId);
    if (cached) return cached;
    if (!navigator.onLine) throw new Error(`${item.payload.filename} is not cached on this device. Reconnect to download it.`);
    const data = await callAuthenticatedAppsScript<{ base64: string; mimeType?: string }>('getJobAttachment', { jobId, attachmentId: item.itemId });
    if (!current()) throw new Error('Sign in again before opening this file.');
    const { base64ToBlob, sha256Bytes } = await import('./workflowAttachments');
    const blob = base64ToBlob(data.base64, data.mimeType || item.payload.mimeType);
    if (blob.size !== item.payload.byteSize || await sha256Bytes(new Uint8Array(await blob.arrayBuffer())) !== item.payload.sha256) throw new Error('The downloaded file does not match its saved metadata. Retry the download.');
    await cacheWorkflowBlob(owner, jobId, item.itemId, blob);
    return blob;
  };
  const download = async (item: JobItem<'attachment'>) => {
    const blob = await attachmentBlob(item), url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = item.payload.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const importLegacy = useRef(new Set<string>());
  useEffect(() => {
    if (!available || loading || !owner || getCurrentUser()?.role === 'viewer' || importLegacy.current.has(`${owner}:${jobId}`)) return;
    importLegacy.current.add(`${owner}:${jobId}`);
    const legacy = migrateLegacyChange(ref.current);
    if (legacy && !items.some(item => item.itemId === legacy.itemId)) void save('change', legacy.itemId, legacy.payload).catch(err => setError(errorText(err)));
  }, [available, loading, owner, jobId, items]);

  const exportDocument = async (type: 'handoff' | 'change_order' | 'closeout', options: WorkflowExportOptions = {}) => {
    const docs = await import('./workflowDocuments');
    const { sha256Bytes } = await import('./workflowAttachments');
    let source = await cachedWorkflowItems(owner, jobId);
    let currentJob = ref.current;
    if (options.final) {
      if (!navigator.onLine) throw new Error('Reconnect to publish a final document. Draft downloads remain available offline.');
      await ensureJob(); await flush();
      if ((await workflowOperations(owner)).some(op => op.jobId === jobId)) throw new Error('Synchronize or review the pending changes before final publication.');
      const mirror = await getMirrorJob(jobId);
      if (mirror?.syncState !== 'synced' || !mirror.record) throw new Error('The job save must finish synchronizing before publication.');
      currentJob = mirror.record; source = await fetchWorkflowItems(owner, jobId); await cacheWorkflowItems(owner, source);
    }
    const generatedAt = new Date().toISOString(), generatedBy = getCurrentUser()?.name || owner;
    const snapshotOptions = { generatedAt, generatedBy, reviewState: options.final ? 'final' as const : 'draft' as const };
    let snapshot: unknown, sourceRevisions: Record<string, number>, outputs: { fileName: string; mimeType: string; bytes: Uint8Array; sha256: string }[], bytes: Uint8Array, filename: string;
    if (type === 'handoff') {
      const value = docs.buildHandoffSnapshot(currentJob, source, snapshotOptions);
      bytes = await docs.generateWorkflowSummary(value); filename = `${currentJob.customer.jobNumber}_Production_Handoff.pdf`; snapshot = value; sourceRevisions = value.sourceRevisions;
      outputs = [{ fileName: filename, mimeType: 'application/pdf', bytes, sha256: await sha256Bytes(bytes) }];
    } else if (type === 'closeout') {
      const chosen = itemOf(source, 'attachment').filter(item => options.attachmentIds?.includes(item.itemId));
      if (chosen.length !== (options.attachmentIds?.length ?? 0)) throw new Error('A selected file was removed. Review the closeout file selection.');
      const files = [];
      let selectedBytes = 0;
      for (const attachment of chosen) {
        selectedBytes += attachment.payload.byteSize;
        if (selectedBytes > 25 * 1024 * 1024) throw new Error('Choose at most 25 MiB of source files per export. Split this packet.');
        files.push({ attachment, bytes: new Uint8Array(await (await attachmentBlob(attachment)).arrayBuffer()) });
      }
      const result = await docs.createCloseoutExport(currentJob, source, options.audience || 'internal', files, snapshotOptions);
      ({ bytes, outputs } = result); filename = result.fileName; snapshot = { snapshot: result.snapshot, manifest: result.manifest }; sourceRevisions = result.snapshot.sourceRevisions;
    } else {
      let change = itemOf(source, 'change').find(item => item.itemId === options.changeId);
      if (!change) throw new Error('Choose the change to generate.');
      if (options.final && change.payload.documentArtifactId) throw new Error('This change has already been issued. Download the saved version or create an amendment.');
      if (options.final && !change.payload.number) {
        await save('change', change.itemId, { ...change.payload, lifecycle: 'submitted' }); await flush();
        source = await fetchWorkflowItems(owner, jobId); await cacheWorkflowItems(owner, source);
        change = itemOf(source, 'change').find(item => item.itemId === options.changeId)!;
        if (!change.payload.number) throw new Error('The server has not assigned a final change number. Retry after synchronization.');
      }
      const workflow = workflowOf(currentJob, source);
      if (options.final && !workflow.baselineReviewed) throw new Error('Review and save the contract baseline before issuing a change.');
      bytes = await docs.generateRegisteredChangeOrder(currentJob, change, workflow, itemOf(source, 'change'), snapshotOptions);
      filename = `${currentJob.customer.jobNumber}_${change.payload.number || 'Draft_Change'}.pdf`;
      sourceRevisions = { [`job:${jobId}`]: currentJob.revision ?? 1, ...Object.fromEntries(itemOf(source, 'change').map(item => [`change:${item.itemId}`, item.revision])), ...Object.fromEntries(itemOf(source, 'workflow').map(item => [`workflow:${item.itemId}`, item.revision])) };
      snapshot = { job: currentJob, change, priorChanges: itemOf(source, 'change'), workflow, sourceRevisions, generatedAt, generatedBy };
      outputs = [{ fileName: filename, mimeType: 'application/pdf', bytes, sha256: await sha256Bytes(bytes) }];
    }
    if (options.final) {
      const artifactId = newId(), snapshotId = newId(), outputIds = outputs.map(() => newId());
      const payload: ArtifactPayload = { type, sourceRevisions, generatedAt, generatedBy, snapshotAttachmentId: snapshotId, outputAttachmentIds: outputIds, reviewState: 'final', audience: options.audience || 'internal' };
      const snapshotBlob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
      const files = [{ item: draftItem(jobId, 'attachment', snapshotId, { filename: 'source_snapshot.json', mimeType: 'application/json', byteSize: snapshotBlob.size, sha256: await sha256Bytes(new Uint8Array(await snapshotBlob.arrayBuffer())), driveFileId: '', parent: { kind: 'artifact' as const, itemId: artifactId }, uploadState: 'reserved' as const }, owner), blob: snapshotBlob }];
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i];
        const blob = new Blob([Uint8Array.from(output.bytes)], { type: output.mimeType });
        files.push({ item: draftItem(jobId, 'attachment', outputIds[i], { filename: output.fileName, mimeType: output.mimeType, byteSize: blob.size, sha256: output.sha256, driveFileId: '', parent: { kind: 'artifact' as const, itemId: artifactId }, uploadState: 'reserved' as const }, owner), blob });
      }
      await queueArtifactPublication(owner, draftItem(jobId, 'artifact', artifactId, payload, owner), files, type === 'change_order' ? itemOf(source, 'change').find(item => item.itemId === options.changeId) : undefined);
      await flush();
      if ((await workflowOperations(owner)).some(op => op.jobId === jobId)) throw new Error('Publication is saved on this device and will resume after synchronization. Review any reported conflict before publishing.');
    }
    if (type === 'closeout') {
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'application/zip' })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } else { const { downloadPdf } = await import('./pdfService'); downloadPdf(bytes, filename); }
    await reloadLocal();
  };
  const resolve = async (itemId: string, choice: 'local' | 'server') => { await resolveWorkflowConflict(owner, jobId, itemId, choice); await reloadLocal(); await flush(); };
  return { items, available, loading, pendingCount, error, conflicts, lastRefreshedAt, fromCache, refresh, save, remove, attach, download, previewFile: attachmentBlob, exportDocument, resolve };
}
