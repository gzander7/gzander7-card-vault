import { readCardPhotos } from './ocr.mjs';
import { createCropPreview } from '../photos/crop-preview.mjs';
import { parseCardScan } from './parser.mjs';

export function createScanEditor({ getCardHints, onSuggestions, prepareImage, onBackPreparing, onSourceChange = () => {} }) {
  const byId = id => document.getElementById(id);
  const dialog = byId('card-dialog');
  const photoField = byId('photo-field');
  const backFile = byId('card-back-image');
  const backCamera = byId('card-back-camera');
  const backPreview = byId('back-preview');
  const backImage = byId('back-preview-img');
  const read = byId('scan-read');
  const stop = byId('scan-stop');
  const meter = byId('scan-progress');
  const status = byId('scan-status');
  let front = null;
  let savedFront = null;
  let back = null;
  let savedBack = null;
  let backChange;
  let backUrl = '';
  let pendingBack = null;
  let paused = false;
  let scan = null;

  function setStatus(message) {
    if (status.textContent !== message) status.textContent = message;
  }

  function updateControls() {
    const hasFront = Boolean(front || savedFront);
    const hasBack = Boolean(back || savedBack);
    read.disabled = Boolean(scan || pendingBack || paused || (!hasFront && !hasBack));
    read.textContent = hasFront && !hasBack ? 'Read front' : hasBack && !hasFront ? 'Read back' : 'Read photos';
    stop.hidden = !scan;
    meter.hidden = !scan;
  }

  function cancelScan() {
    if (scan) {
      const controller = scan;
      scan = null;
      controller.abort();
    }
    updateControls();
  }

  function cancel() {
    cancelScan();
    setStatus('Scan canceled. You can enter details or read the photos again.');
  }

  function reportProgress(controller, { stage, side, progress }) {
    if (scan !== controller) return;
    setStatus(stage === 'reading' && side ? 'Reading the card ' + side + '…' : 'Loading the text reader…');
    if (Number.isFinite(progress)) meter.value = Math.max(0, Math.min(1, progress));
    else meter.removeAttribute('value');
  }

  async function start() {
    if (read.disabled || !dialog.open || photoField.disabled) return;
    const controller = new AbortController();
    scan = controller;
    updateControls();
    meter.removeAttribute('value');
    setStatus('Loading the text reader…');
    let prefix = '';
    try {
      if (!front && savedFront) {
        setStatus('Opening the saved front photo…');
        try {
          const photo = await savedFront(controller.signal);
          if (scan !== controller) return;
          if (!photo?.size) throw new Error('Empty image');
          front = photo;
        } catch {
          if (scan !== controller) return;
          if (!back && !savedBack) throw new Error('The saved front could not be read. Choose a front photo to scan.');
          prefix = 'The saved front was unavailable. Only the back was read. ';
        }
      }
      if (!back && savedBack) {
        setStatus('Opening the saved back photo…');
        try {
          const photo = await savedBack(controller.signal);
          if (scan !== controller) return;
          if (!photo?.size) throw new Error('Empty image');
          back = photo;
        } catch {
          if (scan !== controller) return;
          if (!front) throw new Error('The saved photos could not be read. Choose a new photo to scan.');
          prefix = 'The saved back was unavailable. Only the front was read. ';
        }
      }
      const result = await readCardPhotos({ front, back }, {
        signal: controller.signal,
        onProgress: event => reportProgress(controller, event),
      });
      if (scan !== controller || !dialog.open || photoField.disabled) return;
      const suggestions = parseCardScan(result, getCardHints());
      const applied = onSuggestions(suggestions);
      if (applied > 0) {
        setStatus(prefix + 'Filled ' + applied + (applied === 1 ? ' field.' : ' fields.') + ' Review the highlighted details before saving.');
      } else if (Object.keys(suggestions).length) {
        setStatus(prefix + 'Scan complete. The recognized details already have entries. Review your fields before saving.');
      } else {
        setStatus(prefix + 'No fields could be read confidently. Try a closer, glare-free photo or enter the details.');
      }
    } catch (error) {
      if (scan === controller && !controller.signal.aborted) {
        setStatus((error?.message || 'The photos could not be read.') + ' You can still enter the details and save.');
      }
    } finally {
      if (scan === controller) {
        scan = null;
        updateControls();
      }
    }
  }

  function sourceChanged() {
    cancelScan();
    onSourceChange();
    setStatus('');
    if ((front || savedFront) && (back || savedBack) && !paused && !pendingBack) void start();
  }

  function setFront(blob) {
    paused = false;
    if (!savedFront && front === blob) {
      updateControls();
      return;
    }
    savedFront = null;
    front = blob || null;
    sourceChanged();
  }

  function setSavedFront(loadBlob) {
    savedFront = loadBlob;
    front = null;
    sourceChanged();
  }

  function discardPendingBack() {
    pendingBack = null;
    onBackPreparing(false);
  }

  const backCrop = createCropPreview('back', prepared => {
    if (backUrl) URL.revokeObjectURL(backUrl);
    backChange = prepared.blob;
    backUrl = URL.createObjectURL(backChange);
    back = prepared.scanBlob;
    backImage.src = backUrl;
    backPreview.hidden = false;
    sourceChanged();
  });

  function clearBack() {
    backCrop.clear();
    back = null;
    savedBack = null;
    backPreview.hidden = true;
    backImage.removeAttribute('src');
    if (backUrl) URL.revokeObjectURL(backUrl);
    backUrl = '';
  }

  function setSavedBack(url, loadBlob) {
    clearBack();
    backChange = undefined;
    savedBack = loadBlob;
    backImage.src = url;
    backPreview.hidden = false;
    updateControls();
  }

  async function chooseBack(event) {
    const input = event.currentTarget;
    const photo = input.files?.[0];
    if (!photo || !dialog.open || photoField.disabled) return;
    input.value = '';
    discardPendingBack();
    cancelScan();
    const token = {};
    pendingBack = token;
    onBackPreparing(true);
    updateControls();
    setStatus('Preparing the back photo…');
    try {
      const prepared = await prepareImage(photo);
      if (pendingBack !== token) return;
      if (!dialog.open || photoField.disabled) {
        discardPendingBack();
        updateControls();
        return;
      }
      discardPendingBack();
      clearBack();
      backCrop.set(prepared);
    } catch (error) {
      if (pendingBack !== token) return;
      discardPendingBack();
      setStatus('Could not open the back photo. ' + (error?.message || 'Choose a JPEG or PNG, or take another photo.'));
      updateControls();
    }
  }

  function removeBack() {
    discardPendingBack();
    clearBack();
    backChange = null;
    sourceChanged();
  }

  function reset() {
    discardPendingBack();
    clearBack();
    backChange = undefined;
    front = null;
    savedFront = null;
    paused = false;
    backFile.value = backCamera.value = '';
    cancelScan();
    setStatus('');
  }

  function pause() {
    paused = true;
    cancelScan();
    setStatus('');
  }

  function resume() {
    paused = false;
    updateControls();
  }

  byId('remove-back-photo').addEventListener('click', removeBack);
  backFile.addEventListener('change', chooseBack);
  backCamera.addEventListener('change', chooseBack);
  read.addEventListener('click', start);
  stop.addEventListener('click', cancel);
  return { setFront, setSavedFront, setSavedBack, getBackChange: () => backChange, reset, cancel, pause, resume };
}
