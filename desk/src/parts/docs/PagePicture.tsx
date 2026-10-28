// A picture of one page of a kept document, drawn in the browser: a PDF page through pdf.js (served from /vendor/pdfjs, loaded only when a
// page is first shown), a photo as itself. Drawn on a canvas, so nothing needs a blob: address the page's security policy would refuse.
import { useEffect, useRef, useState } from 'react';
import { fetchBytes } from '../../lib';

type PdfJs = { getDocument: (o: Record<string, unknown>) => { promise: Promise<any> }; GlobalWorkerOptions: { workerSrc: string } };
let lib: Promise<PdfJs> | null = null;
const pdfjs = (): Promise<PdfJs> => {
  lib ??= (async () => {
    const base = new URL('vendor/pdfjs/', document.baseURI).href;
    const m = (await import(/* webpackIgnore: true */ base + 'pdf.mjs')) as PdfJs;
    m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.mjs';
    return m;
  })();
  lib.catch(() => { lib = null; });
  return lib;
};

// the same document is often shown several times (a search with three pages of one file), so its bytes and parsed PDF are kept for the visit
const files = new Map<string, Promise<ArrayBuffer>>();
const pdfs = new Map<string, Promise<any>>();
const bytesOf = (id: string) => { let p = files.get(id); if (!p) { p = fetchBytes(`/api/docs/${id}/file`); files.set(id, p); p.catch(() => files.delete(id)); } return p; };
const pdfOf = (id: string) => {
  let p = pdfs.get(id);
  if (!p) { p = Promise.all([pdfjs(), bytesOf(id)]).then(([m, b]) => m.getDocument({ data: new Uint8Array(b.slice(0)), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise); pdfs.set(id, p); p.catch(() => pdfs.delete(id)); }
  return p;
};

export function PagePicture({ docId, mime, page = 1, width = 240, label }: { docId: string; mime: string; page?: number; width?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  useEffect(() => {
    let live = true; setState('loading');
    (async () => {
      const c = ref.current; if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (mime === 'application/pdf') {
        const doc = await pdfOf(docId);
        const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
        const v1 = p.getViewport({ scale: 1 });
        const vp = p.getViewport({ scale: (width / v1.width) * dpr });
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await p.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      } else if (mime.startsWith('image/')) {
        const img = await createImageBitmap(new Blob([await bytesOf(docId)], { type: mime }));
        const scale = (width * dpr) / img.width;
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      } else throw new Error('no picture');
      if (live) setState('ok');
    })().catch(() => live && setState('failed'));
    return () => { live = false; };
  }, [docId, mime, page, width]);
  return (
    <div className={`page-pic${state === 'loading' ? ' loading' : ''}`} style={{ width }}>
      <canvas ref={ref} role="img" aria-label={label ?? `Page ${page}`} style={{ width, display: state === 'failed' ? 'none' : 'block' }} />
      {state === 'failed' && <div className="page-pic-none small muted">{mime.startsWith('text/') || mime.includes('sheet') ? 'A text or spreadsheet file has no page picture.' : 'The page could not be drawn.'}</div>}
    </div>
  );
}

/** "…the [lease] with [Arvindbhai]…" with the found words marked. */
export function Snippet({ text }: { text: string }) {
  return <span className="doc-snip">{text.split(/(\[[^\]]+\])/).map((p, i) => (p.startsWith('[') && p.endsWith(']') ? <mark key={i}>{p.slice(1, -1)}</mark> : p))}</span>;
}
