"use server";

/** Per-user UI preferences (e.g. account ordering) stored in Supabase. */

import { createClient, getAuthUser } from "@/lib/supabase/server";

const ACCOUNT_ORDER_KEY = "account_order";
const SETTLEMENTS_ORDER_KEY = "settlements_order";
const SETTLEMENTS_DISPLAY_KEY = "settlements_display_options";
const BALANCE_DISPLAY_KEY = "balance_display_options";
const STATEMENTS_ORDER_PREFIX = "statements_order_";
const STATEMENTS_HIDE_KEY = "statements_hide_balances";

/**
 * Load the saved account order for the current user + wallet.
 * Returns an array of account IDs in order, or [] if none saved.
 */
export async function getAccountOrder(
  walletId: string
): Promise<string[]> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return [];

  const { data } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", user.id)
    .eq("wallet_id", walletId)
    .eq("key", ACCOUNT_ORDER_KEY)
    .maybeSingle();

  if (!data) return [];

  const val = data.value;
  if (Array.isArray(val)) {
    return val.filter((x: unknown) => typeof x === "string") as string[];
  }
  return [];
}

/**
 * Save the account order for the current user + wallet.
 * Uses upsert on the unique (user_id, wallet_id, key) constraint.
 */
export async function saveAccountOrder(
  walletId: string,
  order: string[]
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        wallet_id: walletId,
        key: ACCOUNT_ORDER_KEY,
        value: order,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,wallet_id,key" }
    );

  if (error) return { error: error.message };
  return {};
}

export async function getSettlementsOrder(
  walletId: string
): Promise<string[]> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return [];

  const { data } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", user.id)
    .eq("wallet_id", walletId)
    .eq("key", SETTLEMENTS_ORDER_KEY)
    .maybeSingle();

  if (!data) return [];
  const val = data.value;
  if (Array.isArray(val)) {
    return val.filter((x: unknown) => typeof x === "string") as string[];
  }
  return [];
}

export async function saveSettlementsOrder(
  walletId: string,
  order: string[]
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        wallet_id: walletId,
        key: SETTLEMENTS_ORDER_KEY,
        value: order,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,wallet_id,key" }
    );

  if (error) return { error: error.message };
  return {};
}

export type SettlementsDisplayOptions = {
  showUserPhoto: boolean;
};

const DEFAULT_SETTLEMENTS_DISPLAY: SettlementsDisplayOptions = {
  showUserPhoto: true,
};

export async function getSettlementsDisplayOptions(
  walletId: string
): Promise<SettlementsDisplayOptions> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return DEFAULT_SETTLEMENTS_DISPLAY;

  const { data } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", user.id)
    .eq("wallet_id", walletId)
    .eq("key", SETTLEMENTS_DISPLAY_KEY)
    .maybeSingle();

  if (!data || typeof data.value !== "object" || data.value === null || Array.isArray(data.value)) {
    return DEFAULT_SETTLEMENTS_DISPLAY;
  }

  const v = data.value as Record<string, unknown>;
  return {
    showUserPhoto: typeof v.showUserPhoto === "boolean" ? v.showUserPhoto : true,
  };
}

export async function saveSettlementsDisplayOptions(
  walletId: string,
  options: SettlementsDisplayOptions
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        wallet_id: walletId,
        key: SETTLEMENTS_DISPLAY_KEY,
        value: options,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,wallet_id,key" }
    );

  if (error) return { error: error.message };
  return {};
}

/* ---------- Balance display options ---------- */

export type BalanceDisplayOptions = {
  showInitialBalance: boolean;
  showPlafond: boolean;
};

const DEFAULT_DISPLAY: BalanceDisplayOptions = {
  showInitialBalance: true,
  showPlafond: true,
};

export async function getBalanceDisplayOptions(
  walletId: string
): Promise<BalanceDisplayOptions> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return DEFAULT_DISPLAY;

  const { data } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", user.id)
    .eq("wallet_id", walletId)
    .eq("key", BALANCE_DISPLAY_KEY)
    .maybeSingle();

  if (!data || typeof data.value !== "object" || data.value === null || Array.isArray(data.value))
    return DEFAULT_DISPLAY;

  const v = data.value as Record<string, unknown>;
  return {
    showInitialBalance: typeof v.showInitialBalance === "boolean" ? v.showInitialBalance : true,
    showPlafond: typeof v.showPlafond === "boolean" ? v.showPlafond : true,
  };
}

export async function saveBalanceDisplayOptions(
  walletId: string,
  options: BalanceDisplayOptions
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        wallet_id: walletId,
        key: BALANCE_DISPLAY_KEY,
        value: options,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,wallet_id,key" }
    );

  if (error) return { error: error.message };
  return {};
}

/* ─── Statements table hide balances ─── */

export async function getStatementsHideBalances(
  walletId: string
): Promise<boolean> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return false;

  const { data } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", user.id)
    .eq("wallet_id", walletId)
    .eq("key", STATEMENTS_HIDE_KEY)
    .maybeSingle();

  if (!data) return false;
  return data.value === true;
}

export async function saveStatementsHideBalances(
  walletId: string,
  hideBalances: boolean
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        wallet_id: walletId,
        key: STATEMENTS_HIDE_KEY,
        value: hideBalances,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,wallet_id,key" }
    );

  if (error) return { error: error.message };
  return {};
}

/* ─── Accounts table display options ─── */

const ACCOUNTS_DISPLAY_KEY = "accounts_table_display";

export type AccountsTableDisplayOptions = {
  showInitialBalance: boolean;
  showPlafond: boolean;
};

const DEFAULT_ACCOUNTS_DISPLAY: AccountsTableDisplayOptions = {
  showInitialBalance: true,
  showPlafond: true,
};

export async function getAccountsTableDisplayOptions(
  walletId: string
): Promise<AccountsTableDisplayOptions> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return DEFAULT_ACCOUNTS_DISPLAY;

  const { data } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", user.id)
    .eq("wallet_id", walletId)
    .eq("key", ACCOUNTS_DISPLAY_KEY)
    .maybeSingle();

  if (!data || typeof data.value !== "object" || data.value === null || Array.isArray(data.value))
    return DEFAULT_ACCOUNTS_DISPLAY;

  const v = data.value as Record<string, unknown>;
  return {
    showInitialBalance: typeof v.showInitialBalance === "boolean" ? v.showInitialBalance : true,
    showPlafond: typeof v.showPlafond === "boolean" ? v.showPlafond : true,
  };
}

export async function saveAccountsTableDisplayOptions(
  walletId: string,
  options: AccountsTableDisplayOptions
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { error: err } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        wallet_id: walletId,
        key: ACCOUNTS_DISPLAY_KEY,
        value: options,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,wallet_id,key" }
    );

  if (err) return { error: err.message };
  return {};
}

/* ---------- Statements table order ---------- */

export type StatementsTableOrderKey = "income" | "expense" | "savings_investments";

function statementsOrderKey(tableKey: StatementsTableOrderKey) {
  return `${STATEMENTS_ORDER_PREFIX}${tableKey}`;
}

export async function getStatementsTableOrder(
  walletId: string,
  tableKey: StatementsTableOrderKey
): Promise<string[] | { categories: string[]; subcategories: Record<string, string[]> }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { categories: [], subcategories: {} };

  const { data } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", user.id)
    .eq("wallet_id", walletId)
    .eq("key", statementsOrderKey(tableKey))
    .maybeSingle();

  if (!data) return { categories: [], subcategories: {} };

  const val = data.value;
  // Support both old array format and new nested format
  if (Array.isArray(val)) {
    return val.filter((x: unknown) => typeof x === "string") as string[];
  }
  if (val && typeof val === "object" && "categories" in val && "subcategories" in val) {
    return val as { categories: string[]; subcategories: Record<string, string[]> };
  }
  return { categories: [], subcategories: {} };
}

export async function saveStatementsTableOrder(
  walletId: string,
  tableKey: StatementsTableOrderKey,
  order: { categories: string[]; subcategories: Record<string, string[]> }
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        wallet_id: walletId,
        key: statementsOrderKey(tableKey),
        value: order,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,wallet_id,key" }
    );

  if (error) return { error: error.message };
  return {};
}
