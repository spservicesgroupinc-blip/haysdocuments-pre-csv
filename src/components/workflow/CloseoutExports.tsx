import { useEffect, useState } from 'react';
import { closeoutBlockers, itemOf, type CloseoutPayload } from '../../types/workflow';
import { ActionState, ArtifactDownloads, Field, Message, Panel, button, control, primary, useAction, type WorkflowWorkspaceProps } from './shared';

export function CloseoutExports({ props, closeout, dirty, onSelect }: { props: WorkflowWorkspaceProps; closeout: CloseoutPayload; dirty: boolean; onSelect: (ids: string[]) => void }) {
  const [audience, setAudience] = useState<'internal' | 'customer' | 'carrier'>('internal');
  const [reviewed, setReviewed] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => closeout.attachmentIds);
  const selectionKey = JSON.stringify(closeout.attachmentIds);
  useEffect(() => { if (!dirty && !props.readOnly) setSelectedIds(JSON.parse(selectionKey) as string[]); }, [selectionKey, dirty, props.readOnly]);
  function choose(ids: string[]) { setSelectedIds(ids); if (!props.readOnly && JSON.stringify(ids) !== selectionKey) onSelect(ids); setReviewed(false); }
  const action = useAction();
  const files = itemOf(props.items, 'attachment').filter(item => item.payload.parent.kind !== 'artifact');
  const selected = files.filter(item => selectedIds.includes(item.itemId));
  const unavailable = selectedIds.filter(id => !selected.some(file => file.itemId === id && file.payload.uploadState === 'ready'));
  const bytes = selected.reduce((sum, file) => sum + file.payload.byteSize, 0);
  const blockers = closeoutBlockers(closeout);
  const finalBlocked = !closeout.completionDate || (blockers.length > 0 && !closeout.completionOverrideReason.trim());
  const artifacts = itemOf(props.items, 'artifact').filter(item => item.payload.type === 'closeout').sort((a, b) => b.payload.generatedAt.localeCompare(a.payload.generatedAt));
  async function exportPacket(final: boolean) {
    if (dirty) throw new Error('Save the closeout review and file choices before exporting.');
    if (!reviewed) throw new Error('Review the file manifest and confirm the selected audience.');
    if (bytes > 25 * 1024 * 1024) throw new Error('Selected sources exceed 25 MiB. Choose fewer files and split the packet.');
    if (unavailable.length) throw new Error('All selected files must be available before download. Review the manifest and remove unavailable files or wait for sync.');
    await props.onExport('closeout', { audience, attachmentIds: selectedIds, final });
  }
  return <Panel title="Closeout packet" description="Preview the exact selected sources and choose who will receive this packet.">
    <Field label="Packet audience"><select className={control} value={audience} onChange={event => { setAudience(event.target.value as typeof audience); choose([]); }}><option value="internal">Internal closeout</option><option value="customer">Customer closeout</option><option value="carrier">Carrier / depreciation support</option></select></Field>
    <p className="text-sm text-muted">{audience === 'internal' ? 'For the office and project team. Published handoffs and original forms are not added automatically.' : 'The summary excludes internal notes, site access details, mortgage authorization, and SSN fragments. Review every uploaded file separately before including it.'}</p>
    <fieldset className="min-w-0 space-y-2" disabled={action.busy}><legend className="mb-2 text-sm font-semibold text-primary">Supporting files to include</legend>{files.length ? files.map(file => <label key={file.itemId} className="flex min-h-11 items-start gap-3 rounded-lg border border-line p-3 text-sm text-body"><input className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" type="checkbox" checked={selectedIds.includes(file.itemId)} onChange={event => choose(event.target.checked ? [...selectedIds, file.itemId] : selectedIds.filter(id => id !== file.itemId))} /><span className="min-w-0 break-words">{file.payload.filename}<span className="mt-1 block text-xs text-muted">{(file.payload.byteSize / 1024 / 1024).toFixed(2)} MiB · {file.payload.uploadState === 'ready' ? 'Ready' : 'Unavailable / queued'}</span></span></label>) : <p className="text-sm text-muted">No supporting files yet. Add photos or PDFs in the closeout review above.</p>}</fieldset>
    <div className="rounded-lg border border-line bg-canvas p-3"><h3 className="text-sm font-semibold text-primary">File manifest preview</h3><ul className="mt-2 list-inside list-disc space-y-1 break-words text-sm text-body"><li>Branded {audience === 'carrier' ? 'carrier / depreciation support' : audience} completion summary PDF</li><li>Manifest of selected source files</li>{selected.map(file => <li key={file.itemId}>{file.payload.filename}{file.payload.uploadState !== 'ready' ? ' — unavailable' : ''}</li>)}{selected.some(file => file.payload.mimeType.startsWith('image/')) ? <li>Photo appendix with selected images</li> : null}</ul><p className="mt-2 text-xs text-muted">{selected.length} selected source files · {(bytes / 1024 / 1024).toFixed(2)} / 25 MiB. Uploaded PDFs remain separate files in the ZIP.</p></div>
    {unavailable.length ? <Message error>{unavailable.length} selected file(s) are unavailable. Wait for sync or remove them from the manifest before downloading.</Message> : null}
    {bytes > 25 * 1024 * 1024 ? <Message error>The selected sources exceed 25 MiB. Choose fewer files to split the packet.</Message> : null}
    {dirty ? <p className="text-sm text-warning-copy">Save the closeout review after changing file choices, then review this manifest.</p> : null}
    <label className="flex min-h-11 items-start gap-3 text-sm text-body"><input className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /><span>I reviewed the summary audience and every selected attachment for this packet.</span></label>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={action.busy || dirty || !reviewed || unavailable.length > 0 || bytes > 25 * 1024 * 1024} onClick={() => void action.run(() => exportPacket(false))}>Download draft packet</button><button type="button" className={primary} disabled={props.readOnly || action.busy || dirty || !reviewed || props.pendingCount > 0 || finalBlocked || unavailable.length > 0 || bytes > 25 * 1024 * 1024} onClick={() => void action.run(() => exportPacket(true), 'Reviewed closeout packet published with an immutable source.')}>Publish reviewed packet</button></div><ActionState action={action} />
    {artifacts.length ? <details className="rounded-lg border border-line p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-body">Published closeout files ({artifacts.length})</summary><div className="space-y-4">{artifacts.map(artifact => <div className="space-y-1" key={artifact.itemId}><p className="text-xs capitalize text-muted">{artifact.payload.audience ?? 'internal'}</p><ArtifactDownloads artifact={artifact} props={props} /></div>)}</div></details> : null}
  </Panel>;
}
