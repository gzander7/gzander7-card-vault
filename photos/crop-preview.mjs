// Both choices are prepared before the preview appears. Toggling never
// reopens the camera or requires decoding a large phone photo again.
export function createCropPreview(side, apply) {
  const button = document.getElementById(side + '-crop-toggle');
  const note = document.getElementById(side + '-crop-note');
  let full = null;
  let crop = null;
  let useCrop = false;

  function show() {
    button.hidden = !crop;
    button.textContent = useCrop ? 'Use full photo' : 'Use auto-crop';
    note.textContent = useCrop ? 'Auto-cropped and straightened.' : 'Full photo selected.';
    apply(useCrop ? crop : full);
  }
  button.addEventListener('click', () => {
    if (!crop) return;
    useCrop = !useCrop;
    show();
  });
  return {
    set(prepared) {
      full = prepared;
      crop = prepared.crop || null;
      useCrop = Boolean(crop);
      show();
    },
    clear() {
      full = crop = null;
      useCrop = false;
      button.hidden = true;
      note.textContent = '';
    },
  };
}
