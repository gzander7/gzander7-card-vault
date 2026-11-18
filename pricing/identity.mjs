// Compare only sold listings that identify the same card. An unknown variation is
// safer to leave unpriced than to silently include in the collector's total.
const fields = value => String(value ?? '').trim();
const normalize = value => fields(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const words = value => normalize(value).split(' ').filter(Boolean);
const cardNumber = value => normalize(value).replace(/^no\s+|^number\s+/, '').replace(/ /g, '');
const escapeRE = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const graderName = value => {
  const name = normalize(value);
  if (name === 'beckett' || name === 'beckett grading services') return 'BGS';
  return name.toUpperCase();
};

function printRun(serial) {
  const value = fields(serial);
  if (!value) return null;
  const match = /^#?\s*(?:(\d+)\s*)?(?:\/|of\s+)\s*(\d+)$/i.exec(value);
  const statedLimit = /^numbered\s+to\s+(\d+)$/i.exec(value);
  if (!match && !statedLimit) return null;
  const limit = Number(match?.[2] ?? statedLimit[1]);
  if (!Number.isSafeInteger(limit) || limit < 1) return null;
  if (match?.[1] && (Number(match[1]) < 1 || Number(match[1]) > limit)) return null;
  return limit;
}

const gradeValue = value => {
  const s = fields(value);
  return /^\d{1,2}(?:\.(?:0|5))?$/.test(s) && Number(s) >= 1 && Number(s) <= 10 ? String(Number(s)) : null;
};

export function needsDetails(card) {
  if (!words(card?.player).length || !/^\d{4}$/.test(fields(card?.year)) || !words(card?.set_name).length || !cardNumber(card?.card_number)) {
    return 'Add the player, four-digit year, set and card number to find comparable sales.';
  }
  if (Boolean(fields(card.grader)) !== Boolean(fields(card.grade))) return 'Enter both the grading company and the card grade, or leave both empty for a raw card.';
  if (fields(card.grade) && !gradeValue(card.grade)) return 'Enter the numeric card grade (1–10). An autograph grade alone cannot establish a card value.';
  if (fields(card.grader) && !/^(PSA|BGS|CGC|SGC|TAG|ACE|AGS|HGA|GMA|MNT|ARS)$/.test(graderName(card.grader))) return 'This grading company has no supported matching grade. Check the company shown on the slab.';
  if (fields(card.serial) && !printRun(card.serial)) return 'Include the print run in the serial, for example 82/100 or /100.';
  return null;
}

export function identityKey(card) {
  return JSON.stringify([
    normalize(card.player), fields(card.year), normalize(card.set_name), cardNumber(card.card_number),
    normalize(card.parallel), printRun(card.serial) ?? normalize(card.serial),
    graderName(card.grader), gradeValue(card.grade) ?? normalize(card.grade),
    Boolean(card.is_auto), Boolean(card.is_relic)
  ]);
}

const hasPhrase = (title, phrase) => (' ' + title + ' ').includes(' ' + phrase + ' ');
const autograph = /\b(?:auto|autos|autograph(?:s|ed)?|signed|signature(?:s)?|rpa)\b/;
const relic = /\b(?:patch(?:es)?|jersey|relic(?:s)?|memorabilia|swatch(?:es)?|rpa)\b/;
const unsafeTitle = /\b(?:lot|bundle|repack|mystery|sealed|reprint|rp|facsimile|replica|custom|digital|proxy|fake|proof|novelty|damaged|creased|crease|trimmed|altered|restored|redemption|authentic\s+altered|non\s+auto|no\s+auto|not\s+auto|auto\s+grade|autograph\s+grade|psa\s+dna|contender\s+for|you\s+pick|pick\s+your|complete\s+set|case\s+break|pack\s+fresh\s+lot|in\s+person|ip\s+auto|ttm)\b/;
const listingWords = new Set(('a an the and of by from card cards trading sports sport baseball basketball football hockey soccer ' +
  'nfl nba mlb nhl wnba ncaa qb rb wr te db lb panini topps fleer donruss rookie rookies rc base ungraded raw no number ' +
  'nm mt mint near on sticker hard hand autograph autographed autographs auto autos signature signatures signed ' +
  'patch patches jersey relic relics memorabilia swatch swatches rpa game used player worn material materials ' +
  'gem mint authentic graded bgs psa cgc sgc tag ace ags hga gma mnt ars beckett').split(/\s+/));
// Team identifiers that contain color words must be removed as phrases, not as
// individual color names: a Blue Jays listing can still be a blue parallel.
const nflTeams = ('arizona cardinals|atlanta falcons|baltimore ravens|buffalo bills|carolina panthers|chicago bears|cincinnati bengals|' +
  'cleveland browns|dallas cowboys|denver broncos|detroit lions|green bay packers|houston texans|indianapolis colts|jacksonville jaguars|' +
  'kansas city chiefs|las vegas raiders|los angeles chargers|los angeles rams|miami dolphins|minnesota vikings|new england patriots|' +
  'new orleans saints|new york giants|new york jets|philadelphia eagles|pittsburgh steelers|san francisco 49ers|seattle seahawks|' +
  'tampa bay buccaneers|tennessee titans|washington commanders').split('|');
const teamPhrases = [...nflTeams, 'blue jays', 'red sox', 'white sox', 'red wings', 'golden state warriors', 'trail blazers', 'golden knights',
  'maple leafs', 'blue jackets', 'blue devils', 'crimson tide'];
const teamNouns = new Set(nflTeams.map(name => name.split(' ').at(-1)).concat(
  ('hawks celtics nets hornets bulls cavaliers mavericks nuggets pistons warriors rockets pacers clippers lakers grizzlies heat bucks ' +
   'timberwolves pelicans knicks thunder magic 76ers suns blazers kings spurs jazz wizards orioles yankees rays twins guardians tigers ' +
   'royals astros angels athletics mariners rangers braves marlins mets phillies nationals cubs brewers pirates reds diamondbacks ' +
   'rockies dodgers padres ducks bruins sabres flames hurricanes blackhawks avalanche stars oilers wild canadiens predators islanders ' +
   'senators flyers penguins sharks kraken lightning canucks capitals jets mammoth').split(' ')
));
const cities = ('arizona|atlanta|baltimore|boston|brooklyn|buffalo|carolina|charlotte|chicago|cincinnati|cleveland|colorado|columbus|dallas|' +
  'denver|detroit|houston|indiana|indianapolis|jacksonville|kansas city|las vegas|los angeles|memphis|miami|milwaukee|minnesota|montreal|' +
  'nashville|new jersey|new orleans|new york|oklahoma city|orlando|ottawa|philadelphia|phoenix|pittsburgh|portland|sacramento|san antonio|' +
  'san diego|san francisco|san jose|seattle|st louis|tampa bay|tennessee|texas|toronto|utah|vancouver|vegas|washington|winnipeg').split('|');
const gradeClaim = /\b(psa|bgs|beckett|sgc|cgc|tag|ace|ags|hga|gma|mnt|ars)\s*(?:(?:gem\s+mint|mint|nm\s+mt|near\s+mint|pristine)\s*)?(10|[1-9](?:\.5)?)(?![\d.])/gi;
const gradingLanguage = /\b(?:psa|bgs|beckett|cgc|sgc|graded|slabbed|slab|grading|pristine|black label|authentic only)\b|\b(?:psa|bgs|cgc|sgc|tag)\d/i;
function gradeMatches(card, row, full) {
  const labels = fields(row.grade);
  const typedGrader = graderName(row.grader);
  const cleanGrade = gradeValue(labels);
  const targetGrader = graderName(card.grader);
  if (!targetGrader) {
    return !typedGrader && (!labels || /^(raw|ungraded|not graded)$/i.test(labels))
      && !gradingLanguage.test(full) && !Array.from(full.matchAll(gradeClaim)).length;
  }
  const expectedGrade = gradeValue(card.grade);
  if (typedGrader && typedGrader !== targetGrader) return false;
  if (/\b(?:raw|ungraded|not graded)\b/i.test(full + ' ' + labels)) return false;
  if (cleanGrade && (!expectedGrade || cleanGrade !== expectedGrade)) return false;
  const claims = Array.from((labels + ' ' + full).matchAll(gradeClaim), m => [graderName(m[1]), gradeValue(m[2])]);
  if (typedGrader && cleanGrade) claims.push([typedGrader, cleanGrade]);
  return claims.length > 0 && claims.every(([g, score]) => g === targetGrader && score === expectedGrade);
}

// The caller has already resolved a unique catalogue identity. Inspect the sale
// title independently: its reported card/grade can still disagree with the card.
export function matchesSale(card, row) {
  if (!card || !row || needsDetails(card)) return false;
  const full = fields(row.title);
  const title = normalize(full);
  if (!title || unsafeTitle.test(title) || !gradeMatches(card, row, full)) return false;
  const label = normalize(fields(row.grade) + ' ' + title);
  if (/\b(?:black label|pristine|perfect|qualifier|off center|auto(?:graph)? (?:grade )?10)\b/.test(label)) return false;
  const player = normalize(card.player);
  const set = normalize(card.set_name);
  const parallel = normalize(card.parallel);
  if (!hasPhrase(title, player) || !words(set).every(w => hasPhrase(title, w)) || !hasPhrase(title, fields(card.year))) return false;
  // “Blue” inside “Toronto Blue Jays”, the player name, or the set name is
  // insufficient evidence of a Blue parallel. Require a separate designation.
  let variantEvidence = ' ' + title + ' ';
  for (const phrase of [...teamPhrases, player, set]) variantEvidence = variantEvidence.replaceAll(' ' + phrase + ' ', ' ');
  const variantWords = words(parallel).filter(w => !words(set).includes(w));
  if (parallel && parallel !== 'base' && (!variantWords.length || !variantWords.every(w => hasPhrase(variantEvidence.trim(), w)))) return false;
  if (row.year && String(row.year) !== fields(card.year)) return false;
  if (autograph.test(title) !== Boolean(card.is_auto) || relic.test(title) !== Boolean(card.is_relic)) return false;

  const number = cardNumber(card.card_number);
  const components = fields(card.card_number).replace(/^\s*(?:#|no\.?\s+|number\s+)/i, '').match(/[a-z]+|\d+/gi) || [];
  const numberPattern = components.map(escapeRE).join('[\\s.\\-/]*');
  if (!numberPattern) return false;
  const tagged = new RegExp('(?:#|\\b(?:no\\.?|number|card)\\s+)\\s*' + numberPattern + '(?![a-z0-9/])', 'i');
  const standalone = new RegExp('(?<![a-z0-9/])' + numberPattern + '(?![a-z0-9/])', 'i');
  if (row.cardNumber && cardNumber(row.cardNumber) !== number) return false;
  const serialPattern = /(?:\d+\s*)?\/\s*\d+|\b\d+\s+of\s+\d+\b/gi;
  const bareEvidence = full.replace(gradeClaim, ' ').replace(serialPattern, ' ').replace(/\b(?:18|19|20)\d{2}\b/g, ' ');
  if (!tagged.test(full) && !(standalone.test(bareEvidence) && (row.cardNumber || /[a-z]/i.test(number)))) return false;

  const expectedRun = printRun(card.serial);
  const withoutNumber = tagged.test(full) ? full.replace(tagged, ' ') : full.replace(standalone, ' ');
  const textRuns = Array.from(withoutNumber.matchAll(/(?:\d+\s*)?\/\s*(\d+)\b|\b\d+\s+of\s+(\d+)\b/gi), m => Number(m[1] || m[2]));
  if ((row.printRun != null && Number(row.printRun) !== expectedRun) ||
      textRuns.some(n => n !== expectedRun) ||
      (expectedRun !== null && Number(row.printRun) !== expectedRun && !textRuns.includes(expectedRun))) return false;
  const unnumberedTitle = withoutNumber.replace(gradeClaim, ' ').replace(serialPattern, ' ');
  let residual = ' ' + normalize(unnumberedTitle) + ' ';
  for (const phrase of teamPhrases) residual = residual.replaceAll(' ' + phrase + ' ', ' ');
  residual = residual.replaceAll(' certified autograph issue ', ' ').replaceAll(' certified autograph ', ' ');
  // City names are neutral only when the listing actually names a sports team.
  if (words(residual).some(word => teamNouns.has(word)) || teamPhrases.some(team => hasPhrase(title, team))) {
    for (const city of cities) residual = residual.replaceAll(' ' + city + ' ', ' ');
  }
  const allowed = new Set([...words(player), ...words(set), ...words(parallel), fields(card.year)]);
  return words(residual).every(w => allowed.has(w) || listingWords.has(w) || teamNouns.has(w));
}
