const TABLE = 'vault_display_cases';
const COLUMNS = 'id,title,card_ids,revision';
const PICKER_COLUMNS = 'id,player,year,set_name,card_number,parallel,serial,is_auto,is_relic,grader,grade,image_path';

export async function listPickerCards(client, owner, signal, onPage) {
  const cards = [];
  let cursor = '';
  while (true) {
    if (signal?.aborted) throw new Error('Card catalogue request cancelled.');
    let query = client.from('cards').select(PICKER_COLUMNS).eq('owner', owner);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.order('id').limit(200).abortSignal(signal);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Invalid card catalogue response.');
    // A server can cap the result below 200. Only an empty page proves the scan is complete.
    if (!data.length) break;
    const next = data.at(-1)?.id;
    if (typeof next !== 'string' || next <= cursor) throw new Error('The card catalogue page did not advance.');
    cards.push(...data);
    cursor = next;
    onPage?.(cards.length);
  }
  const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return cards.sort((a, b) => byName.compare(a.player, b.player));
}

export class CaseConflict extends Error {
  constructor(message = 'This case changed elsewhere. Reload your display cases to see the latest version.') {
    super(message);
  }
}

export async function listCases(client, owner, signal) {
  const cases = [];
  const pageSize = 200;
  while (true) {
    const page = await client.from(TABLE).select(COLUMNS).eq('owner', owner)
      .order('title').order('id').range(cases.length, cases.length + pageSize - 1).abortSignal(signal);
    if (page.error) throw page.error;
    cases.push(...page.data);
    if (page.data.length < pageSize) return cases;
  }
}

async function findCase(client, owner, id, signal) {
  const response = await client.from(TABLE).select(COLUMNS).eq('owner', owner).eq('id', id)
    .abortSignal(signal).maybeSingle();
  if (response.error) throw response.error;
  return response.data;
}

// Reads the row after a lost reply so repeating an operation with the same ID and
// revision can acknowledge the first write without creating or overwriting another case.
async function writeResult(query, columns, signal) {
  try {
    const result = await query.select(columns).abortSignal(signal).maybeSingle();
    if (!result.error || result.error.code === '23505') return result;
    if (result.status >= 400 && result.status < 500) throw result.error;
  } catch (error) {
    if (signal?.aborted || !(error instanceof TypeError)) throw error;
  }
  return { data: null };
}

export async function saveCase(client, owner, change, signal) {
  const { id, expectedRevision, title, card_ids, revision } = change;
  const fields = { title, card_ids, revision };
  const table = client.from(TABLE);
  const query = expectedRevision
    ? table.update(fields).eq('owner', owner).eq('id', id).eq('revision', expectedRevision)
    : table.insert({ ...fields, id, owner });
  const written = await writeResult(query, COLUMNS, signal);
  if (written.data) return written.data;
  const saved = await findCase(client, owner, id, signal);
  if (saved?.revision === revision) return saved;
  if (!expectedRevision && !saved && written.error?.code === '23505') {
    throw new CaseConflict('This link has already been used. Reload your display cases and create a new case for a fresh link.');
  }
  if ((saved?.revision ?? null) !== expectedRevision) throw new CaseConflict();
  throw new Error('The save could not be confirmed. Reconnect and retry.');
}

export async function stopSharing(client, owner, row, signal) {
  const query = client.from(TABLE).delete().eq('owner', owner).eq('id', row.id).eq('revision', row.revision);
  const result = await writeResult(query, 'id', signal);
  if (result.data) return;
  const saved = await findCase(client, owner, row.id, signal);
  if (!saved) return;
  if (saved.revision !== row.revision) throw new CaseConflict();
  throw new Error('The link could not be closed. Reconnect and retry.');
}
