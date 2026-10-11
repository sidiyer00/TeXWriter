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

export interface PdfLink { rect: [number, number, number, number]; url?: string; page?: number; y?: number }

/** Link annotations of a page in viewport pixels at `scale` (hyperref makes refs, cites and URLs links). */
export async function pageLinks(doc: PDFDocumentProxy, n: number, scale: number): Promise<PdfLink[]> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const annots = await page.getAnnotations();
  const out: PdfLink[] = [];
  for (const a of annots as any[]) {
    if (a.subtype !== 'Link' || !a.rect) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
    const rect: [number, number, number, number] = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
    if (a.url || a.unsafeUrl) { out.push({ rect, url: a.url || a.unsafeUrl }); continue; }
    if (!a.dest) continue;
    try {
      const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest;
      if (!dest) continue;
      const idx = typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : Number(dest[0]);
      const target = await doc.getPage(idx + 1);
      const h = target.view[3] - target.view[1];
      const yTop = dest[1]?.name === 'XYZ' && typeof dest[3] === 'number' ? h - dest[3] : dest[1]?.name === 'FitH' && typeof dest[2] === 'number' ? h - dest[2] : undefined;
      out.push({ rect, page: idx + 1, y: yTop });
    } catch { /* unresolvable destination */ }
  }
  return out;
}
