import { useEffect, useId, useRef, useState } from 'react';
import type { JobItem } from '../../types/workflow';

export function SupportingFilePreview({ item, load }: { item: JobItem<'attachment'>; load: () => Promise<Blob> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => { if (url) dialog.current?.showModal(); }, [url]);
  async function open() {
    setBusy(true); setError('');
    try { setUrl(URL.createObjectURL(await load())); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'This file is not available on this device.'); }
    finally { setBusy(false); }
  }
  return <><button type="button" className="min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-body" disabled={busy} onClick={() => void open()}>{busy ? 'Opening…' : 'Preview'}</button>{error ? <p role="alert" className="text-sm text-danger-copy">{error}</p> : null}
    <dialog ref={dialog} aria-labelledby={heading} className="m-auto max-h-[90dvh] w-[min(94vw,900px)] overflow-auto rounded-xl border border-line bg-surface p-4 text-primary backdrop:bg-black/60" onClose={() => setUrl('')} onCancel={() => setUrl('')}>
      <div className="mb-3 flex items-center justify-between gap-3"><h2 id={heading} className="min-w-0 break-words text-sm font-semibold">{item.payload.filename}</h2><button type="button" autoFocus className="min-h-11 rounded-lg border border-line px-3 text-sm" onClick={() => dialog.current?.close()}>Close preview</button></div>
      {url ? item.payload.mimeType.startsWith('image/') ? <img src={url} alt={item.payload.caption || item.payload.filename} className="mx-auto max-h-[70dvh] max-w-full object-contain" /> : <iframe title={`Preview of ${item.payload.filename}`} src={url} className="h-[65dvh] w-full rounded bg-white" /> : null}
      {item.payload.caption ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-body">{item.payload.caption}</p> : null}
    </dialog></>;
}
