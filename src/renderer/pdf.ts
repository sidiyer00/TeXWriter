// pdf.js setup shared by the PDF review screen and figure previews.
// The legacy build polyfills newer JS built-ins (e.g. Map#getOrInsertComputed) missing in Electron's Chromium.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: bytes }).promise;
}

const figCache = new Map<string, Promise<PDFDocumentProxy>>();
export function loadPdfCached(key: string, get: () => Promise<Uint8Array>): Promise<PDFDocumentProxy> {
  let p = figCache.get(key);
  if (!p) { p = get().then(loadPdf); figCache.set(key, p); p.catch(() => figCache.delete(key)); }
  return p;
}

export async function renderPage(doc: PDFDocumentProxy, n: number, canvas: HTMLCanvasElement, scale: number) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(vp.width * ratio);
  canvas.height = Math.floor(vp.height * ratio);
  canvas.style.width = `${Math.floor(vp.width)}px`;
  canvas.style.height = `${Math.floor(vp.height)}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  await page.render({ canvasContext: ctx, viewport: vp, canvas } as any).promise;
  return vp;
}
