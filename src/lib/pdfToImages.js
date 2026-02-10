/**
 * Convert a PDF file to an array of image data URLs (one per page) using PDF.js.
 * For use with vision/multimodal models: drop PDF → send page images.
 */

const MAX_PAGES = 30;
const SCALE = 2;

let pdfjsLib = null;

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  const [lib, workerUrl] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url').then((m) => m.default).catch(() => null),
  ]);
  pdfjsLib = lib;
  if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc && workerUrl) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return pdfjsLib;
}

/**
 * @param {File} file - PDF file
 * @param {{ maxPages?: number }} [opts] - maxPages cap (default MAX_PAGES)
 * @returns {Promise<string[]>} - data URLs, one per page
 */
export async function pdfToImageDataUrls(file, opts = {}) {
  const maxPages = Math.min(MAX_PAGES, opts.maxPages ?? MAX_PAGES);
  const lib = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: arrayBuffer }).promise;
  const numPages = Math.min(doc.numPages, maxPages);
  const urls = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({
      canvasContext: ctx,
      viewport,
      enableWebGL: false,
    }).promise;
    urls.push(canvas.toDataURL('image/png'));
  }

  return urls;
}
