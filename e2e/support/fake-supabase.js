// An in-memory stand-in for the parts of Supabase the vault uses: password
// sign-in, the cards table, display cases, private RPCs and the card-images
// bucket. Browser tests route the project's URL here, so they run offline
// and never touch the real project.
import { SUPABASE_URL } from '../../config.js';

export const OWNER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.com',
  password: 'correct horse',
};
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const base64url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function accessToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 3600,
  };
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(claims)}.signature`;
}

export function seedCard(overrides = {}) {
  const id = overrides.id || crypto.randomUUID();
  return {
    id,
    created_at: new Date().toISOString(),
    player: 'Test Player',
    year: 2020,
    set_name: 'Prizm',
    card_number: '1',
    parallel: null,
    serial: null,
    is_auto: false,
    is_relic: false,
    grader: null,
    grade: null,
    notes: null,
    featured: false,
    image_path: `${OWNER.id}/${id}.jpg`,
    owner: OWNER.id,
    ...overrides,
  };
}

function matches(row, params) {
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns'].includes(key)) continue;
    const [op, ...rest] = raw.split('.');
    const value = rest.join('.');
    const actual = row[key] == null ? '' : String(row[key]);
    if (op === 'eq' && actual !== value) return false;
    if (op === 'gt' && !(actual > value)) return false;
    if (
      op === 'in' &&
      !value
        .replace(/^\(|\)$/g, '')
        .split(',')
        .includes(actual)
    )
      return false;
  }
  return true;
}

// storage-js sends Blobs as multipart form data with the file in an unnamed part.
function uploadedFile(request) {
  const body = request.postDataBuffer() || Buffer.alloc(0);
  const type = request.headers()['content-type'] || 'application/octet-stream';
  const boundary = /multipart\/form-data;\s*boundary=(.+)$/i.exec(type)?.[1];
  if (!boundary) return { body, type };
  const delimiter = Buffer.from('--' + boundary);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const headers = part.subarray(0, split).toString();
    if (/filename=|name=""/i.test(headers)) {
      const partType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] || 'application/octet-stream';
      return { body: Buffer.from(part.subarray(split + 4)), type: partType };
    }
    start = next;
  }
  return { body, type };
}

export async function installFakeSupabase(context, { cards = [], cases = [], photos = {} } = {}) {
  const state = {
    cards: cards.map(card => ({ ...card })),
    cases: cases.map(entry => ({ ...entry })),
    objects: new Map(Object.entries(photos)),
    requests: [],
  };
  for (const card of state.cards)
    if (!state.objects.has(card.image_path)) state.objects.set(card.image_path, { body: PNG_1X1, type: 'image/png' });

  const json = (route, status, body, headers = {}) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range', ...headers },
      body: body === undefined ? '' : JSON.stringify(body),
    });

  function signedIn(request) {
    const header = request.headers().authorization || '';
    const token = header.replace(/^Bearer /, '');
    try {
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub === OWNER.id;
    } catch {
      return false;
    }
  }

  async function auth(route, request, url) {
    const path = url.pathname.replace('/auth/v1/', '');
    if (path === 'token') {
      const body = request.postDataJSON() || {};
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password' && (body.email !== OWNER.email || body.password !== OWNER.password)) {
        return json(route, 400, {
          code: 'invalid_credentials',
          error_code: 'invalid_credentials',
          msg: 'Invalid login credentials',
        });
      }
      const user = {
        id: OWNER.id,
        email: OWNER.email,
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: {},
        user_metadata: {},
      };
      return json(route, 200, {
        access_token: accessToken(OWNER),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-token',
        user,
      });
    }
    if (path === 'user')
      return json(route, 200, { id: OWNER.id, email: OWNER.email, aud: 'authenticated', role: 'authenticated' });
    if (path === 'logout') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    return json(route, 200, {});
  }

  async function rpc(route, request, name) {
    if (name === 'vault_read_display_case') {
      const { p_case_id: id } = request.postDataJSON();
      const entry = state.cases.find(item => item.id === id && !item.retired);
      if (!entry) return json(route, 200, null);
      const byId = new Map(state.cards.map(card => [card.id, card]));
      const shown = entry.card_ids.map(cardId => byId.get(cardId)).filter(Boolean);
      return json(route, 200, {
        title: entry.title,
        cards: shown.map(
          ({ notes: _notes, owner: _owner, created_at: _created, featured: _featured, ...card }) => card,
        ),
      });
    }
    if (!signedIn(request)) return json(route, 401, { code: '42501', message: 'permission denied' });
    if (name === 'vault_purchases_read') return json(route, 200, {});
    // Unknown functions behave like an installation that has not run the optional SQL.
    return json(route, 404, {
      code: 'PGRST202',
      message: `Could not find the function public.${name} in the schema cache`,
    });
  }

  async function rest(route, request, url) {
    const table = url.pathname.replace('/rest/v1/', '');
    if (table.startsWith('rpc/')) return rpc(route, request, table.slice(4));
    const params = [...url.searchParams.entries()];
    const single = (request.headers().accept || '').includes('vnd.pgrst.object');
    const method = request.method();
    if (table === 'vault_card_purchases' || table === 'vault_display_cases') {
      if (table === 'vault_display_cases' && method === 'GET')
        return json(
          route,
          200,
          state.cases.filter(c => !c.retired),
        );
      return json(route, 200, single ? null : []);
    }
    if (table !== 'cards')
      return json(route, 404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'` });

    const respond = rows => {
      if (!single) return json(route, 200, rows);
      if (rows.length !== 1)
        return json(route, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
      return json(route, 200, rows[0]);
    };

    if (method === 'GET' || method === 'HEAD') {
      let rows = state.cards.filter(row => matches(row, params)).sort((a, b) => a.id.localeCompare(b.id));
      const total = rows.length;
      const limit = Number(url.searchParams.get('limit')) || rows.length;
      rows = rows.slice(0, limit);
      const range = `0-${Math.max(0, rows.length - 1)}/${total}`;
      if (single) return respond(rows);
      return json(route, 200, rows, { 'Content-Range': range });
    }
    if (!signedIn(request))
      return json(route, 401, { code: '42501', message: 'new row violates row-level security policy' });
    if (method === 'POST') {
      const body = request.postDataJSON();
      const inserted = (Array.isArray(body) ? body : [body]).map(row => ({
        created_at: new Date().toISOString(),
        featured: false,
        is_auto: false,
        is_relic: false,
        ...row,
        id: row.id || crypto.randomUUID(),
      }));
      if (inserted.some(row => state.cards.some(card => card.id === row.id)))
        return json(route, 409, { code: '23505', message: 'duplicate key' });
      state.cards.push(...inserted);
      return respond(inserted);
    }
    if (method === 'PATCH') {
      const changes = request.postDataJSON();
      const rows = state.cards.filter(row => matches(row, params) && row.owner === OWNER.id);
      rows.forEach(row => Object.assign(row, changes));
      return respond(rows);
    }
    if (method === 'DELETE') {
      const rows = state.cards.filter(row => matches(row, params) && row.owner === OWNER.id);
      state.cards = state.cards.filter(row => !rows.includes(row));
      return respond(rows);
    }
    return json(route, 405, { message: 'Method not allowed' });
  }

  async function storage(route, request, url) {
    const path = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''));
    const method = request.method();
    if (path.startsWith('public/card-images/') || (method === 'GET' && path.startsWith('card-images/'))) {
      const key = path.replace(/^(public\/)?card-images\//, '');
      const object = state.objects.get(key);
      if (!object) return json(route, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      return route.fulfill({
        status: 200,
        contentType: object.type,
        body: object.body,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (!signedIn(request))
      return json(route, 403, {
        statusCode: '403',
        error: 'Unauthorized',
        message: 'new row violates row-level security policy',
      });
    if (method === 'DELETE' && path === 'card-images') {
      const { prefixes = [] } = request.postDataJSON() || {};
      const removed = prefixes.filter(key => state.objects.delete(key));
      return json(
        route,
        200,
        removed.map(name => ({ name })),
      );
    }
    if (method === 'POST' || method === 'PUT') {
      const key = path.replace(/^card-images\//, '');
      if (!key.startsWith(OWNER.id + '/'))
        return json(route, 403, { statusCode: '403', error: 'Unauthorized', message: 'row-level security' });
      const upsert = request.headers()['x-upsert'] === 'true';
      if (state.objects.has(key) && !upsert)
        return json(route, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      state.objects.set(key, uploadedFile(request));
      return json(route, 200, { Key: `card-images/${key}`, Id: crypto.randomUUID() });
    }
    return json(route, 404, { message: 'Not found' });
  }

  await context.route(`${SUPABASE_URL}/**`, async (route, request) => {
    const url = new URL(request.url());
    state.requests.push(`${request.method()} ${url.pathname}${url.search}`);
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
        },
      });
    }
    if (url.pathname.startsWith('/auth/v1/')) return auth(route, request, url);
    if (url.pathname.startsWith('/rest/v1/')) return rest(route, request, url);
    if (url.pathname.startsWith('/storage/v1/')) return storage(route, request, url);
    return json(route, 404, { message: 'Not found' });
  });
  // Sold-comp lookups are covered by unit tests; keep browser tests offline.
  await context.route('https://cardpricer.co/**', route => route.fulfill({ status: 503, body: '' }));
  return state;
}
