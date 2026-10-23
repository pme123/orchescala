// Images in details and workaround.
//
// An image is stored as its own file in the shared folder:
//
//   attachments/<yyyy-mm>/<timestamp>-<random>.<ext>
//
// The text only holds the reference `![Screenshot](attachments/…)`. Filed by
// month rather than by error, so that a new error that is not saved yet can
// already have images.
//
// Large images are scaled down: screenshots from Retina displays are quickly
// 5000 px wide and several MB big — 2000 px is enough for the error docs.
// PNG stays PNG (text stays sharp); only if it is still too big afterwards
// does it become JPEG.

export const ATTACHMENT_DIR = 'attachments';
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_WIDTH = 2000;
const SHRINK_FROM = 1.5 * 1024 * 1024;

/** own attachments only — no foreign addresses, no «..» */
export function isAttachmentPath(p: string): boolean {
  return p.startsWith(`${ATTACHMENT_DIR}/`) && !p.includes('..') && /^[\w./-]+$/.test(p);
}

export function isImageFile(f: File | Blob): boolean {
  return f.type in TYPES;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden.')); };
    img.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden.'))), type, quality));
}

/** Check the image and scale it down if needed. */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; ext: string }> {
  if (!isImageFile(file)) throw new Error('Nur Bilder (PNG, JPEG, GIF, WebP).');
  // leave GIFs alone (animation)
  if (file.type === 'image/gif') {
    if (file.size > MAX_BYTES) throw new Error(`GIF ist ${(file.size / 1048576).toFixed(1)} MB — höchstens 5 MB.`);
    return { blob: file, ext: 'gif' };
  }
  const img = await loadImage(file);
  if (file.size <= SHRINK_FROM && img.naturalWidth <= MAX_WIDTH) return { blob: file, ext: TYPES[file.type] };

  const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let blob = await encode(canvas, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
  let ext = file.type === 'image/jpeg' ? 'jpg' : 'png';
  if (blob.size > MAX_BYTES) { blob = await encode(canvas, 'image/jpeg', 0.85); ext = 'jpg'; }
  if (blob.size > MAX_BYTES) throw new Error('Bild ist auch verkleinert noch grösser als 5 MB.');
  return { blob, ext };
}

export function newAttachmentPath(ext: string): string {
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const stamp = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 7);
  return `${ATTACHMENT_DIR}/${month}/${stamp}-${rnd}.${ext}`;
}

/** Markdown for an inserted image */
export function imageMarkdown(path: string, alt = 'Screenshot'): string {
  return `![${alt.replace(/[[\]]/g, '')}](${path})`;
}
