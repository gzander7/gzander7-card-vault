// Searches only an authenticated owner's saved card. The provider key, cached
// receipts and service-role RPCs stay on the server.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cachedEbaySales } from '../_shared/ebay-cache.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Cache-Control': 'no-store',
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
const fields = 'id,player,year,set_name,card_number,parallel,serial,grader,grade,is_auto,is_relic';
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!token) return json({ error: 'Sign in to look up sold cards.' }, 401);
  const {
    data: { user },
    error: authError,
  } = await service.auth.getUser(token);
  if (authError || !user) return json({ error: 'Sign in to look up sold cards.' }, 401);
  const body = await request.json().catch(() => null);
  if (typeof body?.cardId !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(body.cardId))
    return json({ error: 'A saved card ID is required.' }, 400);
  const { data: card, error } = await service
    .from('cards')
    .select(fields)
    .eq('id', body.cardId)
    .eq('owner', user.id)
    .maybeSingle();
  if (error) return json({ error: 'The card could not be read.' }, 503);
  if (!card) return json({ error: 'Card not found.' }, 404);
  try {
    return json(await cachedEbaySales(service, card, { key: Deno.env.get('COMPSAPI_KEY') }));
  } catch {
    return json({ error: 'The sold search could not be completed.' }, 503);
  }
});
