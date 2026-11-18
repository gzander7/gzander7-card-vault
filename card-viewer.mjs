const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function openCardViewer({ title, detail, frontUrl, backUrl }, trigger = document.activeElement) {
  const existing = document.getElementById('card-viewer');
  if (existing?.open) return existing;

  const dialog = document.createElement('dialog');
  dialog.id = 'card-viewer';
  dialog.setAttribute('aria-labelledby', 'viewer-title');
  dialog.innerHTML = `
    <header class="viewer-header">
      <div>
        <h2 id="viewer-title"></h2>
        <p class="viewer-detail"></p>
      </div>
      <button type="button" class="link-button viewer-close">Close</button>
    </header>
    <div class="viewer-stage" tabindex="0" role="group" aria-label="Card photo"
      aria-describedby="viewer-hint" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown">
      <div class="viewer-card">
        <img class="viewer-face" data-side="front" alt="" draggable="false" hidden>
        <img class="viewer-face" data-side="back" alt="" draggable="false" hidden>
      </div>
      <p class="viewer-message" role="status">Loading photo…</p>
    </div>
    <footer class="viewer-footer">
      <div>
        <p class="viewer-side" role="status" aria-live="polite" aria-atomic="true"></p>
        <p id="viewer-hint"></p>
      </div>
      <button type="button" class="viewer-flip" hidden>Flip card</button>
    </footer>`;

  const find = selector => dialog.querySelector(selector);
  const stage = find('.viewer-stage');
  const card = find('.viewer-card');
  const flip = find('.viewer-flip');
  const close = find('.viewer-close');
  const message = find('.viewer-message');
  const sideLabel = find('.viewer-side');
  const hint = find('#viewer-hint');
  const images = { front: find('[data-side="front"]'), back: find('[data-side="back"]') };
  const name = title || 'Trading card';
  find('#viewer-title').textContent = name;
  find('.viewer-detail').textContent = detail || '';
  images.front.alt = 'Front of ' + name;
  images.back.alt = 'Back of ' + name;
  const state = { front: frontUrl ? 'loading' : 'absent', back: backUrl ? 'loading' : 'absent' };
  let yaw = 0;
  let pitch = 0;
  let drag = null;

  const canFlip = () => state.front === 'ready' && state.back === 'ready';
  const showBack = () => Math.cos(yaw * Math.PI / 180) < 0;
  function paint() {
    card.style.transform = `rotateX(${pitch}deg) rotateY(${yaw}deg)`;
    const backVisible = showBack();
    images.front.setAttribute('aria-hidden', String(backVisible));
    images.back.setAttribute('aria-hidden', String(!backVisible));
    const visibleSide = backVisible ? 'back' : 'front';
    const label = state[visibleSide] === 'ready' ? (backVisible ? 'Card back' : 'Card front') : '';
    if (sideLabel.textContent !== label) sideLabel.textContent = label;
  }

  function syncImages() {
    const hasFront = state.front === 'ready';
    const hasBack = state.back === 'ready' && state.front !== 'loading';
    const hasPhoto = hasFront || hasBack;
    const loading = Object.values(state).includes('loading');
    flip.hidden = !canFlip();
    message.hidden = hasPhoto;
    message.textContent = hasPhoto ? '' : loading ? 'Loading photo…' : 'Card photos unavailable.';
    if (hasPhoto) {
      const available = hasFront ? images.front : images.back;
      card.style.setProperty('--photo-ratio', available.naturalWidth / available.naturalHeight);
      if (!canFlip()) yaw = hasFront ? 0 : 180;
    }
    stage.classList.toggle('has-photo', hasPhoto);
    if (canFlip()) {
      hint.textContent = 'Drag or use the arrow keys to turn the card.';
    } else if (hasPhoto) {
      const other = hasFront ? 'back' : 'front';
      const info = state[other] === 'absent' ? 'Only this side is saved.'
        : state[other] === 'error' ? 'The other photo could not load.' : 'Loading the other side…';
      hint.textContent = info + ' Drag or use the arrow keys to tilt.';
    } else {
      hint.textContent = '';
    }
    paint();
  }

  for (const [side, url] of Object.entries({ front: frontUrl, back: backUrl })) {
    if (!url) continue;
    const image = images[side];
    image.addEventListener('load', () => {
      state[side] = 'ready';
      image.hidden = false;
      syncImages();
    }, { once: true });
    image.addEventListener('error', () => {
      state[side] = 'error';
      syncImages();
    }, { once: true });
    image.src = url;
  }

  function turnToOtherSide() {
    if (!canFlip()) return;
    const nearestFace = Math.round(yaw / 180) * 180;
    yaw = nearestFace + (yaw >= nearestFace ? 180 : -180);
    pitch = 0;
    paint();
  }
  function setYaw(value) {
    if (canFlip()) return value;
    const center = state.front === 'ready' ? 0 : 180;
    return clamp(value, center - 28, center + 28);
  }

  stage.addEventListener('pointerdown', event => {
    if (drag || event.button !== 0 || !event.isPrimary || !stage.classList.contains('has-photo')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw, pitch,
      degreesPerPixel: 210 / Math.max(1, card.offsetWidth) };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('is-turning');
  });
  stage.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    yaw = setYaw(drag.yaw + (event.clientX - drag.x) * drag.degreesPerPixel);
    pitch = clamp(drag.pitch - (event.clientY - drag.y) * .35, -32, 32);
    paint();
  });
  function endDrag(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    stage.classList.remove('is-turning');
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);
  stage.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || !stage.classList.contains('has-photo')) return;
    if (event.key === 'ArrowLeft') yaw = setYaw(yaw - 20);
    else if (event.key === 'ArrowRight') yaw = setYaw(yaw + 20);
    else if (event.key === 'ArrowUp') pitch = clamp(pitch + 10, -32, 32);
    else if (event.key === 'ArrowDown') pitch = clamp(pitch - 10, -32, 32);
    else return;
    event.preventDefault();
    paint();
  });
  flip.addEventListener('click', turnToOtherSide);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }, { once: true });

  syncImages();
  document.body.appendChild(dialog);
  dialog.showModal();
  stage.focus({ preventScroll: true });
  return dialog;
}
