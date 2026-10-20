/** File preparation stays on the device; only the supporting copy is uploaded. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_BATCH = 10;
export const PHOTO_TARGET_BYTES = 2 * 1024 * 1024;
export const PHOTO_MAX_EDGE = 2000;

export interface PreparedAttachment {
  blob: Blob;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export function safeAttachmentName(value: string, fallback = 'attachment'): string {
  const basename = String(value).split(/[\\/]/).pop() || fallback;
  return basename.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 180) || fallback;
}

export function detectAttachmentMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
  return null;
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('This photo could not be prepared. Your note is still saved.')), 'image/jpeg', quality);
  });
}

async function decodePhoto(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; dispose: () => void }> {
  // Browsers apply EXIF orientation before resize. Never infer orientation from width alone.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch { /* Safari versions without bitmap support use the oriented image decoder below. */ }
  }
  if (typeof Image === 'undefined') throw new Error('Photo preparation requires a browser. Please retry on your device.');
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This photo could not be decoded. Choose a JPEG, PNG, or WebP photo.'));
      element.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

/** Also used when a cached, supported WebP image is placed in a PDF appendix. */
export async function normalizeSupportingPhoto(blob: Blob): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('Photo preparation requires a browser. Please retry on your device.');
  const decoded = await decodePhoto(blob);
  try {
    if (!decoded.width || !decoded.height) throw new Error('The selected photo has invalid dimensions.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This device could not prepare the photo. Your note is still saved.');
    let scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(decoded.width, decoded.height));
    for (let attempt = 0; attempt < 9; attempt++) {
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      // Transparent PNGs need a white backing before becoming JPEGs.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.76, 0.64, 0.52]) {
        const result = await canvasBlob(canvas, quality);
        if (result.size <= PHOTO_TARGET_BYTES) return result;
      }
      scale *= 0.8;
    }
    throw new Error('This photo could not be reduced to 2 MiB. Choose a smaller photo. Your note is still saved.');
  } finally { decoded.dispose(); }
}

export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  if (/\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type)) {
    throw new Error('HEIC photos are not supported. Choose JPEG, PNG, WebP, or PDF, or change the camera format. Your note is still saved.');
  }
  if (!file.size) throw new Error('The selected file is empty. Choose another file.');
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Each selected file must be 5 MiB or smaller. Your note is still saved.');
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectAttachmentMime(originalBytes);
  if (!mimeType || (file.type && file.type !== mimeType && !(mimeType === 'image/jpeg' && file.type === 'image/jpg'))) {
    throw new Error('The file signature does not match a supported JPEG, PNG, WebP, or PDF. Your note is still saved.');
  }
  const isPdf = mimeType === 'application/pdf';
  const blob = isPdf ? new Blob([originalBytes.buffer], { type: mimeType }) : await normalizeSupportingPhoto(file);
  const preparedMime = isPdf ? mimeType : 'image/jpeg';
  const base = safeAttachmentName(file.name).replace(/\.[^.]+$/, '');
  const name = isPdf ? `${base || 'document'}.pdf` : `${base || 'photo'}.jpg`;
  const bytes = isPdf ? originalBytes : new Uint8Array(await blob.arrayBuffer());
  return { blob, name, mimeType: preparedMime, size: blob.size, sha256: await sha256Bytes(bytes) };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let start = 0; start < bytes.length; start += 32768) binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return btoa(binary);
}

export function base64ToBlob(value: string, mimeType = 'application/octet-stream'): Blob {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('The attachment response contains invalid base64. Please retry the download.');
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new Blob([bytes.buffer], { type: mimeType });
}
