const types = [
  ['auto', 'Autos', card => card.is_auto],
  ['graded', 'Graded', card => Boolean(text(card.grader) || text(card.grade))],
  ['numbered', 'Numbered', card => Boolean(text(card.serial))],
  ['relic', 'Relics', card => card.is_relic],
  ['featured', 'Hall of Fame', card => card.featured],
];
const facets = [['player', 'Player', 'players'], ['set_name', 'Set', 'sets'], ['year', 'Year', 'years']];
const sorts = [['newest', 'Newest first'], ['value', 'Highest value'], ['year', 'Year, newest to oldest'], ['player', 'Player, A to Z']];
const views = [['grid', 'Grid'], ['list', 'List']];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const text = value => String(value ?? '').trim();
const searchable = value => text(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const countCards = n => n + (n === 1 ? ' card' : ' cards');
const timestamp = card => Date.parse(card.created_at) || 0;
const newest = (a, b) => timestamp(b) - timestamp(a) || collator.compare(a.id, b.id);
const toggle = (array, value) => array.includes(value) ? array.filter(item => item !== value) : [...array, value];

export function defaultFilters() {
  return { query: '', sort: 'newest', view: 'grid', types: [], player: [], set_name: [], year: [] };
}

function activeCount(filters) {
  return filters.types.length + facets.reduce((count, [key]) => count + filters[key].length, 0);
}

export function matchingCards(cards, filters) {
  const query = searchable(filters.query);
  return cards.filter(card => types.every(([key,, matches]) => !filters.types.includes(key) || matches(card))
    && facets.every(([key]) => !filters[key].length || filters[key].includes(text(card[key])))
    && (!query || searchable([card.player, card.set_name, card.card_number, card.parallel, card.serial, card.grader,
      card.grade, card.notes, card.year, card.card_number && '#' + card.card_number].filter(Boolean).join(' ')).includes(query)));
}

export function estimateCents(quote) {
  return quote?.status === 'valued' && Number.isSafeInteger(quote.valueCents) && quote.valueCents > 0 ? quote.valueCents : null;
}

export function sortCards(cards, sort, quotes) {
  return [...cards].sort((a, b) => {
    if (sort === 'value') return (estimateCents(quotes.get(b.id)) ?? -1) - (estimateCents(quotes.get(a.id)) ?? -1) || newest(a, b);
    if (sort === 'year') return (Number(b.year) || 0) - (Number(a.year) || 0) || newest(a, b);
    if (sort === 'player') return collator.compare(text(a.player), text(b.player)) || newest(a, b);
    return newest(a, b);
  });
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function button(label) {
  const node = element('button', '', label);
  node.type = 'button';
  return node;
}

function choice(label, value, type, name, checked, count) {
  const row = element('label', 'sheet-choice');
  const input = element('input');
  input.type = type;
  input.name = name;
  input.value = value;
  input.checked = checked;
  row.append(input, element('span', '', label));
  if (count !== undefined) row.append(element('span', 'choice-count', String(count)));
  return row;
}

function fillOptions(nodes, parent) {
  parent.querySelectorAll('.sheet-options').forEach(group => group.remove());
  const group = element('div', 'sheet-options');
  group.append(...nodes);
  parent.append(group);
}

function makeTile(card, openCard) {
  const item = element('li', 'gallery-tile');
  item.dataset.id = card.id;
  const photo = element('div', 'gallery-photo');
  const meta = element('p', 'tile-meta');
  const heading = element('h3');
  const trigger = button('');
  trigger.dataset.cardId = card.id;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.addEventListener('click', () => openCard(card.id, trigger));
  heading.append(trigger);
  const tags = element('ul', 'tile-tags');
  tags.setAttribute('aria-label', 'Card attributes');
  const price = element('p', 'tile-estimate');
  const copy = element('div', 'tile-copy');
  copy.append(meta, heading, tags, price);
  item.append(photo, copy);
  return { item, photo, meta, trigger, tags, price };
}

function fillTile(tile, card, src) {
  tile.card = card;
  const name = text(card.player) || 'Trading card';
  if (tile.source !== src) {
    tile.source = src;
    tile.photo.replaceChildren();
    tile.photo.classList.toggle('no-photo', !src);
    if (src) {
      const img = element('img');
      img.alt = '';
      img.width = 250;
      img.height = 350;
      img.decoding = 'async';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        if (tile.source !== src) return;
        tile.photo.classList.add('no-photo');
        img.remove();
      });
      img.src = src;
      tile.photo.append(img);
    }
  }
  tile.meta.textContent = [text(card.year), text(card.set_name)].filter(Boolean).join(' · ');
  tile.trigger.textContent = name;
  tile.trigger.setAttribute('aria-label', 'View ' + [name, tile.meta.textContent, card.card_number && '#' + card.card_number].filter(Boolean).join(', '));
  const labels = [card.is_auto && 'Auto', text(card.parallel), text(card.serial), [text(card.grader), text(card.grade)].filter(Boolean).join(' '), card.is_relic && 'Relic'].filter(Boolean);
  tile.tags.replaceChildren(...labels.map(label => element('li', '', label)));
}

function fillEstimate(tile, quote, isOwner) {
  tile.price.hidden = !isOwner;
  const cents = estimateCents(quote);
  const summary = !isOwner ? '' : cents !== null ? money.format(cents / 100)
    : quote?.status === 'needs_details' ? 'Needs details to price' : 'Unpriced';
  if (tile.summary === summary) return;
  tile.summary = summary;
  tile.price.replaceChildren();
  if (cents !== null && isOwner) tile.price.append(element('strong', '', summary), element('span', 'estimate-label', ' est.'));
  else tile.price.textContent = summary;
}

// Keep already displayed buttons connected when prices arrive or another card is edited.
function reconcile(parent, nodes) {
  const wanted = new Set(nodes);
  for (const old of [...parent.children]) if (!wanted.has(old)) old.remove();
  nodes.forEach((node, index) => {
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null);
  });
}

export function createCollectionGallery({ root, imageUrl, quoteFor, owns, inspectCard, placeSpotlight }) {
  const get = id => root.querySelector('#' + id);
  const form = get('filters');
  const chips = form.querySelector('.gallery-chips');
  const sort = get('gallery-sort');
  const search = get('search');
  const grid = get('card-grid');
  const sheet = get('gallery-filters');
  const facetHost = get('sheet-facets');
  const hall = element('li', 'gallery-hall-slot');
  hall.id = 'gallery-hall-slot';
  const tiles = new Map();
  let cards = [];
  let byId = new Map();
  let signedIn = false;
  let applied = defaultFilters();
  let draft;
  let expanded;
  let sortOptions = [];
  let loaded = false;
  const openCard = (id, trigger) => { if (byId.has(id)) inspectCard(byId.get(id), trigger); };

  for (const [key, label] of types) {
    const quick = button(label);
    quick.dataset.quick = key;
    chips.append(quick);
  }
  for (const [key, label] of facets) {
    const facet = button(label);
    facet.dataset.facet = key;
    facet.setAttribute('aria-haspopup', 'dialog');
    facet.setAttribute('aria-controls', sheet.id);
    chips.append(facet);
  }
  const sheetTrigger = chips.querySelector('.filters-trigger');
  const quickButtons = [...chips.querySelectorAll('[data-quick]')];
  const facetButtons = [...chips.querySelectorAll('[data-facet]')];
  const viewButtons = [...form.querySelectorAll('[data-view]')];

  function renderGallery() {
    const filtered = matchingCards(cards, applied);
    const quotes = new Map();
    for (const card of filtered) if (owns(card)) quotes.set(card.id, quoteFor(card));
    const visible = sortCards(filtered, applied.sort, quotes);
    const active = activeCount(applied);
    const narrowed = active > 0 || Boolean(text(applied.query));
    get('collection-count').textContent = !loaded ? '' : narrowed ? visible.length + ' of ' + countCards(cards.length) : countCards(cards.length);
    get('collection-stats').textContent = loaded ? types.slice(0, 3).map(([key, label, matches]) => {
      const count = cards.filter(matches).length;
      return ' · ' + count + ' ' + (key === 'auto' && count === 1 ? 'auto' : label.toLowerCase());
    }).join('') : '';
    get('active-filter-count').textContent = active ? ' (' + active + ')' : '';
    for (const chip of quickButtons) chip.setAttribute('aria-pressed', String(chip.dataset.quick === 'all' ? !active : applied.types.includes(chip.dataset.quick)));
    for (const chip of facetButtons) {
      const key = chip.dataset.facet;
      const selected = applied[key];
      const label = facets.find(entry => entry[0] === key)[1];
      chip.textContent = selected.length === 1 ? selected[0] : label + (selected.length ? ' (' + selected.length + ')' : '');
      chip.classList.toggle('has-filters', Boolean(selected.length));
      chip.setAttribute('aria-label', 'Filter by ' + label.toLowerCase() + (selected.length ? ': ' + selected.join(', ') : ''));
    }
    for (const view of viewButtons) view.setAttribute('aria-pressed', String(view.dataset.view === applied.view));
    grid.dataset.view = applied.view;
    sort.value = applied.sort;
    if (search.value !== applied.query) search.value = applied.query;
    form.classList.toggle('has-query', Boolean(applied.query));
    get('empty-state').hidden = !loaded || Boolean(visible.length);
    get('clear-filters').hidden = !narrowed;
    get('empty-message').textContent = cards.length ? 'No cards match these filters.'
      : signedIn ? 'The vault is empty. Add the first card.' : 'The vault is empty. Sign in to add the first card.';

    const nodes = visible.map(card => {
      if (!tiles.has(card.id)) tiles.set(card.id, makeTile(card, openCard));
      const tile = tiles.get(card.id);
      if (tile.card !== card) fillTile(tile, card, imageUrl(card.image_path));
      fillEstimate(tile, quotes.get(card.id), owns(card));
      return tile.item;
    });
    hall.hidden = !nodes.length;
    nodes.splice(Math.min(4, nodes.length), 0, hall);
    reconcile(grid, nodes);
    placeSpotlight(hall);
  }

  function updateDraft() {
    const count = matchingCards(cards, draft).length;
    get('apply-filters').textContent = 'Show ' + countCards(count);
    for (const chip of sheet.querySelectorAll('[data-type]')) chip.setAttribute('aria-pressed', String(draft.types.includes(chip.dataset.type)));
  }

  function drawFacet(key, label, plural) {
    const group = element('fieldset');
    group.dataset.group = key;
    group.append(element('legend', '', label));
    const counts = new Map();
    for (const card of cards) {
      const value = text(card[key]);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    const values = [...counts].sort(([a], [b]) => key === 'year' ? Number(b) - Number(a) : collator.compare(a, b));
    const shown = expanded.has(key) ? values : values.filter(([value], i) => i < 4 || draft[key].includes(value));
    for (const [value, count] of shown) group.append(choice(value, value, 'checkbox', key, draft[key].includes(value), count));
    if (!values.length) group.append(element('p', 'facet-empty', 'No ' + plural + ' in the collection.'));
    if (values.length > 4) {
      const more = button(expanded.has(key) ? 'Show fewer ' + plural : 'Show all ' + values.length + ' ' + plural);
      more.className = 'facet-expand';
      more.dataset.expand = key;
      more.setAttribute('aria-expanded', String(expanded.has(key)));
      group.append(more);
    }
    return group;
  }

  function drawSheet() {
    fillOptions(sortOptions.map(([key, label]) => choice(label, key, 'radio', 'sort', draft.sort === key)), get('sheet-sort'));
    const toggles = types.map(([key, label, matches]) => {
      const chip = button(label + ' ');
      chip.append(element('span', '', String(cards.filter(matches).length)));
      chip.dataset.type = key;
      return chip;
    });
    get('sheet-types').querySelector('.sheet-chips').replaceChildren(...toggles);
    facetHost.replaceChildren(...facets.map(args => drawFacet(...args)));
    fillOptions(views.map(([key, label]) => choice(label, key, 'radio', 'view', draft.view === key)), get('sheet-view'));
    updateDraft();
  }

  function showSheet(facet) {
    draft = { ...applied }; // Mutations replace each selection array.
    expanded = new Set(facet ? [facet] : []);
    drawSheet();
    sheet.showModal();
    const content = sheet.querySelector('.sheet-content');
    content.scrollTop = 0;
    get('gallery-filter-title').focus({ preventScroll: true });
    if (facet) {
      const group = facetHost.querySelector('[data-group="' + facet + '"]');
      group.scrollIntoView({ block: 'start' });
      group.querySelector('input')?.focus({ preventScroll: true });
    }
  }

  root.addEventListener('vault:search', () => {
    form.classList.add('search-open');
    search.focus();
  });
  search.addEventListener('input', () => {
    applied.query = search.value;
    renderGallery();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    search.blur();
  });
  sort.addEventListener('change', () => {
    applied.sort = sort.value;
    renderGallery();
  });
  form.addEventListener('click', event => {
    const clicked = event.target.closest('button');
    if (!clicked) return;
    if (clicked === sheetTrigger || clicked.dataset.facet) return showSheet(clicked.dataset.facet);
    if (clicked.dataset.view) applied.view = clicked.dataset.view;
    else if (clicked.dataset.quick === 'all') applied = { ...defaultFilters(), query: applied.query, sort: applied.sort, view: applied.view };
    else if (clicked.dataset.quick) applied.types = toggle(applied.types, clicked.dataset.quick);
    else return;
    renderGallery();
  });
  get('clear-filters').addEventListener('click', () => {
    applied = { ...defaultFilters(), sort: applied.sort, view: applied.view };
    renderGallery();
    quickButtons[0].focus();
  });
  get('dismiss-filters').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', event => {
    if (event.target === sheet) { sheet.close(); return; }
    const clicked = event.target.closest('button');
    if (clicked?.dataset.type) {
      draft.types = toggle(draft.types, clicked.dataset.type);
      updateDraft();
    }
    if (clicked?.dataset.expand) {
      const key = clicked.dataset.expand;
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      const group = drawFacet(...facets.find(([field]) => field === key));
      clicked.closest('fieldset').replaceWith(group);
      group.querySelector('.facet-expand').focus({ preventScroll: true });
    }
  });
  sheet.addEventListener('change', event => {
    const { name, value } = event.target;
    if (name === 'sort' || name === 'view') draft[name] = value;
    else if (facets.some(([key]) => key === name)) draft[name] = toggle(draft[name], value);
    updateDraft();
  });
  get('reset-draft').addEventListener('click', () => {
    draft = { ...defaultFilters(), view: draft.view };
    drawSheet();
  });
  get('gallery-filter-form').addEventListener('submit', event => {
    event.preventDefault();
    applied = draft;
    sheet.close();
    renderGallery();
  });

  return function render(collection, session, error) {
    loaded = Array.isArray(collection) && !error;
    const next = loaded ? collection : [];
    const inventoryChanged = next.length !== cards.length || next.some((card, i) => card !== cards[i]);
    cards = next;
    byId = new Map(cards.map(card => [card.id, card]));
    for (const id of tiles.keys()) if (!byId.has(id)) tiles.delete(id);
    const authChanged = signedIn !== Boolean(session);
    signedIn = Boolean(session);
    if (!signedIn && applied.sort === 'value') applied.sort = 'newest';
    if (!sortOptions.length || authChanged) {
      sortOptions = sorts.filter(([key]) => signedIn || key !== 'value');
      sort.replaceChildren(...sortOptions.map(([key, label]) => new Option(label, key)));
    }
    if (sheet.open && (authChanged || !loaded)) sheet.close();
    else if (sheet.open && inventoryChanged) drawSheet();
    form.hidden = !loaded || !cards.length;
    get('loading').hidden = collection !== null || Boolean(error);
    renderGallery();
  };
}
