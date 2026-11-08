"use server";

/** Accounts per wallet: list, create, update, balances. */

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import type { AccountType } from "@/lib/account-types";
import { accountTypeLabel } from "@/lib/account-types";

const VALID_ACCOUNT_TYPES = [
  "bank_account",
  "cash",
  "credit_card",
  "savings",
  "investments",
] as const;

export async function createAccount(params: {
  wallet_id: string;
  name: string;
  account_type: AccountType;
  initial_balance: number;
  plafond?: number | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  if (
    !params.account_type ||
    !VALID_ACCOUNT_TYPES.includes(params.account_type as (typeof VALID_ACCOUNT_TYPES)[number])
  ) {
    return { error: "Account type is required" };
  }

  const insertData: Record<string, unknown> = {
    wallet_id: params.wallet_id,
    name: params.name,
    account_type: params.account_type,
    initial_balance: params.initial_balance,
    current_balance: params.initial_balance,
    created_by: user.id,
    is_active: true,
  };
  if (params.account_type === "credit_card" && params.plafond != null) {
    insertData.plafond = params.plafond;
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert(insertData)
    .select("id")
    .single();

  if (error) return { error: error.message };
  await logActivity(supabase, {
    action: "account_create",
    entity_type: "account",
    entity_id: data?.id ?? undefined,
    wallet_id: params.wallet_id,
    payload: {
      name: params.name,
      account_type: params.account_type,
      initial_balance: params.initial_balance,
      plafond: params.plafond ?? null,
    },
  });
  return {};
}

export async function updateAccount(
  id: string,
  params: {
    name?: string;
    account_type?: AccountType;
    initial_balance?: number;
    is_active?: boolean;
    plafond?: number | null;
  }
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { data: existing } = await supabase
    .from("accounts")
    .select("wallet_id, name, account_type, initial_balance, current_balance, plafond")
    .eq("id", id)
    .single();
  if (!existing) return { error: "Account not found" };

  const updates: Record<string, unknown> = {};
  const payload: Record<string, { old?: unknown; new: unknown }> = {};

  if (params.name !== undefined) {
    updates.name = params.name;
    payload.name = { old: existing.name, new: params.name };
  }
  if (params.account_type !== undefined) {
    if (!VALID_ACCOUNT_TYPES.includes(params.account_type as (typeof VALID_ACCOUNT_TYPES)[number])) {
      return { error: "Invalid account type" };
    }
    updates.account_type = params.account_type;
    payload.account_type = { old: existing.account_type, new: params.account_type };
  }
  if (params.is_active !== undefined) {
    updates.is_active = params.is_active;
    payload.is_active = { new: params.is_active };
  }
  if (params.initial_balance !== undefined) {
    const oldInit = Number(existing.initial_balance);
    const newInit = params.initial_balance;
    const delta = newInit - oldInit;
    updates.initial_balance = newInit;
    updates.current_balance = Number(existing.current_balance) + delta;
    payload.initial_balance = { old: oldInit, new: newInit };
  }
  if (params.plafond !== undefined) {
    const effectiveType = params.account_type ?? existing.account_type;
    if (effectiveType === "credit_card") {
      updates.plafond = params.plafond;
      payload.plafond = { old: existing.plafond, new: params.plafond };
    } else {
      // Clear plafond if switching away from credit_card
      updates.plafond = null;
    }
  }

  if (Object.keys(updates).length === 0) return {};

  const { error: err } = await supabase.from("accounts").update(updates).eq("id", id);
  if (err) return { error: err.message };

  await logActivity(supabase, {
    action: "account_edit",
    entity_type: "account",
    entity_id: id,
    wallet_id: existing.wallet_id,
    payload: { changes: payload },
  });
  return {};
}

export type AccountDetails = {
  ownerName: string;
  ownerAvatar: string | null;
  createdAt: string;
  initialBalance: number;
  isActive: boolean;
  updatedAt: string;
  accountType: string;
  plafond: number | null;
};

/**
 * Fetch account details: owner, created_at, initial balance, plafond, status, last update.
 */
export async function getAccountDetails(
  accountId: string
): Promise<{ details?: AccountDetails; error?: string }> {
  const supabase = await createClient();

  const { data: acct, error: aErr } = await supabase
    .from("accounts")
    .select("created_by, created_at, updated_at, initial_balance, is_active, account_type, plafond")
    .eq("id", accountId)
    .single();
  if (aErr || !acct) return { error: aErr?.message ?? "Account not found" };

  // Fetch owner profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, avatar_url")
    .eq("id", acct.created_by)
    .single();

  const ownerName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "—";

  return {
    details: {
      ownerName,
      ownerAvatar: profile?.avatar_url ?? null,
      createdAt: acct.created_at,
      initialBalance: Number(acct.initial_balance),
      isActive: acct.is_active,
      updatedAt: acct.updated_at,
      accountType: accountTypeLabel((acct.account_type ?? "bank_account") as AccountType),
      plafond: acct.plafond != null ? Number(acct.plafond) : null,
    },
  };
}
