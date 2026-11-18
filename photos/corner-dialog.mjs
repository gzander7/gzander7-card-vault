import { moveCropCorner, validCropCorners } from './crop.mjs';
import { prepareAdjustedCrop } from './prepare.mjs';

const fullFrame = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

export function createCornerDialog() {
  const item = name => document.getElementById('crop-' + name);
  const dialog = item('dialog'), title = item('title'), surface = item('surface'), image = item('image');
  const shade = item('shade'), outline = item('outline'), apply = item('apply');
  const status = item('status'), position = item('position');
  const handles = Array.from(surface.querySelectorAll('[data-corner]'));
  const parent = document.getElementById('card-dialog');
  let session = null;

  function current(job) {
    return session === job && dialog.open && parent.open && !job.controller.signal.aborted;
  }

  function describe() {
    const { selected, corners } = session;
    const { x, y } = corners[selected];
    const message = handles[selected].getAttribute('aria-label') + ', ' +
      (Math.round(x * 1000) / 10) + '% from left, ' + (Math.round(y * 1000) / 10) + '% from top.';
    if (position.textContent !== message) position.textContent = message;
  }

  function select(index) {
    if (!session) return;
    session.selected = index;
    handles.forEach((handle, i) => handle.setAttribute('aria-pressed', String(i === index)));
    describe();
  }

  function draw() {
    const { corners } = session;
    const points = corners.map(({ x, y }) => (x * 100) + ',' + (y * 100));
    shade.setAttribute('d', 'M0 0 H100 V100 H0 Z M' + points.join(' L') + ' Z');
    outline.setAttribute('points', points.join(' '));
    handles.forEach((handle, i) => {
      handle.style.left = (corners[i].x * 100) + '%';
      handle.style.top = (corners[i].y * 100) + '%';
    });
  }

  function move(point) {
    const changed = moveCropCorner(session.corners, session.selected, point);
    if (changed === session.corners) {
      status.textContent = 'Keep the four corners in order around the card.';
      return;
    }
    status.textContent = '';
    session.corners = changed;
    draw();
  }

  function dispose() {
    if (!session) return;
    session.controller.abort();
    image.removeAttribute('src');
    if (session.url) URL.revokeObjectURL(session.url);
    session = null;
    surface.hidden = true;
    position.textContent = '';
  }

  function close(side) {
    if (!session || (side && session.side !== side)) return;
    const opener = document.getElementById(session.side + '-crop-adjust');
    dispose();
    if (dialog.open) dialog.close();
    if (parent.open && !opener.hidden && !opener.disabled) opener.focus({ preventScroll: true });
  }

  async function open({ side, loadPreview, original, corners, onApply }) {
    close();
    const job = {
      side, original, onApply, controller: new AbortController(), selected: 0,
      corners: validCropCorners(corners) ? corners : fullFrame, ready: false, drag: null,
    };
    session = job;
    title.textContent = 'Adjust ' + side + ' corners';
    image.alt = 'Full card ' + side + ' photo';
    status.textContent = 'Opening photo…';
    position.textContent = '';
    surface.hidden = true;
    surface.inert = true;
    apply.disabled = true;
    dialog.showModal();
    title.focus({ preventScroll: true });
    try {
      const blob = await loadPreview(job.controller.signal);
      if (!current(job)) return;
      job.url = URL.createObjectURL(blob);
      image.src = job.url;
      await image.decode();
      if (!current(job)) return;
      if (Math.min(image.naturalWidth, image.naturalHeight) < 2) throw new Error('Photo too small');
      surface.style.setProperty('--crop-ratio', String(image.naturalWidth / image.naturalHeight));
      draw();
      select(0);
      surface.hidden = surface.inert = false;
      apply.disabled = false;
      status.textContent = '';
      job.ready = true;
      if (document.activeElement === title) handles[0].focus({ preventScroll: true });
    } catch {
      if (current(job)) status.textContent = 'Could not open this photo. Cancel and try again, or choose another photo.';
    }
  }

  async function accept() {
    const job = session;
    if (!job?.ready || apply.disabled) return;
    job.ready = false;
    job.drag = null;
    apply.disabled = surface.inert = true;
    status.textContent = 'Straightening photo…';
    try {
      const result = await prepareAdjustedCrop(image, job.original, job.corners, job.controller.signal);
      if (!current(job)) return;
      job.onApply(result, job.corners);
      close();
    } catch (error) {
      if (!current(job)) return;
      status.textContent = error?.message || 'The crop could not be prepared. Try adjusting the corners again.';
      job.ready = true;
      apply.disabled = surface.inert = false;
    }
  }

  function pointerPosition(event) {
    const rect = surface.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }

  surface.addEventListener('pointerdown', event => {
    if (!session?.ready || session.drag || !event.isPrimary || event.button !== 0) return;
    const handle = event.target.closest('[data-corner]');
    const index = handle ? Number(handle.dataset.corner) : session.selected;
    select(index);
    handles[index].focus({ preventScroll: true });
    const point = pointerPosition(event);
    const start = session.corners[index];
    session.drag = { id: event.pointerId, dx: handle ? start.x - point.x : 0, dy: handle ? start.y - point.y : 0 };
    surface.setPointerCapture(event.pointerId);
    if (!handle) move(point);
    event.preventDefault();
  });

  function drag(event) {
    const pointer = session?.drag;
    if (!pointer || pointer.id !== event.pointerId) return;
    const point = pointerPosition(event);
    move({ x: point.x + pointer.dx, y: point.y + pointer.dy });
  }
  surface.addEventListener('pointermove', drag);
  surface.addEventListener('pointerup', event => {
    if (session?.drag?.id !== event.pointerId) return;
    drag(event);
    describe();
    session.drag = null;
  });
  for (const name of ['pointercancel', 'lostpointercapture']) {
    surface.addEventListener(name, event => {
      if (session?.drag?.id === event.pointerId) session.drag = null;
    });
  }

  handles.forEach((handle, index) => {
    handle.addEventListener('focus', () => select(index));
    handle.addEventListener('click', () => select(index));
    handle.addEventListener('keydown', event => {
      if (!session?.ready || event.altKey || event.ctrlKey || event.metaKey || !Object.hasOwn(arrows, event.key)) return;
      event.preventDefault();
      select(index);
      const rect = surface.getBoundingClientRect();
      const [dx, dy] = arrows[event.key], step = event.shiftKey ? 10 : 1;
      const point = session.corners[index];
      move({ x: point.x + dx * step / rect.width, y: point.y + dy * step / rect.height });
      describe();
    });
  });

  apply.addEventListener('click', accept);
  item('cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open) dispose(); });
  return { open, close };
}
