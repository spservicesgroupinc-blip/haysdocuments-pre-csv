import { cloneElement, isValidElement, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import type { RestorationJobData } from '../../types/jobData';
import type { ItemKind, ItemPayloads, JobItem, RecordedDecision } from '../../types/workflow';
import { SupportingFilePreview } from './SupportingFilePreview';
import { SupportingFileCaption } from './SupportingFileCaption';

export interface WorkflowWorkspaceProps {
  job: RestorationJobData;
  items: JobItem[];
  readOnly: boolean;
  loading: boolean;
  pendingCount: number;
  lastRefreshedAt?: string | null;
  fromCache?: boolean;
  error: string | null;
  section?: 'updates' | 'handoff' | 'selections' | 'changes' | 'closeout';
  actorEmail?: string;
  isAdmin?: boolean;
  onNavigate?: (section: 'customer' | 'insurance' | 'financials' | 'productionNotes' | 'changeOrder') => void;
  onSave: (kind: ItemKind, itemId: string, payload: ItemPayloads[ItemKind]) => Promise<void>;
  onDelete: (item: JobItem) => Promise<void>;
  onAttach: (parent: { kind: ItemKind; itemId: string }, files: File[]) => Promise<void>;
  onDownload: (item: JobItem<'attachment'>) => Promise<void>;
  onPreviewFile?: (item: JobItem<'attachment'>) => Promise<Blob>;
  onExport: (type: 'handoff' | 'change_order' | 'closeout', options?: { audience?: 'internal' | 'customer' | 'carrier'; changeId?: string; attachmentIds?: string[]; final?: boolean }) => Promise<void>;
  onRefresh: () => Promise<void>;
}

export const control = 'min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-canvas px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60';
export const button = 'min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-body hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50';
export const primary = `${button} border-red-600 bg-red-600 text-white hover:bg-red-700`;
export const grid = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
export const money = (cents: number | null) => cents === null ? 'Not recorded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const dollars = (cents: number | null) => cents === null ? '' : (cents / 100).toFixed(2);
export const readCents = (raw: string): number | null => {
  if (!raw.trim()) return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(raw)) throw new Error('Enter an amount with no more than two decimal places.');
  const negative = raw.startsWith('-');
  const [whole, decimal = ''] = raw.replace('-', '').split('.');
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Amount is too large.');
  return negative ? -amount : amount;
};
export function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  const generatedId = useId();
  const child = isValidElement(children) ? children as ReactElement<{ id?: string; 'aria-describedby'?: string }> : null;
  const id = child?.props.id || generatedId;
  const description = [child?.props['aria-describedby'], help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined;
  return <div className="block min-w-0 space-y-1 text-sm font-medium text-body"><label htmlFor={id}>{label}</label>{child ? cloneElement(child, { id, 'aria-describedby': description }) : children}{help ? <p id={`${id}-help`} className="text-xs font-normal text-muted">{help}</p> : null}</div>;
}
export function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-3 sm:p-5"><div><h2 className="text-base font-semibold text-primary">{title}</h2>{description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}</div>{children}</section>;
}
export function Message({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p role={error ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${error ? 'border-danger-line bg-danger-tint text-danger-copy' : 'border-info-line bg-info-tint text-info-copy'}`}>{children}</p>;
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function run(action: () => Promise<void>, success = '') {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(success); return true; }
    catch (err) { setError(err instanceof Error ? err.message : 'The action could not be completed. Your work is retained.'); return false; }
    finally { setBusy(false); }
  }
  return { busy, error, notice, run, clear: () => { setError(''); setNotice(''); } };
}
export function ActionState({ action }: { action: ReturnType<typeof useAction> }) {
  return <>{action.error ? <Message error>{action.error}</Message> : null}{action.notice ? <Message>{action.notice}</Message> : null}</>;
}
export function useDraft<T>(source: T, identity: string) {
  const [draft, setDraft] = useState<T>(() => structuredClone(source));
  const [dirty, setDirty] = useState(false);
  const serialized = JSON.stringify(source);
  const [base, setBase] = useState(serialized);
  const changedElsewhere = dirty && base !== serialized;
  useEffect(() => { setDraft(JSON.parse(serialized) as T); setBase(serialized); setDirty(false); }, [identity]);
  useEffect(() => { if (!dirty) { setDraft(JSON.parse(serialized) as T); setBase(serialized); } }, [serialized, dirty]);
  return { draft, dirty, changedElsewhere, change: (value: T) => { setDraft(value); setDirty(true); }, saved: () => setDirty(false),
    reload: () => { setDraft(JSON.parse(serialized) as T); setBase(serialized); setDirty(false); },
    assertCurrent: () => { if (changedElsewhere) throw new Error('This saved record changed while you were editing. Your draft is retained. Review the newer saved version before saving.'); } };
}

export function DraftNotice({ form }: { form: { changedElsewhere: boolean; reload: () => void } }) {
  return form.changedElsewhere ? <div className="space-y-2"><Message error>The saved record changed while you were editing. Your draft is retained. Review the newer version before saving.</Message><button className={button} type="button" onClick={form.reload}>Discard draft and load saved version</button></div> : null;
}

const decisionLabels: Record<RecordedDecision['status'], string> = { pending: 'Pending', approved: 'Recorded approval', rejected: 'Rejected', changes_requested: 'Changes requested', not_applicable: 'Not applicable' };
export function DecisionFields({ title, value, options, onChange, attachments = [] }: { title: string; value: RecordedDecision; options: RecordedDecision['status'][]; onChange: (value: RecordedDecision) => void; attachments?: JobItem<'attachment'>[] }) {
  const required = ['approved', 'rejected', 'changes_requested'].includes(value.status);
  return <fieldset className="min-w-0 space-y-3 rounded-lg border border-line p-3"><legend className="px-1 text-sm font-semibold text-primary">{title}</legend>
    <Field label="Decision"><select className={control} value={value.status} onChange={event => onChange({ ...value, status: event.target.value as RecordedDecision['status'] })}>{options.map(option => <option key={option} value={option}>{decisionLabels[option]}</option>)}</select></Field>
    <div className={grid}><Field label="Recorded by"><input className={control} value={value.name} required={required} maxLength={200} onChange={event => onChange({ ...value, name: event.target.value })} /></Field><Field label="Decision date"><input className={control} type="date" value={value.date} required={required} onChange={event => onChange({ ...value, date: event.target.value })} /></Field></div>
    <Field label="Decision note / evidence reference"><textarea className={control} rows={2} maxLength={8000} value={value.note} onChange={event => onChange({ ...value, note: event.target.value })} /></Field>
    {attachments.length ? <Field label="Evidence files"><select className={`${control} min-h-24`} multiple value={value.evidenceIds} onChange={event => onChange({ ...value, evidenceIds: Array.from(event.target.selectedOptions, option => option.value) })}>{attachments.map(item => <option key={item.itemId} value={item.itemId}>{item.payload.filename}</option>)}</select></Field> : null}
  </fieldset>;
}

export function AttachmentList({ parent, props }: { parent: { kind: ItemKind; itemId: string }; props: WorkflowWorkspaceProps }) {
  const action = useAction();
  const attachments = props.items.filter((item): item is JobItem<'attachment'> => item.kind === 'attachment' && !item.deletedAt && item.payload.parent.kind === parent.kind && item.payload.parent.itemId === parent.itemId);
  return <div className="min-w-0 space-y-2">
    {attachments.length ? <ul className="space-y-2">{attachments.map(item => <li key={item.itemId} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2"><span className="min-w-0 flex-1 break-words text-sm text-body">{item.payload.filename}<span className="ml-2 text-xs text-muted">{item.payload.uploadState === 'ready' ? 'Ready' : item.payload.uploadState === 'failed' ? 'Needs upload retry' : 'Queued for upload'}</span></span>{props.onPreviewFile ? <SupportingFilePreview item={item} load={() => props.onPreviewFile!(item)} /> : null}<button type="button" className={button} disabled={action.busy || item.payload.uploadState !== 'ready'} onClick={() => void action.run(() => props.onDownload(item))}>Download</button>{!props.readOnly ? <button type="button" className={button} disabled={action.busy} onClick={() => void action.run(() => props.onDelete(item), 'Removal saved on this device.')}>Remove file</button> : null}{!props.readOnly && item.payload.uploadState === 'ready' ? <SupportingFileCaption item={item} save={caption => props.onSave('attachment', item.itemId, { ...item.payload, caption })} /> : null}</li>)}</ul> : null}
    {!props.readOnly ? <Field label="Add photos or PDFs" help="JPEG, PNG, WebP, or PDF; up to 10 files, 5 MiB each. HEIC is not supported."><input className={`${control} file:mr-2 file:rounded file:border-0 file:bg-subtle file:p-2 file:text-primary`} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={action.busy} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) void action.run(() => props.onAttach(parent, files), 'Files saved on this device; uploads continue in the background.'); }} /></Field> : null}
    <ActionState action={action} />
  </div>;
}

export function ArtifactDownloads({ artifact, props }: { artifact: JobItem<'artifact'>; props: WorkflowWorkspaceProps }) {
  const action = useAction();
  const files = props.items.filter((item): item is JobItem<'attachment'> => item.kind === 'attachment' && !item.deletedAt && artifact.payload.outputAttachmentIds.includes(item.itemId));
  return <div className="space-y-2"><p className="text-xs text-muted">{artifact.payload.reviewState === 'final' ? 'Published' : 'Draft'} · {new Date(artifact.payload.generatedAt).toLocaleString('en-US', { timeZone: 'America/Indianapolis' })}</p>{files.length ? <div className="flex flex-wrap gap-2">{files.map(file => <button key={file.itemId} className={`${button} max-w-full break-words text-left`} disabled={action.busy || file.payload.uploadState !== 'ready'} type="button" onClick={() => void action.run(() => props.onDownload(file))}>{file.payload.filename}</button>)}</div> : <p className="text-xs text-muted">Refresh to load the published files.</p>}<ActionState action={action} /></div>;
}
