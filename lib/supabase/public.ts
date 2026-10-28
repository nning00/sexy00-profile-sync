import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSchema } from "@/lib/site-instance";

let publicClient: SupabaseClient | undefined;

export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase public environment variables are not configured.");
  }

  publicClient ??= createClient(url, publishableKey, {
    db: { schema: supabaseSchema },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return publicClient;
}
