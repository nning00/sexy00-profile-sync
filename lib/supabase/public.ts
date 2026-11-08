import { createClient } from "@supabase/supabase-js";
import { supabaseSchema } from "@/lib/site-instance";
import { measurePublicFetch } from "@/lib/request-performance";

function buildPublicClient(url: string, publishableKey: string) {
  return createClient(url, publishableKey, {
    db: { schema: supabaseSchema },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: measurePublicFetch },
  });
}

let publicClient: ReturnType<typeof buildPublicClient> | undefined;

export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase public environment variables are not configured.");
  }

  publicClient ??= buildPublicClient(url, publishableKey);
  return publicClient;
}
