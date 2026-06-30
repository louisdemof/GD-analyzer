// Supabase Edge Function: admin-users
// Create / update auth users from the GD Analyzer admin panel.
// SECURITY: uses the service_role key (server-side only). Only callers that pass the
// is_super_admin() check (via their own JWT) are allowed. Deploy with:
//   supabase functions deploy admin-users
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role key>
// (SUPABASE_URL is provided automatically by the platform.)
//
// New users are restricted to @helexia.eu, matching the signup policy.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'missing authorization' }, 401);

  // 1) Authorize: run is_super_admin() AS THE CALLER (their JWT).
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: isSuper, error: authErr } = await asCaller.rpc('is_super_admin');
  if (authErr || isSuper !== true) return json({ error: 'forbidden — super-admin only' }, 403);

  // 2) Act with service_role.
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let payload: { action?: string; id?: string; email?: string; password?: string; full_name?: string };
  try { payload = await req.json(); } catch { return json({ error: 'invalid body' }, 400); }
  const { action } = payload;

  try {
    if (action === 'create') {
      const email = (payload.email ?? '').trim().toLowerCase();
      if (!/@helexia\.eu$/.test(email)) return json({ error: 'e-mail deve ser @helexia.eu' }, 400);
      if (!payload.password || payload.password.length < 8) return json({ error: 'senha mínima de 8 caracteres' }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password: payload.password, email_confirm: true,
        user_metadata: { full_name: payload.full_name ?? '' },
      });
      if (error) return json({ error: error.message }, 400);
      // Mirror name into profiles (best-effort).
      if (data.user) await admin.from('profiles').upsert({ id: data.user.id, email, full_name: payload.full_name ?? null });
      return json({ ok: true, id: data.user?.id });
    }

    if (action === 'update') {
      const id = payload.id;
      if (!id) return json({ error: 'id obrigatório' }, 400);
      const attrs: Record<string, unknown> = {};
      if (payload.password) {
        if (payload.password.length < 8) return json({ error: 'senha mínima de 8 caracteres' }, 400);
        attrs.password = payload.password;
      }
      if (payload.email) attrs.email = payload.email.trim().toLowerCase();
      if (payload.full_name !== undefined) attrs.user_metadata = { full_name: payload.full_name };
      if (Object.keys(attrs).length) {
        const { error } = await admin.auth.admin.updateUserById(id, attrs);
        if (error) return json({ error: error.message }, 400);
      }
      if (payload.full_name !== undefined || payload.email) {
        const up: Record<string, unknown> = { id };
        if (payload.full_name !== undefined) up.full_name = payload.full_name;
        if (payload.email) up.email = payload.email.trim().toLowerCase();
        await admin.from('profiles').upsert(up);
      }
      return json({ ok: true });
    }

    return json({ error: 'ação desconhecida' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'erro' }, 500);
  }
});
