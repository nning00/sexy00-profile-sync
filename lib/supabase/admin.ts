import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSchema } from "@/lib/site-instance";

let adminClient: SupabaseClient | undefined;

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service role environment variables are not configured.");
  }

  adminClient ??= createClient(url, serviceRoleKey, {
    db: { schema: supabaseSchema },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient;
}
