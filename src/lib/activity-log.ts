import { getAuthUser } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LogPayload = {
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  wallet_id?: string | null;
  payload?: Record<string, unknown> | null;
};

/**
 * Inserts an activity log row. Call from server (Server Action or API route)
 * with the Supabase client that has the current user's session.
 * user_id is set from auth.getUser() at call time.
 */
export async function logActivity(
  supabase: SupabaseClient,
  args: LogPayload
): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;

  await supabase.from("activity_log").insert({
    user_id: user.id,
    wallet_id: args.wallet_id ?? null,
    action: args.action,
    entity_type: args.entity_type ?? null,
    entity_id: args.entity_id ?? null,
    payload: args.payload ?? null,
  });
}
