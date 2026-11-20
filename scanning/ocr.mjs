// The page-side wrapper and worker script are vendored (see vendor/README.md).
// The pinned WASM core and English recognition data load from jsDelivr. Only
// these assets use the network; photo pixels go to an in-browser worker.
const WRAPPER = new URL('../vendor/tesseract/tesseract.esm.min.js', import.meta.url).href;
const WORKER = new URL('../vendor/tesseract/worker.min.js', import.meta.url).href;
const CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';
const ENGLISH = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int';
const MAX_EDGE = 2100;
const MAX_BYTES = 32 * 1024 * 1024;

function badPhoto(side) {
  return new Error('This browser could not read the ' + side + ' photo. Try a clear JPEG or PNG.');
}

async function preparePhoto(blob, side, signal) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let canvas;
  try {
    // HTMLImageElement decodes camera EXIF orientation before drawing.
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    const edge = Math.max(image.naturalWidth, image.naturalHeight);
    if (!edge || !image.naturalWidth || !image.naturalHeight) throw badPhoto(side);
    const targetEdge = Math.min(MAX_EDGE, Math.max(1250, edge), edge * 2);
    const scale = targetEdge / edge;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw badPhoto(side);
    signal.throwIfAborted();
    return { pixels: new Uint8Array(await png.arrayBuffer()), width, height };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw badPhoto(side);
  } finally {
    URL.revokeObjectURL(url);
    image.removeAttribute?.('src');
    if (canvas) canvas.width = canvas.height = 1;
  }
}

function resultFor(data, width, height) {
  const lines = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const text = line.text.trim();
        if (text) lines.push({ text, confidence: line.confidence, bbox: line.bbox });
      }
    }
  }
  return { text: data.text || '', lines, width, height };
}

/**
 * @param {{ front?: Blob | null, back?: Blob | null }} photos
 * @param {{ signal?: AbortSignal, onProgress?: (progress: { side: string | null, stage: string, progress: number }) => void }} [options]
 */
export async function readCardPhotos({ front, back }, { signal, onProgress } = {}) {
  if (!front && !back) throw new Error('Choose a front or back photo to scan.');
  signal?.throwIfAborted();
  const sides = Object.entries({ front, back }).filter(([, photo]) => photo);
  for (const [side, photo] of sides) {
    if (!(photo instanceof Blob) || !photo.size || (photo.type && !photo.type.startsWith('image/')))
      throw badPhoto(side);
    if (photo.size > MAX_BYTES)
      throw new Error('The ' + side + ' photo is too large to scan. Choose a photo under 32 MB.');
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException('Scan cancelled.', 'AbortError'));
  signal?.addEventListener('abort', cancel, { once: true });
  const stopped = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  let worker;
  let timeout;
  let closed = false;
  let side = null;
  let reported = -1;
  const startupError = () =>
    new Error('The text reader could not start. Check your connection and try scanning again.');
  function report(progress) {
    const tenth = Math.floor(Math.max(0, Math.min(1, progress)) * 10);
    if (closed || controller.signal.aborted || tenth <= reported) return;
    reported = tenth;
    onProgress?.({ side, stage: side ? 'reading' : 'loading', progress: tenth / 10 });
  }
  function allowTime(ms, error) {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(error), ms);
  }
  async function recognize() {
    report(0);
    allowTime(90000, startupError());
    let engine;
    try {
      ({ default: engine } = await import(WRAPPER));
      controller.signal.throwIfAborted();
      worker = await engine.createWorker('eng', engine.OEM.LSTM_ONLY, {
        workerPath: WORKER,
        corePath: CORE,
        langPath: ENGLISH,
        logger(event) {
          if (side && event.status === 'recognizing text') report(event.progress);
          if (!side && event.status === 'loading language traineddata') report(0.2 + event.progress * 0.7);
        },
        errorHandler() {
          controller.abort(side ? badPhoto(side) : startupError());
        },
      });
    } catch {
      throw controller.signal.aborted ? controller.signal.reason : startupError();
    }
    // Worker creation finishes asynchronously, even if the caller closed the editor.
    if (closed || controller.signal.aborted) {
      await worker.terminate();
      controller.signal.throwIfAborted();
    }
    report(1);
    const readings = { front: null, back: null };
    for (const [name, photo] of sides) {
      controller.signal.throwIfAborted();
      side = name;
      reported = -1;
      report(0);
      allowTime(90000, new Error('Reading the ' + name + ' took too long. Try a closer, upright photo.'));
      const { pixels, width, height } = await preparePhoto(photo, name, controller.signal);
      controller.signal.throwIfAborted();
      const { data } = await worker.recognize(
        pixels,
        {
          tessedit_pageseg_mode: engine.PSM.SPARSE_TEXT,
          rotateAuto: true,
        },
        { text: true, blocks: true },
      );
      controller.signal.throwIfAborted();
      readings[name] = resultFor(data, width, height);
      report(1);
    }
    return readings;
  }
  try {
    return await Promise.race([recognize(), stopped]);
  } finally {
    closed = true;
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    if (worker) await worker.terminate();
  }
}
