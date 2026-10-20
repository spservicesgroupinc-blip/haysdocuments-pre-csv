import { useState } from 'react';
import { itemOf, newId, validatePayload, workflowOf, type JobItem } from '../../types/workflow';
import { ActionState, AttachmentList, Field, Message, Panel, button, control, primary, useAction, type WorkflowWorkspaceProps } from './shared';

function ActivityEntry({ item, props, selected, onSelect }: { item: JobItem<'activity'>; props: WorkflowWorkspaceProps; selected: boolean; onSelect: () => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.payload.note);
  const action = useAction();
  const editable = !props.readOnly && item.payload.source === 'manual' && (props.isAdmin || (!!props.actorEmail && item.createdBy.toLowerCase() === props.actorEmail.toLowerCase()));
  const date = new Date(item.payload.occurredAt).toLocaleString('en-US', { timeZone: 'America/Indianapolis', dateStyle: 'medium', timeStyle: 'short' });
  return <li className="min-w-0 space-y-3 rounded-lg border border-line p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-words text-xs text-muted">{item.createdBy || 'Team member'} · {date}{item.updatedAt !== item.createdAt ? ' · Edited' : ''}{item.payload.source === 'system' ? ' · Job history' : ''}</p>{item.payload.source === 'manual' ? <label className="flex min-h-11 items-center gap-2 text-xs text-body"><input className="h-5 w-5 accent-red-600" type="checkbox" checked={selected} onChange={onSelect} />Use in customer draft</label> : null}</div>
    {editing ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void action.run(async () => { const payload = { ...item.payload, note }; validatePayload('activity', payload); await props.onSave('activity', item.itemId, payload); setEditing(false); }, 'Correction saved on this device.'); }}><Field label="Correct update"><textarea className={control} value={note} required rows={3} maxLength={8000} onChange={event => setNote(event.target.value)} /></Field><div className="flex flex-wrap gap-2"><button className={primary} disabled={action.busy}>Save correction</button><button className={button} type="button" disabled={action.busy} onClick={() => setEditing(false)}>Cancel</button></div></form> : <p className="whitespace-pre-wrap break-words text-sm text-body">{item.payload.note}</p>}
    {editable && !editing ? <button className={button} type="button" onClick={() => { setNote(item.payload.note); setEditing(true); }}>Correct note</button> : null}
    <AttachmentList parent={{ kind: 'activity', itemId: item.itemId }} props={item.payload.source === 'system' ? { ...props, readOnly: true } : props} /><ActionState action={action} />
  </li>;
}

export function UpdatesSection(props: WorkflowWorkspaceProps) {
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [draftId, setDraftId] = useState(newId);
  const [posted, setPosted] = useState(false);
  const [limit, setLimit] = useState(20);
  const [selected, setSelected] = useState<string[]>([]);
  const [customerDraft, setCustomerDraft] = useState<string | null>(null);
  const action = useAction();
  const copy = useAction();
  const entries = itemOf(props.items, 'activity').sort((a, b) => b.payload.occurredAt.localeCompare(a.payload.occurredAt));
  async function post() {
    if (!posted) {
      const payload = { note: note.trim(), occurredAt: new Date().toISOString(), source: 'manual' as const, attachmentIds: [] };
      validatePayload('activity', payload);
      await props.onSave('activity', draftId, payload);
      setPosted(true);
    }
    if (files.length) await props.onAttach({ kind: 'activity', itemId: draftId }, files);
    setNote(''); setFiles([]); setDraftId(newId()); setPosted(false);
  }
  function buildDraft() {
    const selectedEntries = entries.filter(item => item.payload.source === 'manual' && selected.includes(item.itemId)).reverse();
    const next = workflowOf(props.job, props.items).nextAction;
    setCustomerDraft([`Hello ${props.job.customer.customerName || 'there'},`, '', 'Here is the latest update on your project:', ...selectedEntries.map(item => `• ${item.payload.note}`), ...(next && !next.completedAt ? ['', `Next step: ${next.title}${next.dueDate ? ` (target: ${next.dueDate})` : ''}.`] : []), '', `Thank you,\n${props.job.branch.name || 'Hays + Sons'}`].join('\n'));
  }
  return <div className="space-y-4"><Panel title="Job updates" description="Keep a dated note and supporting photos or PDFs with the job.">
    {!props.readOnly ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void action.run(post, 'Update saved on this device. Files and notes may still be waiting to sync.'); }}>
      <fieldset disabled={action.busy} className="min-w-0 space-y-3"><Field label="Update"><textarea className={control} rows={3} maxLength={8000} required value={note} disabled={posted} onChange={event => setNote(event.target.value)} placeholder="What changed, what is needed, or what should the team know?" /></Field>
      <Field label="Optional photos or PDFs" help="Up to 10 files. JPEG, PNG, WebP, or PDF; 5 MiB per file. HEIC is not supported."><input key={draftId} type="file" className={control} accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={event => setFiles(Array.from(event.target.files ?? []))} /></Field>
      {files.length ? <p className="break-words text-xs text-muted">{files.map(file => file.name).join(', ')}</p> : null}
      {posted ? <Message>Your note is saved. Retry attaching the selected files; posting again will keep the same note.</Message> : null}
      <button className={primary} type="submit">{action.busy ? 'Saving…' : posted ? 'Retry files' : 'Post update'}</button></fieldset><ActionState action={action} />
    </form> : <p className="text-sm text-muted">You can review updates with your current access.</p>}
    {!entries.length ? <p className="text-sm text-muted">No updates yet. Record the first job update above.</p> : <ul className="space-y-3">{entries.slice(0, limit).map(item => <ActivityEntry item={item} props={props} key={item.itemId} selected={selected.includes(item.itemId)} onSelect={() => setSelected(current => current.includes(item.itemId) ? current.filter(id => id !== item.itemId) : [...current, item.itemId])} />)}</ul>}
    {entries.length > limit ? <button type="button" className={button} onClick={() => setLimit(limit + 20)}>Load more updates</button> : null}
  </Panel>
  <Panel title="Draft customer update" description="Choose manual updates above, then review the wording before copying. No messages are sent.">
    <p className="text-sm text-muted">Include only notes suitable for the customer. Remove internal comments, access details, hazards, and financial information. Attachments are not copied.</p>
    <button className={button} type="button" disabled={!selected.length} onClick={buildDraft}>Build draft ({selected.length} selected)</button>
    {customerDraft !== null ? <><Field label="Customer update draft"><textarea className={`${control} min-h-48`} value={customerDraft} onChange={event => setCustomerDraft(event.target.value)} /></Field><button className={primary} type="button" disabled={copy.busy} onClick={() => void copy.run(async () => { if (!navigator.clipboard) throw new Error('Copy is unavailable here. Select the draft text and copy it manually.'); await navigator.clipboard.writeText(customerDraft); }, 'Draft copied. Review it again before sharing.')}>Copy draft</button><ActionState action={copy} /></> : null}
  </Panel></div>;
}
