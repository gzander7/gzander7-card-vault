// At the detection resolution (320 px long edge), a narrow highlight on a
// transparent sleeve can be stronger than the card itself. Measure contrast
// across both a narrow and a wider band so a one-pixel reflection casts few votes.
function contrast(data, a, b) {
  return Math.max(
    Math.abs(data[a] - data[b]),
    Math.abs(data[a + 1] - data[b + 1]),
    Math.abs(data[a + 2] - data[b + 2]),
  );
}

function edgeMap({ width, height, data }, vertical) {
  const length = vertical ? height : width;
  const depth = vertical ? width : height;
  const stride = vertical ? 4 : 4 * width;
  const strength = new Uint8Array(length * depth);
  const polarity = new Int8Array(length * depth);
  const ridges = [];

  for (let t = 2; t < length - 2; t++) {
    const row = t * depth;
    for (let pos = 3; pos < depth - 3; pos++) {
      const p = 4 * (vertical ? t * width + pos : pos * width + t);
      const near = contrast(data, p - stride, p + stride);
      const before = p - 3 * stride, after = p + 3 * stride;
      const far = contrast(data, before, after);
      const brightness = data[after] - data[before] +
        2 * (data[after + 1] - data[before + 1]) + data[after + 2] - data[before + 2];
      polarity[row + pos] = Math.sign(brightness);
      strength[row + pos] = Math.min(255, near * 1.35, far);
    }
    if (t % 2) continue;
    for (let pos = 3; pos < depth - 3; pos++) {
      const index = row + pos;
      const value = strength[index];
      if (value >= 12 && value > strength[index - 1] && value >= strength[index + 1]) {
        ridges.push({ t, pos, weight: Math.min(1, value / 72) });
      }
    }
  }
  return { length, depth, strength, polarity, ridges };
}

// Vote for lines anywhere in the photo. Starting at the photo margin would
// stop at a finger, wood grain or the holder before reaching the printed edge.
function candidateLines(map) {
  const { length, depth, ridges } = map;
  const middle = (length - 1) / 2;
  const margin = Math.ceil(middle);
  const votes = new Float32Array(depth + 2 * margin);
  const peaks = [];
  for (let angle = -40; angle <= 40; angle += 2) {
    const slope = Math.tan(angle * Math.PI / 180);
    votes.fill(0);
    for (const { t, pos, weight } of ridges) {
      votes[Math.round(pos - slope * (t - middle)) + margin] += weight;
    }
    for (let bin = 1; bin < votes.length - 1; bin++) {
      if (votes[bin] < Math.max(5, length * .027) ||
          votes[bin] <= votes[bin - 1] || votes[bin] < votes[bin + 1]) continue;
      const center = bin - margin;
      peaks.push({ slope, center, intercept: center - slope * middle, votes: votes[bin] });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  const distinct = [];
  for (const line of peaks) {
    if (distinct.some(old => Math.abs(old.center - line.center) +
      .24 * length * Math.abs(old.slope - line.slope) < 3.25)) continue;
    distinct.push(line);
    if (distinct.length === 18) break;
  }
  return distinct.sort((a, b) => a.center - b.center);
}

function oppositeEdges(lines, depth) {
  const pairs = [];
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      const first = lines[a], last = lines[b];
      if (last.center - first.center < .16 * depth || Math.abs(first.slope - last.slope) > .38) continue;
      pairs.push([first, last]);
    }
  }
  return pairs;
}

function crossing(horizontal, vertical) {
  const x = (vertical.slope * horizontal.intercept + vertical.intercept) /
    (1 - vertical.slope * horizontal.slope);
  return { x, y: horizontal.slope * x + horizontal.intercept };
}

function localPeak(values, index) {
  return Math.max(values[index - 1], values[index], values[index + 1]);
}

function lineIndex(map, line, t) {
  const pos = Math.round(line.intercept + line.slope * t);
  return t < 2 || t >= map.length - 2 || pos < 2 || pos >= map.depth - 2
    ? -1 : t * map.depth + pos;
}

function support(map, line, start, end) {
  if (end <= start) return 0;
  let total = 0, signed = 0, present = 0, distinct = 0;
  const count = 24;
  for (let i = 0; i < count; i++) {
    const t = Math.round(start + (end - start) * ((i + .5) / count));
    const index = lineIndex(map, line, t);
    if (index < 0) continue;
    let peak = index;
    if (map.strength[index - 1] > map.strength[peak]) peak = index - 1;
    if (map.strength[index + 1] > map.strength[peak]) peak = index + 1;
    const value = map.strength[peak];
    const pos = index % map.depth;
    const left = pos < 7 ? 0 : localPeak(map.strength, index - 6);
    const right = pos >= map.depth - 7 ? 0 : localPeak(map.strength, index + 6);
    // A card edge stands out from parallel strips nearby. Random foil detail
    // can produce strong gradients almost anywhere, including on a false line.
    if (value > (left + right) * .64 + 6) distinct++;
    if (value >= 16) present++;
    const weight = Math.min(value / 64, 1);
    total += weight;
    signed += weight * map.polarity[peak];
  }
  if (present < .7 * count || distinct < .54 * count) return 0;
  // Along a physical outline, one side usually stays brighter over most of
  // the edge. A repeated checker pattern has contrast but reverses polarity.
  return (.5 * total + .5 * Math.abs(signed)) / count;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function refine(map, line, start, end) {
  // Use only the supported segment here, so collinear texture beyond the
  // corners cannot tilt the fitted boundary.
  let weight = 0, sumT = 0, sumP = 0, sumTT = 0, sumTP = 0;
  for (let t = Math.ceil(start + 2); t < end - 2; t++) {
    const pos = Math.round(line.intercept + line.slope * t);
    let best = 0, bestPos = pos;
    for (let p = Math.max(2, pos - 2); p <= Math.min(map.depth - 3, pos + 2); p++) {
      const value = map.strength[t * map.depth + p] / (1 + .09 * Math.abs(p - pos));
      if (value > best) { best = value; bestPos = p; }
    }
    if (best < 16) continue;
    const w = Math.min(1, best / 76);
    weight += w;
    sumT += w * t;
    sumP += w * bestPos;
    sumTT += w * t * t;
    sumTP += w * t * bestPos;
  }
  const denominator = weight * sumTT - sumT * sumT;
  if (weight < 6 || denominator <= 0) return line;
  const slope = (weight * sumTP - sumT * sumP) / denominator;
  return { slope, intercept: (sumP - slope * sumT) / weight };
}

export function detectCard(image) {
  const { width, height } = image;
  if (Math.min(width, height) < 48) return null;
  const vertical = edgeMap(image, true);
  const horizontal = edgeMap(image, false);
  const sides = oppositeEdges(candidateLines(vertical), width);
  const ends = oppositeEdges(candidateLines(horizontal), height);
  let best = null;
  let bestScore = .65;
  for (const [left, right] of sides) {
    for (const [top, bottom] of ends) {
      const tl = crossing(top, left), tr = crossing(top, right);
      const br = crossing(bottom, right), bl = crossing(bottom, left);
      const corners = [tl, tr, br, bl];
      if (corners.some(p => p.x < 2 || p.y < 2 || p.x > width - 3 || p.y > height - 3)) continue;
      const area = ((br.x - tl.x) * (bl.y - tr.y) - (br.y - tl.y) * (bl.x - tr.x)) / (2 * width * height);
      if (area < .09 || area > .94) continue;
      const topWidth = distance(tl, tr), bottomWidth = distance(bl, br);
      const leftHeight = distance(tl, bl), rightHeight = distance(tr, br);
      const aspect = (topWidth + bottomWidth) / (leftHeight + rightHeight);
      const ratio = Math.min(aspect, 1 / aspect);
      if (ratio < .47 || ratio > .91 ||
          Math.min(topWidth, bottomWidth) < .62 * Math.max(topWidth, bottomWidth) ||
          Math.min(leftHeight, rightHeight) < .62 * Math.max(leftHeight, rightHeight)) continue;

      const leftSupport = support(vertical, left, tl.y, bl.y);
      if (leftSupport < .36) continue;
      const rightSupport = support(vertical, right, tr.y, br.y);
      if (rightSupport < .36) continue;
      const topSupport = support(horizontal, top, tl.x, tr.x);
      if (topSupport < .36) continue;
      const bottomSupport = support(horizontal, bottom, bl.x, br.x);
      if (bottomSupport < .36) continue;
      const weakest = Math.min(leftSupport, rightSupport, topSupport, bottomSupport);
      const average = (leftSupport + rightSupport + topSupport + bottomSupport) / 4;
      const score = .6 * average + .4 * weakest + .08 * Math.sqrt(area) - .16 * Math.abs(ratio - 5 / 7);
      if (score > bestScore) {
        bestScore = score;
        best = { tl, tr, br, bl, top, bottom, left, right };
      }
    }
  }
  if (!best) return null;
  const { tl, tr, br, bl } = best;
  const top = refine(horizontal, best.top, tl.x, tr.x);
  const bottom = refine(horizontal, best.bottom, bl.x, br.x);
  const left = refine(vertical, best.left, tl.y, bl.y);
  const right = refine(vertical, best.right, tr.y, br.y);
  const points = [crossing(top, left), crossing(top, right), crossing(bottom, right), crossing(bottom, left)];
  const cx = points.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / 4;
  return points.map(p => ({
    x: Math.max(0, Math.min(1, (cx + 1.008 * (p.x - cx)) / (width - 1))),
    y: Math.max(0, Math.min(1, (cy + 1.008 * (p.y - cy)) / (height - 1))),
  }));
}
