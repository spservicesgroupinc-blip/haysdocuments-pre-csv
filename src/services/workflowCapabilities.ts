export interface WorkflowCapabilities { apiVersion: number; features: string[]; revisionProtection: boolean; attachmentConfigured?: boolean; attachments?: { configured?: boolean; maxBytes?: number } }
let capabilities: WorkflowCapabilities | null = null;
export function getWorkflowCapabilities(): WorkflowCapabilities | null { return capabilities; }
export function setWorkflowCapabilities(value: WorkflowCapabilities | null): void { capabilities = value; }
export function workflowAvailable(): boolean { return (capabilities?.apiVersion ?? 0) >= 2; }
export function deviceId(): string {
  const key = 'hays.workspace.device';
  const existing = localStorage.getItem(key);
  if (existing && /^[a-zA-Z0-9-]{16,100}$/.test(existing)) return existing;
  const created = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, created);
  return created;
}
