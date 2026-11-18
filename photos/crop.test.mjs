import assert from 'node:assert/strict';
import test from 'node:test';
import { detectCard, rectify } from './crop.mjs';

function photo(corners, textured = false) {
  const width = 210, height = 240;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const card = corners && corners.every(([a,b], i) => {
        const [c,d] = corners[(i+1)%4];
        return (c-a)*(y-b) >= (d-b)*(x-a);
      });
      const grain = textured ? 7*Math.sin(y/3 + x/50) + 3*Math.sin(x/7) : 0;
      const color = card ? [216,196,135] : [49+grain,65+grain,54+grain];
      data.set([...color,255], 4*(y*width+x));
    }
  }
  return { data, width, height };
}

test('detects each corner of portrait and landscape cards on a textured surface', () => {
  for (const corners of [
    [[63,21],[176,39],[154,213],[39,202]],
    [[22,74],[177,53],[189,158],[34,176]],
  ]) {
    const image = photo(corners, true);
    const detected = detectCard(image);
    assert.ok(detected);
    detected.forEach((p,i) => {
      assert.ok(Math.abs(p.x*(image.width-1)-corners[i][0]) < 4);
      assert.ok(Math.abs(p.y*(image.height-1)-corners[i][1]) < 4);
    });
  }
});

test('preserves framing for a blank surface, a clipped card and a full-frame scan', () => {
  assert.equal(detectCard(photo(null, true)), null);
  assert.equal(detectCard(photo([[-15,26],[118,42],[100,212],[-26,196]])), null);
  assert.equal(detectCard(photo([[0,0],[209,0],[209,239],[0,239]])), null);
});

test('rectifies a quadrilateral while preserving all four corners and their orientation', () => {
  const source = photo(null);
  const points = [{x:63,y:21},{x:176,y:39},{x:154,y:213},{x:39,y:202}];
  const colors = [[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]];
  points.forEach(({x,y},i) => source.data.set(colors[i],4*(y*source.width+x)));
  const target = { width:70, height:100, data:new Uint8ClampedArray(70*100*4) };
  rectify(source,target,points);
  [0,69,6999,6930].forEach((pixel,i) => {
    assert.deepEqual(Array.from(target.data.slice(pixel*4,pixel*4+4)),colors[i]);
  });
});

function cardInHolder({ width = 195, height = 260, clipped = false } = {}) {
  // A test scene with two transparent rims, wood grain and a hand beside
  // the card. The printed border is the most persistent broad contrast step.
  const data = new Uint8ClampedArray(width * height * 4);
  const offset = clipped ? -0.22 : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width - offset + 0.065 * (y / height - 0.15);
      const v = y / height - 0.025 * (x / width - 0.18);
      const grain = 8 * Math.sin(y * 0.71) + 7 * Math.sin(x / 9 + y / 12);
      let gray = 36 + grain + (x / width) * 25;
      let color = x / width > 0.78 + 0.07 * Math.sin(y / 28) && y / height > 0.28
        ? [178, 116, 98] : [gray + 8, gray, gray - 3];
      for (const [left, right, top, bottom] of [[0.10,0.91,0.08,0.89],[0.15,0.87,0.11,0.87]]) {
        if (u < left || u > right || v < top || v > bottom) continue;
        const inset = Math.min((u-left)*width,(right-u)*width,(v-top)*height,(bottom-v)*height);
        color = inset < 1.4 ? [125, 125, 130] : color.map(c => 0.77*c + 11);
      }
      if (u >= 0.18 && u <= 0.84 && v >= 0.15 && v <= 0.85) {
        gray = 138 + 30 * Math.sin(x / 18) + 18 * Math.cos(y / 26);
        if (v > .40 && v < .63 && u > .32 && u < .67) gray = 52;
        color = [gray + 9, gray + 17, gray + 5];
      }
      data.set([...color, 255], 4*(y*width+x));
    }
  }
  return { data, width, height };
}

test('finds the printed card within a clear holder with an uneven background', () => {
  const scene = cardInHolder();
  const corners = detectCard(scene);
  assert.ok(corners, 'should find the printed card inside the holder');
  for (const {x, y} of corners) {
    const u = x + .065*(y-.15);
    const v = y - .025*(x-.18);
    assert.ok(Math.min(Math.abs(u-.18),Math.abs(u-.84)) < .019, 'crop should follow a printed side');
    assert.ok(Math.min(Math.abs(v-.15),Math.abs(v-.85)) < .016, 'crop should follow a printed end');
  }
  assert.equal(detectCard(cardInHolder({ clipped: true })), null);
});

test('keeps the full photo when only texture or a repeating grid is visible', () => {
  for (const grid of [false, true]) {
    const image = photo(null);
    let seed = 8319;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const tone = grid ? 80 + 130 * ((Math.floor(x/16) + Math.floor(y/16)) % 2) : seed >>> 24;
        image.data.set([tone,tone,tone,255], 4*(y*image.width+x));
      }
    }
    assert.equal(detectCard(image), null);
  }
});
