const DAY = 86400000;
const svgNamespace = 'http://www.w3.org/2000/svg';
const axisDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const axisDateWithYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' });

function hasPrice(day) {
  return day.priced > 0 && Number.isSafeInteger(day.valueCents) && day.valueCents >= 0;
}

export function chartSeries(history, range, now = Date.now()) {
  const today = Math.floor(now / DAY) * DAY;
  const cutoff = range === 'all' ? -Infinity : today - (Number(range) - 1) * DAY;
  const sorted = history.map(record => ({ ...record, time: Date.parse(record.date + 'T00:00:00Z') }))
    .filter(day => day.time <= today)
    .sort((a, b) => a.time - b.time);
  const days = [];
  let previousDay = null;
  const segments = [];
  let segment;
  for (const day of sorted) {
    if (day.time < cutoff) {
      previousDay = day;
      continue;
    }
    days.push(day);
    if (hasPrice(day)) {
      if (!segment) { segment = []; segments.push(segment); }
      segment.push(day);
    } else {
      segment = null;
    }
  }
  const start = range === 'all' ? days[0]?.time : cutoff;
  const end = range === 'all' ? days.at(-1)?.time : today;
  return { start, end, days, previousDay, segments, points: segments.flat() };
}

export function priceTicks(amounts) {
  if (!amounts.length) return [];
  let low = amounts[0], high = amounts[0];
  for (const amount of amounts) {
    low = Math.min(low, amount);
    high = Math.max(high, amount);
  }
  const padding = high === low ? Math.max(50, high * .06) : Math.max(1, (high - low) * .08);
  const bottom = Math.max(0, low - padding);
  const top = high + padding;
  const target = Math.max(1, (top - bottom) / 3);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].find(factor => factor * magnitude >= target) * magnitude;
  const first = Math.floor(bottom / step);
  const last = Math.ceil(top / step);
  return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
}

function svgNode(tag, attrs, text) {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createHistoryChart(figure, { money, dateText, changeText, datePicker, onSelect }) {
  const details = figure.closest('details');
  const ranges = figure.querySelector('.history-ranges');
  const buttons = [...ranges.querySelectorAll('button')];
  const readout = figure.querySelector('.history-readout');
  const date = readout.querySelector('.history-date');
  const amount = readout.querySelector('.history-amount');
  const coverage = readout.querySelector('.history-coverage');
  const plot = figure.querySelector('.history-plot');
  const drawing = plot.querySelector('.history-drawing');
  const change = figure.querySelector('.history-change');
  const changeAmount = change.querySelector('strong');
  const help = figure.querySelector('#history-help');
  let records = [], range = 'all', selectedDate = null;
  let series = chartSeries(records, range), index = -1;
  let positions = [], guide, marker;

  function positionMarker() {
    if (!positions[index]) return;
    const { x, y } = positions[index];
    guide.setAttribute('x1', x);
    guide.setAttribute('x2', x);
    marker.setAttribute('visibility', y === null ? 'hidden' : 'visible');
    if (y !== null) {
      marker.setAttribute('cx', x);
      marker.setAttribute('cy', y);
    }
  }

  function showDay(next) {
    const point = series.days[next];
    index = next;
    const label = dateText(point.date);
    const value = hasPrice(point) ? money(point.valueCents) : point.total === 0 ? 'Empty vault' : 'Unpriced';
    const count = point.priced + ' of ' + point.total + (point.total === 1 ? ' card priced' : ' cards priced');
    date.textContent = label;
    amount.textContent = value;
    coverage.textContent = count;
    datePicker.selectedIndex = series.days.length - 1 - next;
    plot.setAttribute('aria-valuenow', next + 1);
    plot.setAttribute('aria-valuetext', [label, value, count].join(', '));
    positionMarker();
    onSelect(series.days[next - 1] ?? series.previousDay, point);
  }

  function draw() {
    if (!details.open || !series.points.length) return;
    const { width, height } = plot.getBoundingClientRect();
    if (!width || !height) return;
    const ticks = priceTicks(series.points.map(point => point.valueCents));
    const labels = ticks.map(tick => money(tick).replace(/\.00$/, ''));
    const left = Math.max(...labels.map(label => label.length)) * 7 + 10;
    const right = Math.max(left + 1, width - 8);
    const top = 12, bottom = height - 26;
    const { start, end } = series;
    const x = time => start === end ? (left + right) / 2 : left + (right - left) * ((time - start) / (end - start));
    const y = cents => bottom - (bottom - top) * ((cents - ticks[0]) / (ticks.at(-1) - ticks[0]));
    const nodes = [];
    ticks.forEach((tick, i) => {
      nodes.push(svgNode('line', { class: 'history-grid', x1: left, x2: right, y1: y(tick), y2: y(tick) }));
      nodes.push(svgNode('text', { x: left - 8, y: y(tick) + 4, 'text-anchor': 'end' }, labels[i]));
    });
    const dates = [start];
    if (width > 460 && end - start >= 2 * DAY) dates.push(start + Math.round((end - start) / (2 * DAY)) * DAY);
    if (start !== end) dates.push(end);
    const formatter = new Date(start).getUTCFullYear() === new Date(end).getUTCFullYear() ? axisDate : axisDateWithYear;
    dates.forEach((time, i) => {
      const anchor = dates.length === 1 ? 'middle' : i === 0 ? 'start' : time === end ? 'end' : 'middle';
      nodes.push(svgNode('text', { x: x(time), y: height - 5, 'text-anchor': anchor }, formatter.format(time)));
    });

    positions = series.days.map(day => ({ x: x(day.time), y: hasPrice(day) ? y(day.valueCents) : null }));
    for (const segment of series.segments) {
      const coords = segment.map(day => ({ x: x(day.time), y: y(day.valueCents) }));
      const vertices = coords.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2));
      if (coords.length > 1) {
        const path = 'M' + vertices.join(' L');
        nodes.push(svgNode('path', { fill: 'url(#history-gold)', d: path + ' L' + coords.at(-1).x + ',' + bottom + ' H' + coords[0].x + ' Z' }));
        nodes.push(svgNode('path', { class: 'history-line', d: path }));
      }
      if (coords.length === 1 || series.points.length <= 90) {
        nodes.push(svgNode('path', { class: 'history-dots', d: vertices.map(p => 'M' + p + 'v.01').join(' ') }));
      }
    }
    guide = svgNode('line', { class: 'history-guide', y1: top, y2: bottom });
    marker = svgNode('circle', { class: 'history-marker', r: 4.5 });
    drawing.replaceChildren(...nodes, guide, marker);
    positionMarker();
  }

  function updateDateOptions(days) {
    const count = days.length;
    datePicker.closest('label').hidden = !count;
    const existing = datePicker.options;
    if (existing.length === count && days.every((day, i) => existing[count - 1 - i].value === day.date)) return;
    const options = days.map(day => new Option(dateText(day.date), day.date)).reverse();
    datePicker.replaceChildren(...options);
  }

  function refresh() {
    series = chartSeries(records, range);
    const { days, points } = series;
    positions = [];
    drawing.replaceChildren();
    updateDateOptions(days);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.range === range));
    ranges.hidden = !records.length;
    readout.hidden = !days.length;
    plot.hidden = !points.length;
    change.hidden = points.length < 2;
    const first = points[0], last = points.at(-1);
    if (!days.length) {
      selectedDate = null;
      index = -1;
      date.textContent = amount.textContent = coverage.textContent = changeAmount.textContent = '';
      for (const attr of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) plot.removeAttribute(attr);
      help.textContent = range === 'all' ? 'Your chart starts with your first priced card.' : 'No dates were recorded in this range.';
      onSelect(null, null, records.length > 0);
      return;
    }
    if (points.length > 1) {
      const delta = last.valueCents - first.valueCents;
      changeAmount.textContent = changeText({ change: delta, percent: first.valueCents ? delta / first.valueCents * 100 : null });
      changeAmount.dataset.direction = String(Math.sign(delta));
    } else {
      changeAmount.textContent = '';
    }
    help.textContent = !points.length ? 'No priced estimates in this range. Choose a recorded date below to inspect the vault.'
      : points.length === 1 ? 'One priced date in this range. A second priced date will show a trend.'
      : 'Hover, tap, or use the arrow keys to inspect a date.';
    plot.setAttribute('aria-valuemin', 1);
    plot.setAttribute('aria-valuemax', days.length);
    const previous = days.findIndex(point => point.date === selectedDate);
    if (previous < 0) selectedDate = null;
    showDay(previous < 0 ? days.length - 1 : previous);
    draw();
  }

  function select(next) {
    if (next === index || !series.days[next]) return;
    selectedDate = next === series.days.length - 1 ? null : series.days[next].date;
    showDay(next);
  }
  function inspect(event) {
    if (!positions.length || event.isPrimary === false) return;
    const pos = event.clientX - plot.getBoundingClientRect().left;
    let nearest = 0;
    for (let i = 1; i < positions.length; i++) {
      if (Math.abs(positions[i].x - pos) >= Math.abs(positions[nearest].x - pos)) break;
      nearest = i;
    }
    select(nearest);
  }
  plot.addEventListener('pointerdown', inspect);
  plot.addEventListener('pointermove', inspect);
  datePicker.addEventListener('change', () => select(series.days.length - 1 - datePicker.selectedIndex));
  plot.addEventListener('keydown', event => {
    const last = series.days.length - 1;
    const targets = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: last };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    select(Math.max(0, Math.min(last, targets[event.key])));
  });
  for (const button of buttons) button.addEventListener('click', () => {
    if (range === button.dataset.range) return;
    range = button.dataset.range;
    selectedDate = null;
    refresh();
  });
  details.addEventListener('toggle', draw);
  if (typeof ResizeObserver === 'function') new ResizeObserver(draw).observe(plot);
  else window.addEventListener('resize', draw);
  return {
    update(history, reset = false) {
      if (history === records && !reset) return;
      if (reset) { range = 'all'; selectedDate = null; }
      records = history;
      refresh();
    },
  };
}
