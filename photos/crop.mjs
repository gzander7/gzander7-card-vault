import { detectCard } from './outline.mjs';

export { detectCard };

// Project each output pixel back into the photographed plane and interpolate
// its color. This straightens converging sides without changing their order.
export function rectify(source, target, corners) {
  const [a,b,c,d] = corners;
  const dx1 = b.x - c.x, dx2 = d.x - c.x, dx3 = a.x - b.x + c.x - d.x;
  const dy1 = b.y - c.y, dy2 = d.y - c.y, dy3 = a.y - b.y + c.y - d.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  const xx = b.x - a.x + g * b.x, xy = d.x - a.x + h * d.x;
  const yx = b.y - a.y + g * b.y, yy = d.y - a.y + h * d.y;
  const { width, height, data } = source;
  for (let y = 0, out = 0; y < target.height; y++) {
    const v = y / (target.height - 1);
    for (let x = 0; x < target.width; x++, out += 4) {
      const u = x / (target.width - 1);
      const divisor = 1 + g * u + h * v;
      const sx = Math.min(width - 1, Math.max(0, (xx * u + xy * v + a.x) / divisor));
      const sy = Math.min(height - 1, Math.max(0, (yx * u + yy * v + a.y) / divisor));
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const p = 4 * (iy * width + ix);
      const q = ix + 1 < width ? p + 4 : p;
      const down = iy + 1 < height ? width * 4 : 0;
      const fx = sx - ix, fy = sy - iy;
      for (let k = 0; k < 3; k++) {
        const top = (1 - fx) * data[p + k] + fx * data[q + k];
        const bottom = (1 - fx) * data[p + down + k] + fx * data[q + down + k];
        target.data[out + k] = (1 - fy) * top + fy * bottom;
      }
      target.data[out + 3] = 255;
    }
  }
}

export function croppedCanvas(image, maxEdge) {
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const quad = detectCard(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (!quad) return null;

    const points = quad.map(p => ({ x: p.x * (image.naturalWidth - 1), y: p.y * (image.naturalHeight - 1) }));
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const left = Math.floor(Math.min(...xs)), top = Math.floor(Math.min(...ys));
    const boxWidth = Math.ceil(Math.max(...xs)) - left + 1;
    const boxHeight = Math.ceil(Math.max(...ys)) - top + 1;
    const sampleScale = Math.min(1, maxEdge / Math.max(boxWidth, boxHeight));
    canvas.width = Math.max(2, Math.round(boxWidth * sampleScale));
    canvas.height = Math.max(2, Math.round(boxHeight * sampleScale));
    ctx.drawImage(image, left, top, boxWidth, boxHeight, 0, 0, canvas.width, canvas.height);
    const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const local = points.map(p => ({
      x: (p.x - left) * (canvas.width - 1) / (boxWidth - 1),
      y: (p.y - top) * (canvas.height - 1) / (boxHeight - 1),
    }));
    const length = (i, j) => Math.hypot(local[i].x - local[j].x, local[i].y - local[j].y);
    const width = (length(0, 1) + length(3, 2)) / 2;
    const height = (length(0, 3) + length(1, 2)) / 2;
    const outputScale = Math.min(1, maxEdge / Math.max(width, height));
    const output = document.createElement('canvas');
    output.width = Math.max(2, Math.round(width * outputScale));
    output.height = Math.max(2, Math.round(height * outputScale));
    const out = output.getContext('2d');
    const pixels = out.createImageData(output.width, output.height);
    rectify(source, pixels, local);
    out.putImageData(pixels, 0, 0);
    return output;
  } finally {
    canvas.width = canvas.height = 1;
  }
}
