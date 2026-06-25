import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase is OPTIONAL: when the env vars are absent the app keeps working in
// pure local (IndexedDB) mode — preserving the offline-first behaviour. The sync
// layer and auth gate check `isCloudEnabled` and no-op when it's false.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isCloudEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isCloudEnabled
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
