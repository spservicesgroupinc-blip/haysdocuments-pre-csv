import { callAuthenticatedAppsScript, getCurrentUser, isDeveloperBypassEnabled, DatabaseError } from './appsScriptService';
import { getWorkflowCapabilities, setWorkflowCapabilities, type WorkflowCapabilities } from './workflowCapabilities';
import { cachedWorkflowBlob, type WorkflowOperation } from './workflowStore';
import { getOutboxOps } from './localDb';
import type { JobItem } from '../types/workflow';

let discovery: Promise<WorkflowCapabilities | null> | null = null;
let discoveredFor = '';
export function workflowOwner(): string { return isDeveloperBypassEnabled() ? 'dev' : getCurrentUser()?.email.toLowerCase() ?? ''; }
export async function discoverWorkflowCapabilities(force = false): Promise<WorkflowCapabilities | null> {
  const owner = workflowOwner();
  if (!owner) { discovery = null; discoveredFor = ''; setWorkflowCapabilities(null); return null; }
  if (discovery && discoveredFor === owner && !force) return discovery;
  const cacheKey = `hays.workflow.capabilities:${owner}`;
  if (discoveredFor !== owner) {
    setWorkflowCapabilities(null);
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached?.apiVersion === 2 && Array.isArray(cached.features) && cached.features.every((feature: unknown) => typeof feature === 'string')) setWorkflowCapabilities(cached);
    } catch { /* Capabilities are an optional device cache; the server still authorizes writes. */ }
  }
  discoveredFor = owner;
  discovery = (async () => {
    try {
      const data = await callAuthenticatedAppsScript<WorkflowCapabilities>('getCapabilities');
      if (workflowOwner() !== owner) return null;
      if (data?.apiVersion !== 2 || !Array.isArray(data.features)) { setWorkflowCapabilities(null); try { localStorage.removeItem(cacheKey); } catch {} return null; }
      setWorkflowCapabilities(data);
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* Device storage may be unavailable. */ }
      return data;
    } catch (error) {
      if (workflowOwner() !== owner) return null;
      if (error instanceof DatabaseError && ['unknown_action', 'bad_request'].includes(error.code)) { setWorkflowCapabilities(null); try { localStorage.removeItem(cacheKey); } catch {} }
      return getWorkflowCapabilities();
    }
  })();
  return discovery;
}
function assertOwner(owner: string): void { if (!owner || owner !== workflowOwner()) throw new DatabaseError('Sign in again to synchronize your saved work.', 'unauthorized'); }
export async function fetchWorkflowItems(owner: string, jobId: string): Promise<JobItem[]> {
  const result: JobItem[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined;
  do {
    assertOwner(owner);
    const page = await callAuthenticatedAppsScript<{ items: JobItem[]; nextCursor: string | null }>('listJobItems', { jobId, cursor, pageSize: 100 });
    if (!Array.isArray(page.items) || page.items.some(item => item.jobId !== jobId || !item.itemId || !Number.isInteger(item.revision))) throw new DatabaseError('Unreadable workflow response. Your device copy is retained.', 'bad_response');
    result.push(...page.items);
    cursor = page.nextCursor || undefined;
    if (cursor && visited.has(cursor)) throw new DatabaseError('The workflow list returned a repeated page.', 'bad_response');
    if (cursor) visited.add(cursor);
  } while (cursor);
  return [...new Map(result.map(item => [item.itemId, item])).values()];
}
export async function sendWorkflowOperation(owner: string, op: WorkflowOperation): Promise<JobItem> {
  assertOwner(owner);
  if ((await getOutboxOps()).some(row => row.recordId === op.jobId && row.type !== 'draft' && (!row.owner || row.owner === owner))) throw new DatabaseError('The job save must synchronize before its supporting records.', 'dependency_pending');
  if (!getWorkflowCapabilities()?.features.includes('job_items')) throw new DatabaseError('The workspace backend needs an updated deployment. Your work is saved on this device.', 'missing_capability');
  if (op.method === 'upload' && op.kind === 'attachment') {
    const payload = op.payload as import('../types/workflow').AttachmentPayload;
    await callAuthenticatedAppsScript<{ item: JobItem<'attachment'> }>('reserveJobAttachment', { jobId: op.jobId, parent: payload.parent, attachmentId: op.itemId, mutationId: `${op.key}:reserve`, filename: payload.filename, mimeType: payload.mimeType, byteSize: payload.byteSize, sha256: payload.sha256 });
    assertOwner(owner);
    const blob = await cachedWorkflowBlob(owner, op.jobId, op.itemId);
    if (!blob) throw new DatabaseError('This device no longer has the selected file. Attach it again.', 'missing_file');
    const { blobToBase64 } = await import('./workflowAttachments');
    const base64 = await blobToBase64(blob);
    assertOwner(owner);
    const result = await callAuthenticatedAppsScript<{ item: JobItem }>('uploadJobAttachment', { jobId: op.jobId, attachmentId: op.itemId, mutationId: `${op.key}:upload`, base64 });
    return result.item;
  }
  const result = await callAuthenticatedAppsScript<{ item: JobItem }>('mutateJobItem', { jobId: op.jobId, kind: op.kind, itemId: op.itemId, operation: op.operation, expectedRevision: op.expectedRevision, mutationId: op.key, payload: op.payload });
  return result.item;
}
