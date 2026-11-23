import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim() ?? "";

function validConfiguration(): boolean {
  if (!supabaseUrl || !supabaseAnonKey || supabaseAnonKey.startsWith("sb_secret_")) return false;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return false;
    // Catch an accidentally supplied service-role JWT before creating a browser client.
    if (supabaseAnonKey.split(".").length === 3) {
      const payload = JSON.parse(atob(supabaseAnonKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
      if (payload.role === "service_role") return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const isConfigured = validConfiguration();
let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!isConfigured) throw new Error("Supabase is not configured.");
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "void.auth",
      },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}
