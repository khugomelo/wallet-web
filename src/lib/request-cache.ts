import { cache } from "react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getOrEnsureProfile } from "@/app/actions/profiles";
import type { Wallet } from "@/lib/types";

/** Layout and i18n both need the profile; read it once per request. */
export const getProfileForRequest = cache(async (userId: string) =>
  getOrEnsureProfile(userId, (await getAuthUser())?.user_metadata as { first_name?: string | null; last_name?: string | null } | undefined)
);

/** Active wallets, read once per request (layout + page both need them). */
export const getActiveWallets = cache(async (): Promise<Wallet[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wallets")
    .select("*")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name");
  return (data ?? []) as Wallet[];
});
