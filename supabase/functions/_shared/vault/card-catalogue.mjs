// Generated from card-catalogue.mjs by scripts/sync-function-shared.mjs. Do not edit.
// A partial inventory would turn every missing card into an apparent removal.
// An exact first-page count or an empty final page confirms completeness.
export async function readCardPages(makeQuery, signal, onPage) {
  const cards = [];
  let cursor = '';
  while (true) {
    if (signal?.aborted) throw new Error('Card catalogue request cancelled.');
    let query = makeQuery(!cursor);
    if (cursor) query = query.gt('id', cursor);
    const { data, error, count } = await query.order('id').limit(200).abortSignal(signal);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Invalid card catalogue response.');
    if (!data.length) return cards;
    const next = data.at(-1)?.id;
    if (typeof next !== 'string' || next <= cursor) throw new Error('The card catalogue page did not advance.');
    cards.push(...data);
    onPage?.(cards.length);
    if (!cursor && count === data.length) return cards;
    cursor = next;
  }
}
