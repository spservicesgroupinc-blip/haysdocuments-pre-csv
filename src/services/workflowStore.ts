import { openWorkspaceDb } from './localDb';
import { draftItem, newId, validatePayload, type JobItem, type ItemKind, type ItemPayloads } from '../types/workflow';

const ITEMS = 'workflowItems', OPS = 'workflowOutbox', BLOBS = 'workflowBlobs', CONFLICTS = 'workflowConflicts';
interface CachedItem { key: string; owner: string; jobId: string; item: JobItem; base: JobItem | null }
export interface WorkflowOperation {
  key: string; owner: string; jobId: string; kind: ItemKind; itemId: string;
  operation: 'create' | 'update' | 'delete'; payload: ItemPayloads[ItemKind];
  method: 'item' | 'upload'; createdAt: number; dispatched: boolean; expectedRevision?: number;
  blocked?: boolean; error?: string; attempts: number; blobKey?: string;
  dependencies?: string[]; nextAttemptAt?: number;
}
export interface WorkflowConflict { key: string; owner: string; jobId: string; itemId: string; current: JobItem; local: JobItem; message: string }
type QueueFailure = Error & { code?: string; details?: { current?: JobItem } };
const listeners = new Set<() => void>();
export function subscribeWorkflow(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
function changed() { for (const listener of listeners) listener(); }
const itemKey = (owner: string, jobId: string, id: string) => `${owner.toLowerCase()}|${jobId}|${id}`;
/** Allocate ordering inside the write transaction: UUID order is not creation order. */
function appendOperations(tx: IDBTransaction, operations: WorkflowOperation[]): void {
  const store = tx.objectStore(OPS), request = store.getAll();
  request.onsuccess = () => {
    let timestamp = Math.max(Date.now() - 1, ...(request.result as WorkflowOperation[]).map(op => op.createdAt));
    for (const op of operations) store.put({ ...op, createdAt: ++timestamp });
  };
}

async function transaction<T>(stores: string[], operation: (tx: IDBTransaction, done: (result: T) => void) => void): Promise<T> {
  const db = await openWorkspaceDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    let result: T;
    tx.oncomplete = () => { changed(); resolve(result); };
    tx.onabort = () => reject(tx.error || new Error('Could not store the workflow on this device.'));
    try { operation(tx, value => { result = value; }); } catch (error) { tx.abort(); reject(error); }
  });
}
async function all<T>(name: string): Promise<T[]> {
  const db = await openWorkspaceDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readonly');
    const req = tx.objectStore(name).getAll();
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error);
  });
}
export async function cachedWorkflowItems(owner: string, jobId: string): Promise<JobItem[]> {
  return (await all<CachedItem>(ITEMS)).filter(row => row.owner === owner && row.jobId === jobId).map(row => row.item).filter(item => !item.deletedAt);
}
export async function workflowOperations(owner: string): Promise<WorkflowOperation[]> { return (await all<WorkflowOperation>(OPS)).filter(row => row.owner === owner).sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key)); }
export async function workflowConflicts(owner: string): Promise<WorkflowConflict[]> { return (await all<WorkflowConflict>(CONFLICTS)).filter(row => row.owner === owner); }

export async function queueWorkflowItem(owner: string, jobId: string, kind: ItemKind, itemId: string, payload: ItemPayloads[ItemKind], operation: 'create' | 'update' | 'delete' = 'update'): Promise<JobItem> {
  validatePayload(kind, payload);
  if (!owner || !jobId || !itemId) throw new Error('Sign in and choose a job first.');
  return transaction<JobItem>([ITEMS, OPS], (tx, done) => {
    const store = tx.objectStore(ITEMS), key = itemKey(owner, jobId, itemId);
    const request = store.get(key);
    request.onsuccess = () => {
      const prior: CachedItem | undefined = request.result;
      const item = prior ? { ...prior.item, payload, updatedAt: new Date().toISOString(), updatedBy: owner, deletedAt: operation === 'delete' ? new Date().toISOString() : null } as JobItem : draftItem(jobId, kind, itemId, payload, owner);
      const base = prior?.base ?? (prior?.item.revision ? prior.item : null);
      store.put({ key, owner, jobId, item, base });
      appendOperations(tx, [{ key: newId(), owner, jobId, kind, itemId, payload, operation: operation === 'delete' ? 'delete' : base ? 'update' : 'create', method: 'item', createdAt: Date.now(), dispatched: false, attempts: 0 }]);
      done(item);
    };
  });
}
export async function queueWorkflowFile(owner: string, item: JobItem<'attachment'>, blob: Blob): Promise<void> {
  await queueWorkflowFiles(owner, [{ item, blob }]);
}
export interface WorkflowFile { item: JobItem<'attachment'>; blob: Blob }
export async function queueWorkflowFiles(owner: string, files: WorkflowFile[]): Promise<void> {
  if (!owner) throw new Error('Sign in before saving supporting files.');
  for (const { item, blob } of files) {
    validatePayload('attachment', item.payload);
    if (!item.jobId || blob.size !== item.payload.byteSize) throw new Error('The supporting file does not match its metadata.');
  }
  await transaction<void>([ITEMS, OPS, BLOBS], tx => {
    appendOperations(tx, files.map(({ item, blob }) => stageFile(tx, owner, item, blob)));
  });
}
function stageFile(tx: IDBTransaction, owner: string, item: JobItem<'attachment'>, blob: Blob): WorkflowOperation {
  const key = itemKey(owner, item.jobId, item.itemId);
  tx.objectStore(ITEMS).put({ key, owner, jobId: item.jobId, item, base: null });
  tx.objectStore(BLOBS).put({ key, owner, blob, acknowledged: false });
  return { key: newId(), owner, jobId: item.jobId, kind: 'attachment', itemId: item.itemId, payload: item.payload, operation: 'create', method: 'upload', blobKey: key, createdAt: Date.now(), dispatched: false, attempts: 0 };
}
/** The entire publication intent survives reload, including its final dependent step. */
export async function queueArtifactPublication(owner: string, artifact: JobItem<'artifact'>, files: WorkflowFile[], linkedChange?: JobItem<'change'>): Promise<void> {
  validatePayload('artifact', artifact.payload);
  const required = [artifact.payload.snapshotAttachmentId, ...artifact.payload.outputAttachmentIds];
  if (!owner || required.length !== files.length || required.some(id => !files.some(file => file.item.itemId === id))) throw new Error('The document publication is missing a required file.');
  for (const { item, blob } of files) {
    validatePayload('attachment', item.payload);
    if (item.jobId !== artifact.jobId || item.payload.parent.itemId !== artifact.itemId || item.payload.parent.kind !== 'artifact' || blob.size !== item.payload.byteSize) throw new Error('The document file does not match its publication.');
  }
  await transaction<void>([ITEMS, OPS, BLOBS], tx => {
    const draft = { ...artifact, payload: { ...artifact.payload, reviewState: 'draft' as const } };
    const key = itemKey(owner, artifact.jobId, artifact.itemId);
    tx.objectStore(ITEMS).put({ key, owner, jobId: artifact.jobId, item: artifact, base: null });
    const initial: WorkflowOperation = { key: newId(), owner, jobId: artifact.jobId, kind: 'artifact', itemId: artifact.itemId, payload: draft.payload, operation: 'create', method: 'item', createdAt: Date.now(), dispatched: false, attempts: 0 };
    const uploads = files.map(({ item, blob }) => ({ ...stageFile(tx, owner, item, blob), dependencies: [initial.key] }));
    const final: WorkflowOperation = { ...initial, key: newId(), payload: artifact.payload, operation: 'update', dependencies: uploads.map(op => op.key) };
    const operations = [initial, ...uploads, final];
    if (linkedChange) {
      const item = { ...linkedChange, payload: { ...linkedChange.payload, documentArtifactId: artifact.itemId } };
      validatePayload('change', item.payload);
      if (item.jobId !== artifact.jobId) throw new Error('The change belongs to a different job.');
      tx.objectStore(ITEMS).put({ key: itemKey(owner, item.jobId, item.itemId), owner, jobId: item.jobId, item, base: linkedChange });
      operations.push({ ...initial, key: newId(), kind: 'change', itemId: item.itemId, payload: item.payload, operation: 'update', dependencies: [final.key] });
    }
    appendOperations(tx, operations);
  });
}
export async function cachedWorkflowBlob(owner: string, jobId: string, itemId: string): Promise<Blob | null> {
  return (await all<{ key: string; owner: string; blob: Blob }>(BLOBS)).find(row => row.key === itemKey(owner, jobId, itemId) && row.owner === owner)?.blob ?? null;
}
export async function cacheWorkflowBlob(owner: string, jobId: string, itemId: string, blob: Blob): Promise<void> {
  await transaction<void>([BLOBS], tx => { tx.objectStore(BLOBS).put({ key: itemKey(owner, jobId, itemId), owner, blob, acknowledged: true }); });
}
export async function cacheWorkflowItems(owner: string, items: JobItem[]): Promise<void> {
  await transaction<void>([ITEMS, OPS], tx => {
    const queued = tx.objectStore(OPS).getAll();
    queued.onsuccess = () => {
      const pending = queued.result as WorkflowOperation[];
      for (const item of items) {
        if (pending.some(op => op.owner === owner && op.jobId === item.jobId && op.itemId === item.itemId)) continue;
        const key = itemKey(owner, item.jobId, item.itemId);
        const existing = tx.objectStore(ITEMS).get(key);
        existing.onsuccess = () => {
          const prior = existing.result as CachedItem | undefined;
          if (!prior || (prior.base?.revision ?? 0) <= item.revision) tx.objectStore(ITEMS).put({ key, owner, jobId: item.jobId, item, base: item });
        };
      }
    };
  });
}
export type WorkflowSender = (operation: WorkflowOperation) => Promise<JobItem>;
const running = new Map<string, Promise<void>>();
export function flushWorkflowQueue(owner: string, send: WorkflowSender, isCurrent: () => boolean = () => true): Promise<void> {
  if (running.has(owner)) return running.get(owner)!;
  const task = flush(owner, send, isCurrent).finally(() => { running.delete(owner); });
  running.set(owner, task);
  return task;
}
async function flush(owner: string, send: WorkflowSender, isCurrent: () => boolean): Promise<void> {
  for (const snapshot of await workflowOperations(owner)) {
    if (!isCurrent()) return;
    const pending = await workflowOperations(owner), op = pending.find(row => row.key === snapshot.key);
    if (!op || op.blocked || (op.nextAttemptAt ?? 0) > Date.now()) continue;
    const position = pending.findIndex(row => row.key === op.key);
    if (pending.slice(0, position).some(row => row.jobId === op.jobId && row.itemId === op.itemId)) continue;
    if (op.dependencies?.some(key => pending.some(row => row.key === key))) continue;
    if (op.method === 'upload') {
      const parent = (op.payload as ItemPayloads['attachment']).parent;
      if (pending.slice(0, position).some(row => row.jobId === op.jobId && row.itemId === parent.itemId)) continue;
    }
    if (op.kind === 'artifact' && (op.payload as ItemPayloads['artifact']).reviewState === 'final') {
      const artifact = op.payload as ItemPayloads['artifact'];
      const required = [artifact.snapshotAttachmentId, ...artifact.outputAttachmentIds];
      const files = await cachedWorkflowItems(owner, op.jobId);
      if (required.some(id => pending.some(row => row.itemId === id && row.jobId === op.jobId) || !files.some(item => item.itemId === id && item.kind === 'attachment' && item.payload.uploadState === 'ready'))) continue;
    }
    const cached = (await all<CachedItem>(ITEMS)).find(row => row.key === itemKey(owner, op.jobId, op.itemId));
    if (!op.dispatched) {
      op.expectedRevision = cached?.base?.revision ?? 0;
      if (op.method === 'item') op.operation = op.operation === 'delete' ? 'delete' : op.expectedRevision ? 'update' : 'create';
      op.dispatched = true;
      await transaction<void>([OPS], tx => { tx.objectStore(OPS).put(op); });
    }
    try {
      const acknowledged = await send(op);
      if (acknowledged.jobId !== op.jobId || acknowledged.itemId !== op.itemId || !Number.isInteger(acknowledged.revision) || acknowledged.revision < 1) throw new Error('The server did not acknowledge this supporting record.');
      await transaction<void>([ITEMS, OPS, BLOBS], tx => {
        const queue = tx.objectStore(OPS), rows = queue.getAll();
        rows.onsuccess = () => {
          const rest = (rows.result as WorkflowOperation[]).filter(row => row.key !== op.key);
          const later = rest.some(row => row.owner === owner && row.jobId === op.jobId && row.itemId === op.itemId);
          queue.delete(op.key);
          const key = itemKey(owner, op.jobId, op.itemId), latest = tx.objectStore(ITEMS).get(key);
          latest.onsuccess = () => {
            const row = latest.result as CachedItem | undefined;
            tx.objectStore(ITEMS).put({ key, owner, jobId: op.jobId, base: acknowledged, item: later && row ? { ...row.item, revision: acknowledged.revision } : acknowledged });
          };
          if (op.blobKey) {
            const blob = tx.objectStore(BLOBS).get(op.blobKey);
            blob.onsuccess = () => { if (blob.result) tx.objectStore(BLOBS).put({ ...blob.result, acknowledged: true }); };
          }
        };
      });
    } catch (error) {
      const err = error as QueueFailure;
      const retryable = ['network_error', 'timeout', 'busy', 'dependency_pending', 'server_error', 'internal_error'].includes(err.code || 'network_error');
      await transaction<void>([OPS, ITEMS, CONFLICTS], tx => {
        tx.objectStore(OPS).put({ ...op, attempts: op.attempts + 1, blocked: !retryable, error: err.message, nextAttemptAt: retryable ? Date.now() + Math.min(60000, 1000 * 2 ** Math.min(op.attempts, 6)) : undefined });
        if (err.code === 'conflict' && err.details?.current) {
          const key = itemKey(owner, op.jobId, op.itemId), latest = tx.objectStore(ITEMS).get(key);
          latest.onsuccess = () => { const row = latest.result as CachedItem | undefined; if (row) tx.objectStore(CONFLICTS).put({ key, owner, jobId: op.jobId, itemId: op.itemId, current: err.details!.current, local: row.item, message: err.message }); };
        }
      });
      if (['network_error', 'timeout', 'unauthorized', 'session_expired', 'bad_response'].includes(err.code || 'network_error')) return;
    }
  }
}
export async function resolveWorkflowConflict(owner: string, jobId: string, itemId: string, choice: 'local' | 'server'): Promise<void> {
  await transaction<void>([OPS, ITEMS, CONFLICTS], tx => {
    const key = itemKey(owner, jobId, itemId), req = tx.objectStore(CONFLICTS).get(key);
    req.onsuccess = () => {
      const conflict = req.result as WorkflowConflict | undefined;
      if (!conflict) return;
      const queue = tx.objectStore(OPS), ops = queue.getAll();
      ops.onsuccess = () => {
        for (const op of ops.result as WorkflowOperation[]) if (op.owner === owner && op.jobId === jobId && op.itemId === itemId) queue.delete(op.key);
        const latest = tx.objectStore(ITEMS).get(key);
        latest.onsuccess = () => {
          const local = (latest.result as CachedItem | undefined)?.item ?? conflict.local;
          tx.objectStore(ITEMS).put({ key, owner, jobId, base: conflict.current, item: choice === 'server' ? conflict.current : { ...local, revision: conflict.current.revision } });
          if (choice === 'local') appendOperations(tx, [{ key: newId(), owner, jobId, kind: local.kind, itemId, operation: local.deletedAt ? 'delete' : 'update', method: 'item', payload: local.payload, createdAt: Date.now(), dispatched: false, attempts: 0 }]);
        };
        tx.objectStore(CONFLICTS).delete(key);
      };
    };
  });
}
export async function retryWorkflowErrors(owner: string): Promise<void> {
  const conflicts = await workflowConflicts(owner);
  await transaction<void>([OPS], tx => {
    const req = tx.objectStore(OPS).getAll();
    req.onsuccess = () => { for (const op of req.result as WorkflowOperation[]) if (op.owner === owner && !conflicts.some(row => row.jobId === op.jobId && row.itemId === op.itemId)) tx.objectStore(OPS).put({ ...op, blocked: false, error: undefined, nextAttemptAt: undefined }); };
  });
}
