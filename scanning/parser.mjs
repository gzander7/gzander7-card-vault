// Only return fields supported by legible text on the photographed card.
const clean = value => String(value ?? '').normalize('NFKC')
  .replace(/[‐‑‒–—−]/g, '-').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const key = value => clean(value).normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const whole = (text, term) => (' ' + key(text) + ' ').includes(' ' + key(term) + ' ');
const unique = values => {
  const result = new Map();
  for (const value of values.filter(Boolean)) if (!result.has(key(value))) result.set(key(value), value);
  return result.size === 1 ? result.values().next().value : null;
};

function readLines(side) {
  if (!side) return [];
  const source = Array.isArray(side) ? side : side.lines?.length ? side.lines :
    (typeof side === 'string' ? side : String(side.text || '')).split(/\r?\n/);
  return source.flatMap((line, index) => {
    const text = clean(typeof line === 'string' ? line : line?.text);
    const confidence = line?.confidence == null ? null : Number(line.confidence);
    if (!text || text.length > 340 || (Number.isFinite(confidence) && confidence < 55)) return [];
    const bounds = line?.bbox;
    const y = bounds && side.height > 0 ? ((bounds.y0 + bounds.y1) / 2) / side.height : null;
    return [{ text, index, y, confidence }];
  });
}

const products = [
  'Contenders Optic', 'Prizm Draft Picks', 'Select Draft Picks', 'Contenders Draft Picks',
  'Chronicles Draft Picks', 'National Treasures', 'Flawless Collegiate', 'Immaculate Collection',
  'Immaculate Collegiate', 'Bowman Chrome', 'Bowman Draft', 'Bowman University Chrome', 'Bowman University',
  'Topps Chrome Sapphire', 'Topps Chrome Update', 'Topps Chrome', 'Topps Finest', 'Topps Heritage',
  'Upper Deck Young Guns', 'Upper Deck Series One', 'Upper Deck Series Two', 'SP Authentic',
  'Donruss Optic', 'Donruss Elite', 'Clearly Donruss', 'Diamond Kings', 'Absolute Memorabilia',
  'Crown Royale', 'Court Kings', 'Rookies & Stars', 'Stadium Club Chrome', 'Stadium Club',
  'Resurgence', 'Prizm', 'Select', 'Mosaic', 'Contenders', 'Flawless', 'Immaculate', 'Impeccable',
  'Absolute', 'Phoenix', 'Origins', 'Chronicles', 'Illusions', 'Prestige', 'Obsidian', 'Revolution',
  'Spectra', 'Certified', 'Black Gold', 'Score', 'Optic', 'Donruss', 'Bowman', 'Finest', 'Heritage',
];
const releaseYear = /\b((?:19|20)\d{2})(?:\s*[-/]\s*(?:\d{4}|\d{2}))?\b/g;
const sportWords = /\b(?:baseball|basketball|football|hockey|soccer|trading cards?|NFL|MLB|NBA|NHL)\b/gi;
const copyright = /©|\(c\)|copyright|all rights reserved/i;
const copyrightOnly = /panini america,? inc|the topps company|upper deck company|manufactured by|produced by|used (?:by|with) permission/i;
const statLine = /\b(?:stats?|statistics|season totals?|college totals?|yards?|touchdowns?|attempts?|born|birth|drafted|career|jersey number|height|weight|passes?|receptions?)\b/i;
const labelledSet = /^(?:set(?: name)?|product(?: name)?|collection)\s*[:=]\s*(.{2,70})$/i;
const nameLabel = /^(?:player(?: name)?|athlete(?: name)?|name)\s*[:=]\s*(.{3,90})$/i;
const serialLabel = /^(?:serial(?: (?:no\.?|number))?|print(?:ed)? run|limited edition|numbered)\b\s*[:#=-]?\s*/i;
const gradeCompany = /\b(PSA|BGS|BECKETT(?: GRADING SERVICES)?|SGC|CGC|CSG|TAG|HGA|GMA|AGS|MNT|ARS)\b/i;
const gradeLabel = /(?:PRISTINE|GEM[ -]*(?:MINT|MT)|MINT(?:\s*\+)?|NM[ -]*(?:MINT|MT)|NEAR[ -]*MINT|EX[ -]*MT|EXCELLENT|VERY GOOD|GOOD|FAIR|POOR)/.source;
const gradeNumber = '(10(?:\\.0)?|[1-9](?:\\.[05])?)';
const autographText = /\b(?:certified auto(?:graph)?(?: issue)?|autographed|autograph(?:s|ed)?|(?:dual|triple|rookie|relic) signatures?|rookie auto|auto(?:graph)? grade|on[- ]card auto)\b/i;
const autographWord = /^(?:auto|signatures?|signed)(?:\s+\d+(?:\.\d)?)?$/i;
const fakeAuto = /\b(?:facsimile|pre[- ]?printed|replica signature|unsigned|no autograph|non[- ]auto|digital autograph|not (?:an? )?(?:actual )?autograph|without (?:an? )?autograph|autographs? (?:are|is) not guaranteed|simulated (?:signature|autograph))\b/i;
const relicText = /\b(?:relics?|(?:enclosed|authentic|worn|used) (?:authentic )?memorabilia|memorabilia (?:card|piece)|swatch(?:es)?|rookie patch|(?:game|player)[- ](?:used|worn) (?:material|jersey|patch)|jersey (?:card|swatch)|patch autograph|autographed patch)\b/i;
const excludedNames = new Set(('official league leagues trading sports sport action player players card cards rookie rookies season draft picks draftpick ' +
  'signature signatures signed signing autograph autographs authentic memorabilia relic relics game used series collection collector collectors edition ' +
  'insert premium topps panini upper deck donruss bowman fleer leaf resurgence prizm prime prestige optic select score chronicles contenders ' +
  'certified chromium chrome refractor mosaic patch silver blue green red gold purple black orange pink yellow white bronze emerald sapphire ' +
  'parallel numbered MVP RC NFL MLB NBA WNBA NHL AFC NFC NCAA all pro star football baseball basketball soccer hockey quarterback ' +
  'running back wide receiver rookie tight end defensive offensive tackle cornerback outfielder pitcher third baseman shooting guard center ' +
  'college university collegiate school state city copyright congratulations guaranteed enclosed jersey birth born height weight team club position ' +
  'first round pick statistics stats highlight highlights american national record career awards offense defense illustrated ltd made printed ' +
  'Kansas Missouri Las Vegas Los Angeles San Francisco Green Bay New York Tampa Miami Buffalo Dallas Arizona Detroit Atlanta Philadelphia ' +
  'Oakland Baltimore Chicago Houston Seattle Cleveland Denver Indianapolis Cincinnati Jacksonville Minnesota Tennessee Carolina Pittsburgh ' +
  'Washington Boston Milwaukee Memphis Portland Orlando Brooklyn Toronto Montreal Vancouver Calgary Ottawa New Orleans Oklahoma Salt Lake Golden ' +
  'chiefs raiders bills dolphins patriots jets ravens browns bengals steelers texans colts jaguars titans broncos chargers cowboys ' +
  'eagles giants commanders packers bears lions vikings falcons panthers saints buccaneers rams cardinals 49ers seahawks royals yankees ' +
  'dodgers cubs mets padres angels athletics redskins chiefs mariners nuggets lakers celtics warriors knicks red sox blue jays ' +
  'runningback tailback sophomore freshman senior junior edition foil foilboard holographic grade gem mint auto grade grading pack break ' +
  'season ticket paramount pairings neon initiates all star panini america upper deck made in').toLowerCase().split(/\s+/));
const particles = new Set(['de', 'del', 'la', 'le', 'van', 'von', 'da', 'dos', 'di', 'du', 'der']);
const nameSuffix = /^(?:Jr|Sr|II|III|IV|V)\.?$/i;

function neat(text) {
  return clean(text).split(' ').map(part => {
    if (nameSuffix.test(part)) return /^(?:jr|sr)/i.test(part) ? part[0].toUpperCase() + part[1].toLowerCase() + '.' : part.toUpperCase();
    if (/^(?:AJ|CJ|DK|DJ|JJ|JK|JD|JT|PJ|RJ|TJ)$/.test(part)) return part;
    if (part.includes('.') || (/[a-z]/.test(part) && /[A-Z]/.test(part))) return part;
    return part.toLowerCase().replace(/(^|[-'])\p{L}/gu, letter => letter.toUpperCase());
  }).join(' ');
}

function probableName(value, knownNames) {
  if (/^(?:no\.?(?:\s|$)|card\b|serial\b|grade\b|#|©)/i.test(value)) return null;
  const tokens = clean(value).split(' ');
  if (tokens.length < 2 || tokens.length > 5) return null;
  const familiar = knownNames.get(key(value));
  if (familiar) return familiar;
  const nameParts = tokens.filter(part => !particles.has(part.toLowerCase()) && !nameSuffix.test(part));
  if (nameParts.length < 2 || nameParts.length > 3) return null;
  if (!tokens.every(part => /^[\p{L}][\p{L}.'-]*$/u.test(part))) return null;
  const lastNameExceptions = /^(?:white|black|green|gray|gold|blue|senior|washington|houston|dallas)$/i;
  const firstNameExceptions = /^(?:junior|dallas|orlando)$/i;
  if (nameParts.some((part, i) => excludedNames.has(part.toLowerCase()) &&
      !(i === 0 && firstNameExceptions.test(part)) && !(i === nameParts.length - 1 && lastNameExceptions.test(part)))) return null;
  if (!nameParts.every(part => /^\p{Lu}/u.test(part))) return null;
  if (nameParts.every(part => part.replace(/\./g, '').length < 3)) return null;
  return neat(value);
}

function extractPlayer(front, back, knownCards) {
  const known = new Map(knownCards.filter(c => c?.player).map(c => [key(c.player), clean(c.player)]));
  const both = [...front, ...back];
  const explicit = both.map(l => nameLabel.exec(l.text)?.[1]).filter(Boolean);
  const oneName = text => {
    const caption = text.replace(/(?:\s*[•|]\s*|\s+-\s+|\s+)(?:QB|RB|WR|TE|CB|DB|LB|DE|DT|OL|OT|OG|DL|SS|FS|PG|SG|PF|SF|C|P|OF|INF|1B|2B|3B|LF|RF|CF)(?:\s*[•|].*)?$/i, '');
    return probableName(caption, known);
  };
  function joinedName(value) {
    const parts = value.split(/\s*(?:[&/]|\s+and\s+)\s*/i);
    const names = parts.map(oneName);
    return parts.length > 1 && names.every(Boolean) ? names.join(' / ') : null;
  }
  if (explicit.length) return unique(explicit.map(value => joinedName(value) || oneName(value)));
  const dual = unique(both.map(l => joinedName(l.text)));
  if (dual) return dual;
  if (both.some(l => /\b(?:dual (?:auto(?:graph)?s?|signatures?|relics?|players?)|triple signatures?|paramount pairings)\b/i.test(l.text))) return null;
  const candidates = side => {
    const names = [];
    for (const [i, line] of side.entries()) {
      const name = oneName(line.text);
      if (name) names.push(name);
      const next = side[i + 1];
      if (next?.index !== line.index + 1 || !/^\p{Lu}[\p{L}'-]+$/u.test(line.text) || !/^\p{Lu}[\p{L}'-]+$/u.test(next?.text || '')) continue;
      const joined = line.text + ' ' + next.text;
      // Split first/last names are common on the nameplate. An existing catalogue
      // spelling or two adjacent lines at the lower front edge supports joining them.
      if (known.has(key(joined)) || (side === front && line.y > .56 && next.y > line.y && next.y - line.y < .11)) {
        const split = oneName(joined);
        if (split) names.push(split);
      }
    }
    return names;
  };
  const f = candidates(front), b = candidates(back);
  const repeated = unique(f.filter(name => b.some(other => key(other) === key(name))));
  return repeated || unique([...f, ...b]);
}

function editionInfo(lines, knownCards) {
  const knownSets = knownCards.filter(c => c?.set_name).map(c => clean(c.set_name));
  const sets = [...new Set([...knownSets, ...products])].sort((a, b) => key(b).length - key(a).length);
  const found = [], years = [], labels = [], flagship = [];
  for (const line of lines) {
    const segment = clean(line.text.split(copyright)[0]);
    if (!segment || statLine.test(segment) || copyrightOnly.test(segment)) continue;
    const explicit = labelledSet.exec(segment);
    const title = explicit ? explicit[1] : segment;
    const labelledYear = /^(?:card\s+)?(?:year|season)\s*[:=]\s*((?:19|20)\d{2})(?:[-/]\d{2,4})?$/i.exec(segment);
    if (labelledYear) years.push(labelledYear[1]);
    const yr = [...title.matchAll(releaseYear)].map(m => m[1]);
    // A product imprint is short. A paragraph that mentions "Select" or "Score" in
    // passing, or the boilerplate "Certified Autograph Issue", is not a product.
    const stripped = clean(title.replace(releaseYear, ' ').replace(sportWords, ' ').replace(/^[\s-]+|[\s-]+$/g, ''));
    if (!stripped || /^(?:topps|bowman) certified$/i.test(stripped)) continue;
    const dropBrand = value => key(value).replace(/^(?:panini|topps|upper deck) /, '');
    if (yr.length === 1 && /^(?:topps|panini|upper deck|fleer|leaf)$/i.test(stripped)) {
      years.push(yr[0]);
      if (/^(?:topps|upper deck|fleer)$/i.test(stripped) && /\b(?:baseball|basketball|football|hockey)\b/i.test(title)) {
        flagship.push(neat(stripped));
      }
    }
    const matched = sets.find(set => key(stripped) === key(set) || dropBrand(stripped) === key(set) || key(stripped) === dropBrand(set));
    if (explicit) {
      if (!/^.{2,64}$/.test(stripped) || /[!?]/.test(stripped)) continue;
      labels.push(matched || neat(stripped));
    }
    if (!explicit && !matched) continue;
    if (matched) found.push(matched);
    if (yr.length === 1 && (matched || explicit)) years.push(yr[0]);
  }
  const setName = unique(labels) || unique(found.filter(short => !found.some(long => key(short) !== key(long) && whole(long, short)))) || (!found.length && unique(flagship));
  return { set_name: setName, year: unique(years) };
}

const parallelNames = /^(?:(?:red|blue|gold|green|orange|pink|black|purple|silver|platinum|white|yellow|bronze|teal)(?:\s+(?:wave|disco|shimmer|scope|laser|holo|ice|mosaic|foil|foilboard|(?:cracked )?ice|pulsar|prizm|refractor))|superfractor|x[- ]fractor|refractor|cracked ice|rainbow foil|holo silver)$/i;
function extractSerial(all) {
  const full = [], limits = [];
  for (const {text} of all) {
    const src = clean(text.replace(serialLabel, ''));
    const m = /^#?\s*(\d{1,5})\s*(?:\/|\bof\b)\s*(\d{1,5})$/i.exec(src);
    if (m && +m[1] > 0 && +m[1] <= +m[2] && !/^(?:19|20)\d\d$/.test(m[1])) {
      full.push(m[1] + '/' + m[2]);
      limits.push(String(+m[2]));
    } else if (serialLabel.test(text)) {
      const capped = /^(?:to\s*|\/\s*)?(\d{1,5})$/i.exec(src);
      if (capped && +capped[1] > 0) limits.push(String(+capped[1]));
    }
  }
  const limit = unique(limits);
  return limit && (full.length ? unique(full) : '/' + limit);
}

function extractCardNumber(front, back) {
  const code = '[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,8}){0,3}';
  const labelled = new RegExp('^(?:CARD\\s*(?:NO\\.?|NUMBER|#)|NO\\.?|NUMBER\\s*:)\\s*[:#.-]?\\s*(' + code + ')$', 'i');
  const prefixed = new RegExp('^#\\s*(' + code + ')$', 'i');
  const genericCode = /^(?=[A-Z0-9-]{3,16}$)[A-Z0-9]{1,6}-(?:[A-Z]{1,4}|\d{1,4})(?:-[A-Z0-9]{1,4})?$/;
  const ordinary = /^(?:ON-CARD|GAME-USED|GAME-WORN|ALL-STAR|ALL-PRO|NON-AUTO|PRE-ROOKIE|POST-SEASON|ROOKIE-CARD|PLAYER-WORN|NO-HITTER|ROOKIE-OF|PLAY-OFF|ONE-OF-ONE|NEAR-MINT|GEM-MT|NM-MT)$/i;
  const strong = [], other = [];
  for (const side of [front, back]) {
    for (const [i, line] of side.entries()) {
      if (statLine.test(line.text) || (i && /^(?:jersey(?: no\.?)?|uniform(?: no\.?)?|statistics|stats|grade|season|age|height|weight)\s*[:#]?$/i.test(side[i-1].text))) continue;
      const explicit = labelled.exec(line.text)?.[1];
      const hash = prefixed.exec(line.text)?.[1];
      if (explicit || (side === back && hash)) {
        const token = (explicit || hash).toUpperCase();
        if (!/^((?:19|20)\d{2}|\d{4,}-\d{2,4})$/.test(token) && !ordinary.test(token)) strong.push(token);
      } else if (side === back && genericCode.test(line.text) && /[A-Z]/.test(line.text) && !ordinary.test(line.text)) {
        other.push(line.text);
      } else if (side === back && /^\d{1,3}$/.test(line.text) && line.y !== null && line.y < .18 && i < 3 && !side.slice(0, 6).some(l => gradeCompany.test(l.text))) {
        other.push(line.text);
      }
    }
  }
  return unique(strong.length ? strong : other);
}

function extractGrades(front, back) {
  const candidates = [];
  for (const side of [front, back]) {
    for (const [index, line] of side.entries()) {
      const m = gradeCompany.exec(line.text);
      if (!m || line.text.length > 68) continue;
      const grader = m[1].toUpperCase().startsWith('BECKETT') ? 'BGS' : m[1].toUpperCase();
      const tail = line.text.slice(m.index + m[0].length).trim();
      const rx = new RegExp('^[:\\s-]*(?:' + gradeLabel + '[\\s:-]*)?' + gradeNumber + '(?=$|\\s)', 'i');
      let grade = rx.exec(tail)?.[1];
      if (grade && /\b(?:auto(?:graph)?|signature)(?:\s+grade)?\b/i.test(tail) && !/\b(?:auto(?:graph)?|signature)\s+(?:grade\s+)?\d/i.test(tail)) grade = null;
      if (!grade && (line.y === null || line.y <= .4)) {
        const nearby = [tail, ...side.slice(index + 1, index + 5).map(l => l.text)];
        if (!nearby.some(t => /\b(?:auto(?:graph)?|signature|DNA)\b/i.test(t))) {
          const desc = new RegExp('^' + gradeLabel + '[\\s:-]*' + gradeNumber + '$', 'i');
          const labelOnly = new RegExp('^' + gradeLabel + '$', 'i');
          const numberOnly = new RegExp('^' + gradeNumber + '$');
          grade = unique(nearby.map((t, i) => desc.exec(t)?.[1] ||
            (labelOnly.test(t) && numberOnly.exec(nearby[i + 1] || '')?.[1])));
        }
      }
      if (grade) candidates.push(grader + ' ' + String(Number(grade)));
    }
  }
  const one = unique(candidates);
  if (!one) return {};
  const [grader, grade] = one.split(' ');
  return {grader, grade};
}

/**
 * @param {{ front?: any, back?: any }} [readings]
 * @param {any[]} [knownCards]
 */
export function parseCardScan({front, back} = {}, knownCards = []) {
  const f = readLines(front), b = readLines(back);
  if (f.length && b.length) {
    const frontName = extractPlayer(f, [], knownCards);
    const backName = extractPlayer([], b, knownCards);
    const labelledPair = [...f, ...b].some(l => /\b(?:dual|triple|pairings)\b/i.test(l.text));
    if (frontName && backName && key(frontName) !== key(backName) && !labelledPair) return {};
  }
  const all = [...f, ...b];
  const text = all.map(l => l.text).join('\n');
  const parallel = unique(all.map(l => {
    const labelled = /^(?:parallel|variant|variation)\s*[:=]\s*([\p{L}][\p{L}\d '’&-]{1,49})$/iu.exec(l.text);
    return labelled ? neat(labelled[1]) : parallelNames.test(l.text) ? neat(l.text) : null;
  }));
  const suggestions = {
    player: extractPlayer(f, b, knownCards),
    ...editionInfo(all, knownCards),
    card_number: extractCardNumber(f, b),
    parallel,
    serial: extractSerial(all),
    is_auto: (autographText.test(text) || all.some(l => autographWord.test(l.text))) && !fakeAuto.test(text) && !/\b(?:autograph(?:ed)?|auto)\s*[:=]\s*(?:no|false)\b/i.test(text),
    is_relic: relicText.test(text) && !/\b(?:(?:no|without|not (?:a|an)|does not contain|facsimile|replica|picture of|image of) (?:a |an |any )?(?:(?:actual|authentic|real|worn) )?(?:relic|memorabilia|patch)|(?:relic|memorabilia)\s*[:=]\s*(?:no|false)|non[- ]relic)\b/i.test(text),
    ...extractGrades(f, b),
  };
  return Object.fromEntries(Object.entries(suggestions).filter(([, value]) => Boolean(value)));
}
