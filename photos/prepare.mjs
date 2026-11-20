import { croppedCanvas, detectPhotoCorners } from './crop.mjs';

const MAX_EDGE = 1400;
// Gallery slabs are 250×350 CSS pixels; 640px covers them on 2× screens.
const THUMB_EDGE = 640;

async function withPhoto(file, signal, work) {
  const type = file.type || '';
  if (type && type !== 'application/octet-stream' && !type.startsWith('image/'))
    throw new Error('Choose an image file.');
  signal?.throwIfAborted();
  const url = URL.createObjectURL(file);
  const image = new Image();
  const release = () => image.removeAttribute?.('src');
  signal?.addEventListener('abort', release, { once: true });
  try {
    image.src = url;
    try {
      await image.decode();
    } catch {
      signal?.throwIfAborted();
      throw new Error('This device could not read that photo. Try a JPEG or PNG.');
    }
    signal?.throwIfAborted();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('This photo has no readable pixels.');
    return await work(image);
  } finally {
    signal?.removeEventListener('abort', release);
    release();
    URL.revokeObjectURL(url);
  }
}

async function encodePhoto(canvas, signal) {
  const encode = type => new Promise(resolve => canvas.toBlob(resolve, type, 0.88));
  signal?.throwIfAborted();
  const blob = (await encode('image/jpeg')) || (await encode('image/webp'));
  signal?.throwIfAborted();
  if (!blob) throw new Error('This browser could not prepare the photo.');
  return { blob, scanBlob: blob, width: canvas.width, height: canvas.height, type: blob.type };
}

async function encodeCrop(image, corners, signal) {
  signal?.throwIfAborted();
  const canvas = croppedCanvas(image, MAX_EDGE, corners);
  if (!canvas) throw new Error('Place the corners around a larger area of the photo.');
  try {
    return await encodePhoto(canvas, signal);
  } finally {
    canvas.width = canvas.height = 1;
  }
}

// The adjustment dialog displays the smaller full-frame preview. Sample the
// camera file again only when applying, so small cards retain available detail.
export function prepareAdjustedCrop(previewImage, original, corners, signal) {
  return original
    ? withPhoto(original, signal, image => encodeCrop(image, corners, signal))
    : encodeCrop(previewImage, corners, signal);
}

export function compressCardImage(file, signal, manualCorners) {
  return withPhoto(file, signal, async image => {
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    let full;
    try {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#12080c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      full = await encodePhoto(canvas, signal);
    } finally {
      canvas.width = canvas.height = 1;
    }
    let corners = manualCorners,
      crop = null,
      cropUnavailable = false;
    try {
      corners = corners || detectPhotoCorners(image);
      if (corners) crop = await encodeCrop(image, corners, signal);
    } catch (error) {
      if (manualCorners || signal?.aborted) throw error;
      cropUnavailable = true;
    }
    const scanBlob = file.size <= 32 * 1024 * 1024 && file.type?.startsWith('image/') ? file : full.blob;
    return { ...full, scanBlob, source: file, corners, crop, cropUnavailable };
  });
}

/** A small JPEG of a prepared front photo for the gallery grid. */
export function createThumbnail(blob, signal) {
  return withPhoto(blob, signal, async image => {
    const scale = Math.min(1, THUMB_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    try {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#12080c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      signal?.throwIfAborted();
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    } finally {
      canvas.width = canvas.height = 1;
    }
  });
}
