import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client with the service role key.
 * This bypasses RLS and should ONLY be used in trusted server-side code.
 *
 * Required env var: SUPABASE_SERVICE_ROLE_KEY
 * Find it in: Supabase Dashboard → Settings → API → service_role secret
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local — " +
        "find it in Supabase Dashboard → Settings → API → service_role secret."
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
