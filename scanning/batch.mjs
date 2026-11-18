function isPhoto(file) {
  if (!file?.size) return false;
  if (file.type?.startsWith('image/')) return true;
  return (!file.type || file.type === 'application/octet-stream') &&
    /\.(?:jpe?g|png|heic|heif|webp|avif|gif|bmp|tiff?)$/i.test(file.name);
}

export function createScanQueue() {
  let owner = '', items = [], saved = 0, skipped = 0;
  function reset() { items = []; saved = skipped = 0; }
  function setOwner(id) {
    if ((id || '') !== owner) reset();
    owner = id || '';
  }
  function add(files, pairs) {
    let ignored = 0;
    if (!owner) return {ignored:files.length};
    const step = pairs ? 2 : 1;
    for (let i = 0; i < files.length; i += step) {
      const front = files[i], candidate = pairs ? files[i + 1] : null;
      if (!isPhoto(front)) { ignored += candidate ? 2 : 1; continue; }
      const back = candidate && isPhoto(candidate) ? candidate : null;
      if (candidate && !back) ignored++;
      items.push({id:crypto.randomUUID(), front, back, draft:null});
    }
    return {ignored};
  }
  function finish(entry, outcome) {
    if (items[0] !== entry || !entry || !['saved','skipped'].includes(outcome)) return false;
    items.shift();
    if (outcome === 'saved') saved++;
    else skipped++;
    return true;
  }
  function remove(entry) {
    const index = items.indexOf(entry);
    if (index !== -1) items.splice(index, 1);
  }
  return {setOwner, reset, add, finish, remove, get items() { return items; },
    get saved() { return saved; }, get skipped() { return skipped; }};
}

export function createBatchDialog(queue, {onReview, onCount}) {
  const field = name => document.getElementById('batch-' + name);
  const dialog = field('dialog'), list = field('list'), message = field('message');
  const library = field('files'), camera = field('camera'), review = field('review');
  const previews = new Map();

  function revoke(row) {
    for (const url of previews.get(row) || []) URL.revokeObjectURL(url);
    previews.delete(row);
  }
  function clearList() {
    for (const row of previews.keys()) revoke(row);
    list.replaceChildren();
  }
  function makeButton(label, click) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-button';
    button.textContent = label;
    button.addEventListener('click', click);
    return button;
  }
  function photoPreview(file, side, urls) {
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = side + ' · ' + file.name;
    const image = document.createElement('img');
    image.alt = 'Queued card ' + side.toLowerCase();
    const url = URL.createObjectURL(file);
    urls.push(url);
    image.src = url;
    figure.append(image, caption);
    return figure;
  }
  function takeBack(entry) {
    const label = document.createElement('label');
    label.className = 'photo-picker link-button';
    label.append('Take back photo');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.setAttribute('aria-label', 'Take back photo for ' + entry.front.name);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file || !queue.items.includes(entry)) return;
      if (!isPhoto(file)) { message.textContent = 'Choose an image for the back.'; return; }
      entry.back = file;
      if (entry.draft) {
        entry.draft.suggestions = {};
        entry.draft.backCrop = null;
      }
      render(entry);
    });
    label.append(input);
    return label;
  }
  function queueRow(entry, index, expanded) {
    const row = document.createElement('li');
    const details = document.createElement('details');
    details.name = 'queued-card';
    const heading = document.createElement('summary');
    const title = document.createElement('strong');
    title.textContent = 'Card ' + (queue.saved + queue.skipped + index + 1);
    const sides = document.createElement('span');
    sides.textContent = entry.front.name + (entry.back ? ' · Front + back' : ' · Front only');
    heading.append(title, ' ', sides);
    const photos = document.createElement('div');
    photos.className = 'batch-photos';
    const actions = document.createElement('div');
    actions.className = 'batch-row-actions';
    if (!entry.retry) {
      if (entry.back) actions.append(makeButton('Swap sides', () => {
        [entry.front,entry.back] = [entry.back,entry.front];
        if (entry.draft) {
          entry.draft.suggestions = {};
          [entry.draft.frontCrop, entry.draft.backCrop] = [entry.draft.backCrop, entry.draft.frontCrop];
        }
        render(entry);
      }));
      else actions.append(takeBack(entry));
      actions.append(makeButton('Remove from queue', () => {
        queue.remove(entry);
        render();
        field('title').focus();
      }));
    } else {
      actions.textContent = 'Review this card to retry its unconfirmed save.';
    }
    details.append(heading, photos, actions);
    details.addEventListener('toggle', () => {
      revoke(row);
      photos.replaceChildren();
      if (!details.open || !row.isConnected || !dialog.open) return;
      const urls = [];
      previews.set(row, urls);
      photos.append(photoPreview(entry.front, 'Front', urls));
      if (entry.back) photos.append(photoPreview(entry.back, 'Back', urls));
    });
    row.append(details);
    if (expanded) details.open = true;
    return row;
  }
  function render(expanded) {
    clearList();
    const count = queue.items.length;
    const totalDone = queue.saved + queue.skipped;
    field('queue').hidden = !count;
    field('count').textContent = count + (count === 1 ? ' card queued' : ' cards queued');
    field('outcome').textContent = totalDone ? queue.saved + ' saved · ' + queue.skipped + ' skipped' : '';
    field('close').textContent = totalDone && !count ? 'Done' : 'Close';
    review.hidden = !count;
    review.textContent = count === 1 ? 'Review 1 card' : 'Review ' + count + ' cards';
    const rows = document.createDocumentFragment();
    queue.items.forEach((item, i) => rows.append(queueRow(item, i, item === expanded)));
    list.append(rows);
    onCount();
  }
  function open() {
    message.textContent = '';
    if (!dialog.open) dialog.showModal();
    render();
    field('title').focus();
  }
  function collect(input, paired) {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    const {ignored} = queue.add(files, paired);
    message.textContent = ignored ? 'Some selected files could not be queued. Check the photo pairs below.' : '';
    render();
  }
  library.addEventListener('change', () => collect(library, field('order').value === 'pairs'));
  camera.addEventListener('change', () => collect(camera, false));
  field('order').addEventListener('change', () => {
    field('order-hint').textContent = field('order').value === 'pairs'
      ? 'Choose front, back, front, back in one selection. A final front can stand alone.'
      : 'Each selected photo starts a card. You can add its back during review.';
  });
  review.addEventListener('click', () => {
    if (!queue.items.length) return;
    dialog.close();
    onReview(queue.items[0]);
  });
  field('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    clearList();
    if (!queue.items.length) queue.reset();
    onCount();
  });
  return {open, close() { if (dialog.open) dialog.close(); clearList(); }};
}
