// Each side owns its selected upload and the full source used to adjust it.
// A paused batch keeps only the normalized manual corners and the selected view.
export function createCropPreview(side, apply, editor) {
  const control = name => document.getElementById(side + '-crop-' + name);
  const toggle = control('toggle'),
    adjust = control('adjust'),
    note = control('note');
  let state = null;

  function render() {
    adjust.hidden = !state;
    toggle.hidden = !state?.crop;
    if (!state) {
      note.textContent = '';
      return;
    }
    if (state.crop) {
      const cropChoice = state.manual ? 'Use adjusted crop' : 'Use auto-crop';
      const cropStatus = state.manual ? 'Corners adjusted and straightened.' : 'Auto-cropped and straightened.';
      toggle.textContent = state.useCrop ? 'Use full photo' : cropChoice;
      note.textContent = state.useCrop ? cropStatus : 'Full photo selected.';
    } else if (state.saved) {
      note.textContent = 'Adjust the corners of the saved photo.';
    } else {
      note.textContent = state.full.cropUnavailable
        ? 'This device couldn’t finish the crop. Full photo kept.'
        : 'No clear card outline found. Full photo kept.';
    }
  }

  function select() {
    render();
    if (state.useCrop) apply(state.crop);
    else if (state.saved) state.restore();
    else apply(state.full);
  }

  function setPreparing(preparing) {
    if (preparing) editor.close(side);
    toggle.disabled = adjust.disabled = preparing;
  }

  function clear() {
    editor.close(side);
    state = null;
    setPreparing(false);
    render();
  }

  toggle.addEventListener('click', () => {
    if (!state?.crop || toggle.disabled) return;
    state.useCrop = !state.useCrop;
    select();
  });

  adjust.addEventListener('click', () => {
    const photo = state;
    if (!photo || adjust.disabled) return;
    editor.open({
      side,
      corners: photo.corners,
      original: photo.full?.source,
      loadPreview: async signal => {
        if (photo.full) return photo.full.blob;
        if (!photo.cached) {
          const saved = await photo.load(signal);
          signal?.throwIfAborted();
          photo.cached = saved;
        }
        return photo.cached;
      },
      onApply(crop, corners) {
        if (state !== photo) return;
        Object.assign(photo, { crop, corners, useCrop: true, manual: true });
        select();
      },
    });
  });

  return {
    set(full, draft) {
      clear();
      state = {
        full,
        crop: full.crop,
        corners: full.corners,
        manual: Boolean(draft?.corners),
        useCrop: Boolean(full.crop) && !draft?.full,
      };
      select();
    },
    setSaved(load, restore) {
      clear();
      state = { saved: true, load, restore, corners: null };
      render();
    },
    snapshot() {
      if (!state) return null;
      return { corners: state.manual ? state.corners : null, full: Boolean(state.crop) && !state.useCrop };
    },
    setPreparing,
    clear,
  };
}
