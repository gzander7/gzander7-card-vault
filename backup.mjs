// Builds the owner's downloadable backup. Pure functions: callers pass in the
// cards, private records and a photo URL resolver, so this is unit tested.

export const EXPORT_FORMAT = 'card-vault-export';
export const EXPORT_VERSION = 1;

const CARD_FIELDS = [
  'id',
  'created_at',
  'updated_at',
  'player',
  'year',
  'set_name',
  'card_number',
  'parallel',
  'serial',
  'is_auto',
  'is_relic',
  'grader',
  'grade',
  'notes',
  'featured',
  'image_path',
];

const pick = (row, keys) => Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key] ?? null]));

/**
 * @param {object} input
 * @param {any[]} input.cards the owner's cards
 * @param {Record<string, any>} [input.purchases] purchase records keyed by card ID
 * @param {{ quotes?: Record<string, any>, reviews?: Record<string, any>, history?: any[] }} [input.prices]
 * @param {(path: string) => { front: string, back: string }} input.photoUrls
 * @param {{ id: string, email?: string }} input.owner
 * @param {Date} [input.exportedAt]
 */
export function buildVaultExport({ cards, purchases = {}, prices = {}, photoUrls, owner, exportedAt = new Date() }) {
  const quotes = prices.quotes || {};
  const reviews = prices.reviews || {};
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    owner: { id: owner.id, email: owner.email || null },
    cards: cards.map(card => {
      const { front, back } = photoUrls(card.image_path);
      return {
        ...pick(card, CARD_FIELDS),
        photos: { front: front || null, back: back || null },
        purchase: purchases[card.id] ? { ...purchases[card.id] } : null,
        estimate: quotes[card.id] ? { ...quotes[card.id] } : null,
        soldComps: reviews[card.id] ? { ...reviews[card.id] } : {},
      };
    }),
    valueHistory: (prices.history || []).map(day => ({ ...day })),
  };
}

const dollars = cents => (Number.isSafeInteger(cents) ? (cents / 100).toFixed(2) : '');

// Spreadsheet apps run cells that start with these characters as formulas.
function cell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/** @type {Array<[string, (card: any) => unknown]>} */
const CSV_COLUMNS = [
  ['Player', card => card.player],
  ['Year', card => card.year],
  ['Set', card => card.set_name],
  ['Card number', card => card.card_number],
  ['Parallel', card => card.parallel],
  ['Serial', card => card.serial],
  ['Autograph', card => (card.is_auto ? 'Yes' : 'No')],
  ['Relic', card => (card.is_relic ? 'Yes' : 'No')],
  ['Grader', card => card.grader],
  ['Grade', card => card.grade],
  ['Hall of Fame', card => (card.featured ? 'Yes' : 'No')],
  ['Notes', card => card.notes],
  ['Acquired', card => (card.purchase?.acquisition_type === 'pulled' ? 'Pulled' : card.purchase ? 'Bought' : '')],
  ['Cost (USD)', card => dollars(card.purchase?.amount_cents)],
  ['Purchase date', card => card.purchase?.purchased_on],
  ['Seller or box', card => card.purchase?.box_name || card.purchase?.source],
  ['Estimated value (USD)', card => (card.estimate?.status === 'valued' ? dollars(card.estimate.valueCents) : '')],
  ['Estimate confidence', card => (card.estimate?.status === 'valued' ? card.estimate.confidence : '')],
  ['Sale range low (USD)', card => (card.estimate?.status === 'valued' ? dollars(card.estimate.range?.lowCents) : '')],
  [
    'Sale range high (USD)',
    card => (card.estimate?.status === 'valued' ? dollars(card.estimate.range?.highCents) : ''),
  ],
  ['Estimate checked', card => card.estimate?.checkedAt],
  ['Front photo', card => card.photos.front],
  ['Back photo', card => card.photos.back],
  ['Added', card => card.created_at],
  ['Card ID', card => card.id],
];

const BOM = String.fromCharCode(0xfeff);

/** One row per card, for spreadsheets. The JSON export is the complete backup. */
export function vaultExportCsv(data) {
  const lines = [CSV_COLUMNS.map(([title]) => cell(title)).join(',')];
  for (const card of data.cards) lines.push(CSV_COLUMNS.map(([, value]) => cell(value(card))).join(','));
  // A byte order mark lets Excel detect UTF-8 for names with accents.
  return BOM + lines.join('\r\n') + '\r\n';
}

export function exportFilename(extension, date = new Date()) {
  return `card-vault-${date.toISOString().slice(0, 10)}.${extension}`;
}
