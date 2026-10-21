import { useEffect, useState } from 'react';
import type { JobItem } from '../../types/workflow';

export function SupportingFileCaption({ item, save }: { item: JobItem<'attachment'>; save: (caption: string) => Promise<void> }) {
  const [caption, setCaption] = useState(item.payload.caption || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setCaption(item.payload.caption || ''); }, [item.payload.caption]);
  async function submit() {
    setBusy(true); setError('');
    try { await save(caption); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Caption could not be saved.'); }
    finally { setBusy(false); }
  }
  return <details className="w-full min-w-0 text-sm text-body"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold">Photo caption / evidence description</summary><div className="space-y-2"><label className="block space-y-1">Caption for {item.payload.filename}<textarea maxLength={500} value={caption} rows={2} className="block min-h-11 w-full rounded-lg border border-line-strong bg-canvas p-2 text-primary" onChange={event => setCaption(event.target.value)} /></label><button type="button" disabled={busy || caption === (item.payload.caption || '')} onClick={() => void submit()} className="min-h-11 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save caption'}</button>{error ? <p role="alert" className="text-danger-copy">{error}</p> : null}</div></details>;
}
