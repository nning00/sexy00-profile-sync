import { createBrowserClient } from "@supabase/ssr";
import { supabaseSchema } from "@/lib/site-instance";

// NEXT_PUBLIC_* values are normally injected while the client bundle is built.
// Sites runtime secrets are intentionally not exposed to that build step, so keep
// this site's publishable (RLS-protected) browser configuration as a safe fallback.
// Supabase publishable keys are designed to be present in browser JavaScript.
const browserSupabaseUrl = "https://kkxsclcqdxoiqucunpur.supabase.co";
const browserSupabasePublishableKey = "sb_publishable_aHQ5I2VycjAYW5Wr-HImwQ_55PaWn9K";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || browserSupabaseUrl;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || browserSupabasePublishableKey;

  if (!url || !publishableKey) {
    throw new Error("Supabase browser environment variables are not configured.");
  }

  return createBrowserClient(url, publishableKey, { db: { schema: supabaseSchema } });
}
