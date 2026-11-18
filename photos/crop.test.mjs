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
