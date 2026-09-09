/**
 * Hard-delete everything belonging to the caller (T-003 deliverable 7, AC-3.8).
 *
 * Runs as an edge function because it needs the service-role key, and that key
 * must never be in the app. The app can only ask "delete me"; it cannot name
 * anyone else, because the id comes from the caller's verified JWT, not from the
 * request body.
 *
 * Idempotent by construction: it deletes by user id, and deleting nothing is a
 * success. Spec §11 requires hard delete within 72 h; this is immediate.
 *
 * Secrets come from the function environment, never from the repo.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'missing authorization' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    return json({ error: 'function is not configured' }, 500);
  }

  // Identify the caller with THEIR token, under RLS. The service-role client
  // below is used only after the id is established this way, so a caller can
  // never cause anyone else's rows to be deleted.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData.user) {
    return json({ error: 'invalid session' }, 401);
  }
  const userId = userData.user.id;

  const admin = createClient(url, serviceKey);

  // Order matters only for clarity; every table cascades from users anyway.
  const tables = ['daily_states', 'commitments', 'push_tokens'] as const;
  const deleted: Record<string, string> = {};

  // daily_states has no user_id (spec §7), so it is deleted through the
  // commitments that own it.
  const { data: commitments, error: cErr } = await admin
    .from('commitments')
    .select('id')
    .eq('user_id', userId);
  if (cErr) return json({ error: cErr.message }, 500);

  const commitmentIds = (commitments ?? []).map((c: { id: number }) => c.id);
  if (commitmentIds.length > 0) {
    const { error } = await admin
      .from('daily_states')
      .delete()
      .in('commitment_id', commitmentIds);
    if (error) return json({ error: error.message }, 500);
  }
  deleted.daily_states = 'ok';

  for (const table of tables.filter((t) => t !== 'daily_states')) {
    const { error } = await admin.from(table).delete().eq('user_id', userId);
    if (error) return json({ error: error.message }, 500);
    deleted[table] = 'ok';
  }

  const { error: rowErr } = await admin.from('users').delete().eq('id', userId);
  if (rowErr) return json({ error: rowErr.message }, 500);
  deleted.users = 'ok';

  // Last, because it invalidates the token that got us here.
  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr && !/not found/i.test(authErr.message)) {
    return json({ error: authErr.message }, 500);
  }
  deleted.auth = 'ok';

  return json({ deleted, idempotent: true }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
