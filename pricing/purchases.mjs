export function localDay(now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
}

export function parsePurchase({amount, date, source}, today = localDay()) {
  const price = amount.trim();
  const purchasedOn = date.trim();
  const from = source.trim();
  if (!price && !purchasedOn && !from) return null;
  if (!price) throw new Error('Enter the total paid. Use 0 for a gift or a free card.');
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(price)) {
    throw new Error('Enter a nonnegative USD amount with up to two decimal places.');
  }
  const [dollars, fraction = ''] = price.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 999999999999) throw new Error('The total paid is too large.');
  if (purchasedOn) {
    const day = new Date(purchasedOn + 'T00:00:00Z');
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(purchasedOn) || !Number.isFinite(+day)
        || day.toISOString().slice(0, 10) !== purchasedOn || purchasedOn < '0001-01-01' || purchasedOn > today) {
      throw new Error('Choose a valid purchase date on or before today.');
    }
  }
  if (from.length > 160) throw new Error('Keep the purchase source to 160 characters.');
  return {amount_cents:cents, purchased_on:purchasedOn || null, source:from || null};
}

export function purchaseTotals(cards, records, valueFor) {
  let tracked = 0, spent = 0, compared = 0, comparedCost = 0, comparedValue = 0;
  for (const card of cards) {
    const cost = records[card.id]?.amount_cents;
    if (!Number.isSafeInteger(cost) || cost < 0) continue;
    tracked++;
    spent += cost;
    const value = valueFor(card);
    if (!Number.isSafeInteger(value) || value <= 0) continue;
    compared++;
    comparedCost += cost;
    comparedValue += value;
  }
  const change = compared ? comparedValue - comparedCost : null;
  const percent = comparedCost ? 100 * change / comparedCost : null;
  return {tracked, spent, compared, comparedCost, comparedValue, change, percent};
}

export function createPurchaseLedger(read, onChange = () => {}) {
  let session = null, records = {}, status = 'idle', pending = null;
  let hasSnapshot = false;
  function setSession(next) {
    if (session?.user?.id !== next?.user?.id) {
      records = {};
      hasSnapshot = false;
      pending = null;
      status = 'idle';
    }
    session = next;
  }
  function load(force = false) {
    if (!session?.user?.id) return Promise.reject(new Error('Sign in to view purchases.'));
    if (pending) return pending.job;
    if (!force && status === 'ready') return Promise.resolve();
    const request = {edits:{}};
    pending = request;
    if (status !== 'ready') status = 'loading';
    request.job = (async () => {
      try {
        const rows = await read(session);
        if (pending !== request) return;
        records = {...rows, ...request.edits};
        hasSnapshot = true;
        status = 'ready';
      } catch (error) {
        if (pending !== request) return;
        status = 'error';
        throw error;
      } finally {
        if (pending === request) {
          pending = null;
          onChange();
        }
      }
    })();
    return request.job;
  }
  function accept(owner, id, row) {
    if (owner !== session?.user?.id) return;
    records = {...records, [id]:row};
    if (pending) pending.edits[id] = row;
    onChange();
  }
  return {setSession, load, accept, get records() { return records; }, get status() { return status; },
    get hasSnapshot() { return hasSnapshot; }};
}
