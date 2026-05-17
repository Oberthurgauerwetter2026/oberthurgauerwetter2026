import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin required");
}

export const revealServiceRoleKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);

    const url = process.env.SUPABASE_URL
      ?? process.env.VITE_SUPABASE_URL
      ?? "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

    // Diagnostics in server logs (key value never logged)
    console.log("[reveal-key] env present:", {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      keyLength: key.length,
    });

    return {
      supabaseUrl: url,
      serviceRoleKey: key,
      debug: {
        hasUrl: !!process.env.SUPABASE_URL,
        hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        keyLength: key.length,
      },
    };
  });
