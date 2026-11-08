"use server";

/** Wallets, members, split metadata, settlements, and helpers for shared-wallet UI. */

import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import { getOrEnsureProfile } from "@/app/actions/profiles";
import { expenseShares, type SplitMethod } from "@/lib/expense-shares";

const SETTLEMENT_CATEGORY_NAMES = new Set(["settlement", "acerto", "liquidacion", "reglement"]);

function normalizeCategoryName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** UTC first/last day of the calendar month for a YYYY-MM-DD string; invalid input uses current UTC month. */
function utcMonthRangeForDate(isoDate: string | undefined | null): { start: string; end: string } {
  const raw = typeof isoDate === "string" ? isoDate.trim().slice(0, 10) : "";
  const y = Number(raw.slice(0, 4));
  const mo = Number(raw.slice(5, 7));
  const ok =
    raw.length >= 10 &&
    Number.isInteger(y) &&
    Number.isInteger(mo) &&
    mo >= 1 &&
    mo <= 12 &&
    y >= 1900 &&
    y <= 2500;
  const now = new Date();
  const yy = ok ? y : now.getUTCFullYear();
  const mm = ok ? mo : now.getUTCMonth() + 1;
  const start = `${yy}-${String(mm).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const end = `${yy}-${String(mm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function getDisplayNameFromSources(
  user: { email?: string | null; user_metadata?: Record<string, unknown> },
  profile?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null
): string {
  const profileFullName = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim();
  if (profileFullName) return profileFullName;
  const metadataFullName = `${(user.user_metadata as any)?.first_name ?? ""} ${(user.user_metadata as any)?.last_name ?? ""}`.trim();
  if (metadataFullName) return metadataFullName;
  return "Member";
}

export async function createWallet(params: {
  name: string;
  is_shared: boolean;
  shared_option?: string | null;
  split_type?: string | null;
  tracking_mode?: "full" | "basic" | null;
  split_mode?: "none" | "split" | null;
  default_split_method?: "equally" | "by_income" | "manual" | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: w, error: wErr } = await supabase
    .from("wallets")
    .insert({
      name: params.name,
      is_shared: params.is_shared,
      shared_option: params.shared_option ?? null,
      split_type: params.split_type ?? null,
        tracking_mode: params.tracking_mode ?? "full",
        split_mode: params.split_mode ?? "none",
        default_split_method: params.default_split_method ?? null,
      created_by: user.id,
      is_active: true,
    })
    .select("id")
    .single();

  if (wErr) return { error: wErr.message };
  if (!w) return { error: "Insert failed" };

  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();
  const ownerName = getDisplayNameFromSources(user, ownerProfile);

  let mErr: { message: string } | null = null;
  const ownerInsertWithName = await supabase.from("wallet_members").insert({
    wallet_id: w.id,
    user_id: user.id,
    role: "owner",
    member_name: ownerName,
  });
  mErr = ownerInsertWithName.error;
  if (mErr && mErr.message.toLowerCase().includes("member_name")) {
    const ownerInsertLegacy = await supabase.from("wallet_members").insert({
      wallet_id: w.id,
      user_id: user.id,
      role: "owner",
    });
    mErr = ownerInsertLegacy.error;
  }
  if (mErr) return { error: mErr.message };

  await logActivity(supabase, {
    action: "wallet_create",
    entity_type: "wallet",
    entity_id: w.id,
    wallet_id: w.id,
    payload: {
      name: params.name,
      is_shared: params.is_shared,
      shared_option: params.shared_option ?? null,
      split_type: params.split_type ?? null,
      tracking_mode: params.tracking_mode ?? "full",
      split_mode: params.split_mode ?? "none",
      default_split_method: params.default_split_method ?? null,
    },
  });
  return {};
}

export async function updateWallet(
  id: string,
  params: {
    name?: string;
    is_shared?: boolean;
    is_active?: boolean;
    shared_option?: string | null;
    split_type?: string | null;
    tracking_mode?: "full" | "basic" | null;
    split_mode?: "none" | "split" | null;
    default_split_method?: "equally" | "by_income" | "manual" | null;
  }
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("wallets")
    .select("id")
    .eq("id", id)
    .single();
  if (!existing) return { error: "Wallet not found" };

  const updates: Record<string, unknown> = {};
  if (params.name !== undefined) updates.name = params.name;
  if (params.is_shared !== undefined) updates.is_shared = params.is_shared;
  if (params.shared_option !== undefined) updates.shared_option = params.shared_option;
  if (params.split_type !== undefined) updates.split_type = params.split_type;
  if (params.tracking_mode !== undefined) updates.tracking_mode = params.tracking_mode;
  if (params.split_mode !== undefined) updates.split_mode = params.split_mode;
  if (params.default_split_method !== undefined) {
    updates.default_split_method = params.default_split_method;
  }
  if (params.is_active !== undefined) updates.is_active = params.is_active;

  if (Object.keys(updates).length === 0) return {};

  const { error: err } = await supabase.from("wallets").update(updates).eq("id", id);
  if (err) return { error: err.message };

  await logActivity(supabase, {
    action: "wallet_edit",
    entity_type: "wallet",
    entity_id: id,
    wallet_id: id,
    payload: { changes: params },
  });
  return {};
}

export async function getWalletShareCode(walletId: string): Promise<{ shareCode?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Use RPC function to get share code (bypasses RLS while checking membership)
  const { data: shareCode, error: rpcErr } = await supabase.rpc(
    "get_wallet_share_code",
    { p_wallet_id: walletId }
  );

  if (rpcErr) {
    // Convert PostgreSQL error messages to user-friendly ones
    const errorMsg = rpcErr.message || rpcErr.details || "Failed to get share code";
    if (errorMsg.includes("not authenticated")) {
      return { error: "Not authenticated" };
    }
    if (errorMsg.includes("not a member")) {
      return { error: "Not a member of this wallet" };
    }
    if (errorMsg.includes("wallet not found")) {
      return { error: "Wallet not found" };
    }
    if (errorMsg.includes("wallet is not shared")) {
      return { error: "Wallet is not shared" };
    }
    return { error: errorMsg };
  }

  if (!shareCode) {
    return { error: "Failed to generate share code" };
  }

  return { shareCode };
}

export async function joinWalletByCode(shareCode: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Use RPC function to join wallet (bypasses RLS while performing checks)
  const { data: result, error: rpcErr } = await supabase.rpc(
    "join_wallet_by_code",
    { p_share_code: shareCode }
  );

  if (rpcErr) {
    // Convert PostgreSQL error messages to user-friendly ones
    const errorMsg = rpcErr.message || rpcErr.details || "Failed to join wallet";
    if (errorMsg.includes("not authenticated")) {
      return { error: "Not authenticated" };
    }
    if (errorMsg.includes("invalid share code") || errorMsg.includes("wallet not found")) {
      return { error: "Invalid share code or wallet not found" };
    }
    if (errorMsg.includes("already a member")) {
      return { error: "You are already a member of this wallet" };
    }
    return { error: errorMsg };
  }

  if (!result) {
    return { error: "Failed to join wallet" };
  }

  // Log activity
  const walletId = result.wallet_id as string;
  const walletName = result.wallet_name as string;
  const { data: joinerProfile } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();
  const joinerName = getDisplayNameFromSources(user, joinerProfile);
  const joinNameUpdate = await supabase
    .from("wallet_members")
    .update({ member_name: joinerName })
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .is("member_name", null);
  if (joinNameUpdate.error && !joinNameUpdate.error.message.toLowerCase().includes("member_name")) {
    return { error: joinNameUpdate.error.message };
  }
  await logActivity(supabase, {
    action: "wallet_join",
    entity_type: "wallet",
    entity_id: walletId,
    wallet_id: walletId,
    payload: { wallet_name: walletName, share_code: shareCode },
  });

  return {};
}

export async function ensureCurrentWalletMemberName(walletId: string): Promise<{ updated?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: selfMember, error: memberErr } = await supabase
    .from("wallet_members")
    .select("member_name")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberErr) return { error: memberErr.message };
  if (!selfMember) return { error: "Not a member of this wallet" };

  const ensuredProfile = await getOrEnsureProfile(
    user.id,
    user.user_metadata as { first_name?: string | null; last_name?: string | null } | undefined
  );
  const resolvedName = getDisplayNameFromSources(user, {
    first_name: ensuredProfile.first_name,
    last_name: ensuredProfile.last_name,
    email: user.email ?? null,
  });
  const currentName = (selfMember.member_name ?? "").trim();
  const emailPrefix = typeof user.email === "string" && user.email.length > 0 ? user.email.split("@")[0] : "";
  const shouldUpdate =
    !currentName ||
    currentName === user.id ||
    (!!emailPrefix && currentName.toLowerCase() === emailPrefix.toLowerCase());
  if (!shouldUpdate) return { updated: false };

  const updateRes = await supabase
    .from("wallet_members")
    .update({ member_name: resolvedName })
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .is("member_name", null);
  if (updateRes.error) {
    if (updateRes.error.message.toLowerCase().includes("member_name")) return { updated: false };
    return { error: updateRes.error.message };
  }
  return { updated: true };
}

function normalizeMembers(
  rows: unknown
): Array<{ user_id: string; role: string; email?: string }> {
  const arr = Array.isArray(rows) ? rows : rows != null ? [rows] : [];
  return arr.map((r: { user_id: string; role: string; email?: string | null }) => ({
    user_id: String(r.user_id),
    role: String(r.role),
    email: r.email ?? undefined,
  }));
}

export async function getWalletMembers(walletId: string): Promise<{ members?: Array<{ user_id: string; role: string; email?: string }>; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // 1. Try RPC first (joins auth.users; works when DB can read auth schema).
  const { data: rpcRows, error: rpcError } = await supabase.rpc("get_wallet_members", {
    p_wallet_id: walletId,
  });

  if (!rpcError && rpcRows != null) {
    const members = normalizeMembers(rpcRows);
    if (members.length > 0) return { members };
    return { members: [] };
  }

  // 2. Fallback: RPC failed (e.g. auth.users not readable) — use wallet_members + optional Admin API.
  const { data: membership } = await supabase
    .from("wallet_members")
    .select("id")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) return { error: "Not a member of this wallet" };

  const { data: list, error: listErr } = await supabase
    .from("wallet_members")
    .select("user_id, role")
    .eq("wallet_id", walletId);

  if (listErr) return { error: listErr.message };
  if (!list || list.length === 0) return { members: [] };

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleKey) {
    const { createClient: createAdminClient } = await import("@supabase/supabase-js");
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    );
    const withEmails = await Promise.all(
      list.map(async (m) => {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        return {
          user_id: m.user_id,
          role: m.role,
          email: u?.user?.email ?? undefined,
        };
      })
    );
    return { members: withEmails };
  }

  return {
    members: list.map((m) => ({
      user_id: m.user_id,
      role: m.role,
      email: m.user_id === user.id ? user.email ?? undefined : undefined,
    })),
  };
}

/**
 * Check whether a wallet has any accounts or transactions.
 */
export async function getWalletUsage(
  walletId: string
): Promise<{ hasData: boolean; accountCount: number; transactionCount: number; error?: string }> {
  const supabase = await createClient();
  const { count: acctCount, error: e1 } = await supabase
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("wallet_id", walletId);
  if (e1) return { hasData: false, accountCount: 0, transactionCount: 0, error: e1.message };

  const { count: txCount, error: e2 } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("wallet_id", walletId);
  if (e2) return { hasData: false, accountCount: 0, transactionCount: 0, error: e2.message };

  const ac = acctCount ?? 0;
  const tc = txCount ?? 0;
  return { hasData: ac > 0 || tc > 0, accountCount: ac, transactionCount: tc };
}

/**
 * Soft-delete a wallet.
 * - If the wallet has no data (accounts/transactions), hard-delete immediately.
 * - If it has data, mark deleted_at + delete_after (30 days), keeping data for undo.
 */
export async function softDeleteWallet(
  walletId: string
): Promise<{ hardDeleted?: boolean; softDeleted?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Verify ownership
  const { data: member } = await supabase
    .from("wallet_members")
    .select("role")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .single();
  if (!member) return { error: "Not a member of this wallet" };
  if (member.role !== "owner") return { error: "Only the wallet owner can delete it" };

  const usage = await getWalletUsage(walletId);
  if (usage.error) return { error: usage.error };

  if (!usage.hasData) {
    // No data — hard delete immediately
    const { error: delErr } = await supabase
      .from("wallets")
      .delete()
      .eq("id", walletId);
    if (delErr) return { error: delErr.message };

    await logActivity(supabase, {
      action: "wallet_delete",
      entity_type: "wallet",
      entity_id: walletId,
      wallet_id: walletId,
      payload: { mode: "hard" },
    });
    return { hardDeleted: true };
  }

  // Has data — soft delete (30-day grace period)
  const now = new Date();
  const deleteAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { error: updErr } = await supabase
    .from("wallets")
    .update({
      deleted_at: now.toISOString(),
      delete_after: deleteAfter.toISOString(),
      is_active: false,
    })
    .eq("id", walletId);
  if (updErr) return { error: updErr.message };

  await logActivity(supabase, {
    action: "wallet_delete",
    entity_type: "wallet",
    entity_id: walletId,
    wallet_id: walletId,
    payload: { mode: "soft", delete_after: deleteAfter.toISOString() },
  });
  return { softDeleted: true };
}

/**
 * Undo a soft-delete (restore the wallet).
 */
export async function undoDeleteWallet(
  walletId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error: updErr } = await supabase
    .from("wallets")
    .update({ deleted_at: null, delete_after: null, is_active: true })
    .eq("id", walletId);
  if (updErr) return { error: updErr.message };

  await logActivity(supabase, {
    action: "wallet_restore",
    entity_type: "wallet",
    entity_id: walletId,
    wallet_id: walletId,
    payload: {},
  });
  return {};
}

export type WalletDetailMember = {
  user_id: string;
  role: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

export type WalletDetails = {
  owner: WalletDetailMember | null;
  created_at: string;
  accountCount: number;
  transactionCount: number;
  members: WalletDetailMember[];
  is_shared: boolean;
};

/**
 * Fetch wallet details: owner, creation date, counts, and members with profile info.
 */
export async function getWalletDetails(
  walletId: string
): Promise<{ details?: WalletDetails; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Fetch wallet info
  const { data: wallet, error: wErr } = await supabase
    .from("wallets")
    .select("created_at, created_by, is_shared")
    .eq("id", walletId)
    .single();
  if (wErr || !wallet) return { error: wErr?.message ?? "Wallet not found" };

  // Fetch members
  const { data: memberRows } = await supabase
    .from("wallet_members")
    .select("user_id, role, member_name")
    .eq("wallet_id", walletId);
  const rawMembers = memberRows ?? [];

  // Fetch profiles for all members
  const userIds = rawMembers.map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .in("id", userIds.length > 0 ? userIds : ["__none__"]);
  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p])
  );

  const members: WalletDetailMember[] = rawMembers.map((m) => {
    const prof = profileMap.get(m.user_id);
    const fullName = `${prof?.first_name ?? ""} ${prof?.last_name ?? ""}`.trim();
    return {
      user_id: m.user_id,
      role: m.role,
      display_name: fullName || m.member_name || "Member",
      first_name: prof?.first_name ?? null,
      last_name: prof?.last_name ?? null,
      avatar_url: prof?.avatar_url ?? null,
    };
  });

  const owner = members.find((m) => m.role === "owner") ?? null;

  // Count accounts and transactions
  const { count: acctCount } = await supabase
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("wallet_id", walletId);
  const { count: txCount } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("wallet_id", walletId);

  return {
    details: {
      owner,
      created_at: wallet.created_at,
      accountCount: acctCount ?? 0,
      transactionCount: txCount ?? 0,
      members,
      is_shared: wallet.is_shared,
    },
  };
}

export async function updateMemberIncome(
  walletId: string,
  memberId: string,
  incomeMonthly: number | null
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Verify user is member (owner) of this wallet
  const { data: member } = await supabase
    .from("wallet_members")
    .select("role")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .single();
  if (!member) return { error: "Not a member of this wallet" };
  if (member.role !== "owner") return { error: "Only wallet owner can update member info" };

  // Update member income
  const { error: err } = await supabase
    .from("wallet_members")
    .update({ income_monthly: incomeMonthly })
    .eq("wallet_id", walletId)
    .eq("user_id", memberId);

  if (err) return { error: err.message };

  await logActivity(supabase, {
    action: "wallet_member_update",
    entity_type: "wallet",
    entity_id: walletId,
    wallet_id: walletId,
    payload: { member_id: memberId, income_monthly: incomeMonthly },
  });

  return {};
}

export async function addWalletMemberByName(
  walletId: string,
  memberName: string
): Promise<{ member?: { user_id: string; display_name: string; role: string }; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const normalizedName = String(memberName || "").trim();
  if (!normalizedName) return { error: "Name is required" };

  const { data: ownerMembership } = await supabase
    .from("wallet_members")
    .select("role")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .single();
  if (!ownerMembership) return { error: "Not a member of this wallet" };
  if (ownerMembership.role !== "owner") return { error: "Only wallet owner can add members" };

  const { data: wallet } = await supabase
    .from("wallets")
    .select("is_shared, split_mode, shared_option")
    .eq("id", walletId)
    .single();
  const splitActive =
    wallet?.split_mode === "split" ||
    wallet?.shared_option === "split" ||
    wallet?.shared_option === "track_and_split";
  if (!wallet?.is_shared || !splitActive) {
    return { error: "Members can only be managed in shared split wallets" };
  }

  const pseudoMemberId = crypto.randomUUID();
  let insertErr: { message: string } | null = null;
  const insertWithName = await supabase.from("wallet_members").insert({
    wallet_id: walletId,
    user_id: pseudoMemberId,
    role: "member",
    member_name: normalizedName,
  });
  insertErr = insertWithName.error;

  // Backward compatibility when member_name column migration is not yet applied.
  if (insertErr && insertErr.message.toLowerCase().includes("member_name")) {
    const insertLegacy = await supabase.from("wallet_members").insert({
      wallet_id: walletId,
      user_id: pseudoMemberId,
      role: "member",
    });
    insertErr = insertLegacy.error;
  }
  if (insertErr) return { error: insertErr.message };

  await logActivity(supabase, {
    action: "wallet_member_add",
    entity_type: "wallet",
    entity_id: walletId,
    wallet_id: walletId,
    payload: { member_id: pseudoMemberId, name: normalizedName },
  });

  return {
    member: {
      user_id: pseudoMemberId,
      display_name: normalizedName,
      role: "member",
    },
  };
}

export async function removeWalletMember(
  walletId: string,
  memberId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: ownerMembership } = await supabase
    .from("wallet_members")
    .select("role")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .single();
  if (!ownerMembership) return { error: "Not a member of this wallet" };
  if (ownerMembership.role !== "owner") return { error: "Only wallet owner can remove members" };
  if (memberId === user.id) return { error: "Owner cannot remove themselves" };

  const { data: target } = await supabase
    .from("wallet_members")
    .select("role")
    .eq("wallet_id", walletId)
    .eq("user_id", memberId)
    .maybeSingle();
  if (!target) return { error: "Member not found" };
  if (target.role === "owner") return { error: "Cannot remove wallet owner" };

  const { error: deleteErr } = await supabase
    .from("wallet_members")
    .delete()
    .eq("wallet_id", walletId)
    .eq("user_id", memberId);
  if (deleteErr) return { error: deleteErr.message };

  await logActivity(supabase, {
    action: "wallet_member_remove",
    entity_type: "wallet",
    entity_id: walletId,
    wallet_id: walletId,
    payload: { member_id: memberId },
  });

  return {};
}

export async function linkWalletUserToJoinedMember(
  walletId: string,
  walletUserId: string,
  joinedMemberId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: ownerMembership } = await supabase
    .from("wallet_members")
    .select("role")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ownerMembership || ownerMembership.role !== "owner") {
    return { error: "Only wallet owner can link users" };
  }

  const { data: rows, error: rowsErr } = await supabase
    .from("wallet_members")
    .select("user_id, member_name, role")
    .eq("wallet_id", walletId)
    .in("user_id", [walletUserId, joinedMemberId]);
  if (rowsErr) return { error: rowsErr.message };
  if (!rows || rows.length < 2) return { error: "Both users must exist in this wallet" };

  const source = rows.find((r) => r.user_id === walletUserId);
  const target = rows.find((r) => r.user_id === joinedMemberId);
  if (!source || !target) return { error: "Invalid users selected" };
  if (target.role === "owner") return { error: "Cannot link to owner row" };

  const sourceName = source.member_name ?? null;
  if (sourceName) {
    await supabase
      .from("wallet_members")
      .update({ member_name: sourceName })
      .eq("wallet_id", walletId)
      .eq("user_id", joinedMemberId)
      .is("member_name", null);
  }

  await supabase
    .from("transactions")
    .update({ paid_by_member_id: joinedMemberId })
    .eq("wallet_id", walletId)
    .eq("paid_by_member_id", walletUserId);
  await supabase
    .from("transactions")
    .update({ received_by_member_id: joinedMemberId })
    .eq("wallet_id", walletId)
    .eq("received_by_member_id", walletUserId);

  const { data: oldSplits, error: oldSplitsErr } = await supabase
    .from("transaction_splits")
    .select("id, transaction_id, percentage")
    .eq("member_id", walletUserId);
  if (oldSplitsErr) return { error: oldSplitsErr.message };

  for (const row of oldSplits ?? []) {
    const { data: existing } = await supabase
      .from("transaction_splits")
      .select("id, percentage")
      .eq("transaction_id", row.transaction_id)
      .eq("member_id", joinedMemberId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("transaction_splits")
        .update({ percentage: Number(existing.percentage ?? 0) + Number(row.percentage ?? 0) })
        .eq("id", existing.id);
      await supabase.from("transaction_splits").delete().eq("id", row.id);
    } else {
      await supabase
        .from("transaction_splits")
        .update({ member_id: joinedMemberId })
        .eq("id", row.id);
    }
  }

  const { error: delErr } = await supabase
    .from("wallet_members")
    .delete()
    .eq("wallet_id", walletId)
    .eq("user_id", walletUserId);
  if (delErr) return { error: delErr.message };

  await logActivity(supabase, {
    action: "wallet_member_link",
    entity_type: "wallet",
    entity_id: walletId,
    wallet_id: walletId,
    payload: { wallet_user_id: walletUserId, joined_member_id: joinedMemberId },
  });

  return {};
}

export async function getWalletSettlements(
  walletId: string,
  period?: { year?: number; month?: number; granularity?: "month" | "year" }
): Promise<{
  settlements?: Array<{
    member_id: string;
    email: string;
    avatar_url: string | null;
    total_paid: number;
    total_share: number;
    monthly_income: number;
    monthly_paid: number;
    balance: number;
  }>;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Verify user is member of this wallet
  const { data: member } = await supabase
    .from("wallet_members")
    .select("role")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .single();
  if (!member) return { error: "Not a member of this wallet" };
  const { data: wallet, error: walletErr } = await supabase
    .from("wallets")
    .select("default_split_method, split_type, split_mode, shared_option")
    .eq("id", walletId)
    .single();
  if (walletErr || !wallet) return { error: walletErr?.message ?? "Wallet not found" };

  const isSplitWallet =
    wallet.split_mode === "split" ||
    wallet.shared_option === "split" ||
    wallet.shared_option === "track_and_split";
  if (!isSplitWallet) return { settlements: [] };

  const defaultMethod = (wallet.default_split_method ||
    (wallet.split_type === "by_income" ? "by_income" : "equally")) as
    | "equally"
    | "by_income"
    | "manual";

  const { data: members, error: membersErr } = await supabase
    .from("wallet_members")
    .select("user_id, member_name, income_monthly")
    .eq("wallet_id", walletId);
  if (membersErr) return { error: membersErr.message };
  if (!members || members.length === 0) return { settlements: [] };

  const memberIds = members.map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .in("id", memberIds);
  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  const memberInfo = new Map(
    members.map((m: any) => [
      m.user_id,
      {
        profile: profileMap.get(m.user_id),
        email:
          [profileMap.get(m.user_id)?.first_name, profileMap.get(m.user_id)?.last_name].filter(Boolean).join(" ").trim() ||
          m.member_name ||
          "Member",
        income: Number(m.income_monthly ?? 0),
      },
    ])
  );

  const now = new Date();
  const granularity = period?.granularity === "year" ? "year" : "month";
  const requestedYear = Number(period?.year);
  const requestedMonth = Number(period?.month);
  const selectedYear = Number.isInteger(requestedYear) ? requestedYear : now.getUTCFullYear();
  const selectedMonth =
    granularity === "month" && Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
      ? requestedMonth
      : now.getUTCMonth() + 1;
  const periodStart =
    granularity === "year"
      ? `${selectedYear}-01-01`
      : `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
  const periodEnd =
    granularity === "year"
      ? `${selectedYear}-12-31`
      : `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(
          new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate()
        ).padStart(2, "0")}`;

  const { data: expenses, error: txErr } = await supabase
    .from("transactions")
    .select("id, date, amount, paid_by_member_id, split_method_override")
    .eq("wallet_id", walletId)
    .eq("status", "confirmed")
    .eq("type", "expense")
    .gte("date", periodStart)
    .lte("date", periodEnd);
  if (txErr) return { error: txErr.message };

  const { data: transfers, error: transfersErr } = await supabase
    .from("transactions")
    .select("amount, paid_by_member_id, received_by_member_id")
    .eq("wallet_id", walletId)
    .eq("status", "confirmed")
    .eq("type", "transfer")
    .gte("date", periodStart)
    .lte("date", periodEnd);
  if (transfersErr) return { error: transfersErr.message };

  const { data: incomesLocal, error: incomesErr } = await supabase
    .from("transactions")
    .select("date, amount, received_by_member_id, created_by")
    .eq("wallet_id", walletId)
    .eq("status", "confirmed")
    .eq("type", "income")
    .gte("date", periodStart)
    .lte("date", periodEnd);
  if (incomesErr) return { error: incomesErr.message };

  const { data: incomesUserOtherWallets, error: incomesOtherErr } = await supabase
    .from("transactions")
    .select("date, amount, received_by_member_id, created_by")
    .neq("wallet_id", walletId)
    .eq("status", "confirmed")
    .eq("type", "income")
    .eq("income_scope", "user")
    .in("received_by_member_id", memberIds)
    .gte("date", periodStart)
    .lte("date", periodEnd);
  if (incomesOtherErr) return { error: incomesOtherErr.message };

  const incomes = [...(incomesLocal ?? []), ...(incomesUserOtherWallets ?? [])];
  const monthStart = periodStart;
  const monthEnd = periodEnd;

  const incomeByMember = new Map<string, number>();
  const monthlyIncomeByMember = new Map<string, number>();
  /** YYYY-MM → member → sum of confirmed income in that month (for by_income share per expense date). */
  const incomeByMonthAndMember = new Map<string, Map<string, number>>();
  const ensureMonthIncome = (monthKey: string): Map<string, number> => {
    let inner = incomeByMonthAndMember.get(monthKey);
    if (!inner) {
      inner = new Map();
      for (const id of memberIds) inner.set(id, 0);
      incomeByMonthAndMember.set(monthKey, inner);
    }
    return inner;
  };
  for (const id of memberIds) incomeByMember.set(id, 0);
  for (const id of memberIds) monthlyIncomeByMember.set(id, 0);
  const memberIdSet = new Set(memberIds);
  const attributeIncomeToMember = (inc: {
    received_by_member_id: string | null;
    created_by: string | null;
  }): string | null => {
    if (inc.received_by_member_id && memberIdSet.has(inc.received_by_member_id)) {
      return inc.received_by_member_id;
    }
    return null;
  };

  for (const inc of incomes as Array<{
    date: string;
    amount: number;
    received_by_member_id: string | null;
    created_by: string | null;
  }>) {
    const memberKey = attributeIncomeToMember(inc);
    if (!memberKey || !incomeByMember.has(memberKey)) continue;
    const amt = Number(inc.amount ?? 0);
    incomeByMember.set(memberKey, (incomeByMember.get(memberKey) ?? 0) + amt);
    const monthKey = String(inc.date).slice(0, 7);
    const monthInner = ensureMonthIncome(monthKey);
    monthInner.set(memberKey, (monthInner.get(memberKey) ?? 0) + amt);
    const d = String(inc.date).slice(0, 10);
    if (d >= monthStart && d <= monthEnd) {
      monthlyIncomeByMember.set(memberKey, (monthlyIncomeByMember.get(memberKey) ?? 0) + amt);
    }
  }

  const txIds = (expenses ?? []).map((t) => t.id);
  let splits: Array<{ transaction_id: string; member_id: string; percentage: number }> = [];
  let splitsErr: { message?: string } | null = null;
  if (txIds.length) {
    const splitsRes = await supabase
      .from("transaction_splits")
      .select("transaction_id, member_id, percentage")
      .in("transaction_id", txIds);
    splits = (splitsRes.data ?? []) as Array<{ transaction_id: string; member_id: string; percentage: number }>;
    splitsErr = splitsRes.error;
  }
  if (splitsErr) return { error: splitsErr.message };

  const splitsByTx = new Map<string, Array<{ member_id: string; percentage: number }>>();
  for (const s of splits) {
    const arr = splitsByTx.get(s.transaction_id) ?? [];
    arr.push({ member_id: s.member_id, percentage: Number(s.percentage) });
    splitsByTx.set(s.transaction_id, arr);
  }

  const totalPaid = new Map<string, number>();
  const monthlyPaidByMember = new Map<string, number>();
  const totalShare = new Map<string, number>();
  const transferAdjustments = new Map<string, number>();
  for (const id of memberIds) {
    totalPaid.set(id, 0);
    monthlyPaidByMember.set(id, 0);
    totalShare.set(id, 0);
    transferAdjustments.set(id, 0);
  }

  const configuredIncomeByMember = new Map<string, number>(
    members.map((m: any) => [m.user_id, Number(m.income_monthly ?? 0)])
  );

  for (const tx of (expenses ?? []) as Array<{
    id: string;
    date: string;
    amount: number;
    paid_by_member_id: string | null;
    split_method_override: string | null;
  }>) {
    const amount = Number(tx.amount);
    const payerId = tx.paid_by_member_id;
    if (payerId && totalPaid.has(payerId)) {
      totalPaid.set(payerId, (totalPaid.get(payerId) ?? 0) + amount);
      const d = String(tx.date).slice(0, 10);
      if (d >= monthStart && d <= monthEnd) {
        monthlyPaidByMember.set(payerId, (monthlyPaidByMember.get(payerId) ?? 0) + amount);
      }
    }

    const method = (tx.split_method_override as SplitMethod | null) || defaultMethod;
    const shares = expenseShares({
      amount,
      date: String(tx.date),
      method,
      memberIds,
      manualSplits: splitsByTx.get(tx.id),
      incomeByMonthAndMember,
      configuredIncomeByMember,
    });
    for (const [memberId, share] of Array.from(shares)) {
      totalShare.set(memberId, (totalShare.get(memberId) ?? 0) + share);
    }
  }

  // Transfers between members are settlement movements:
  // payer balance increases (they paid back), receiver balance decreases (they were paid back).
  for (const tx of (transfers ?? []) as Array<{
    amount: number;
    paid_by_member_id: string | null;
    received_by_member_id: string | null;
  }>) {
    const amount = Number(tx.amount ?? 0);
    const payer = tx.paid_by_member_id;
    const receiver = tx.received_by_member_id;
    if (!amount || amount <= 0 || !payer || !receiver || payer === receiver) continue;
    if (transferAdjustments.has(payer)) {
      transferAdjustments.set(payer, (transferAdjustments.get(payer) ?? 0) + amount);
    }
    if (transferAdjustments.has(receiver)) {
      transferAdjustments.set(receiver, (transferAdjustments.get(receiver) ?? 0) - amount);
    }
  }

  const settlements = memberIds.map((memberId) => {
    const paid = totalPaid.get(memberId) ?? 0;
    const share = totalShare.get(memberId) ?? 0;
    const transferAdjustment = transferAdjustments.get(memberId) ?? 0;
    const balance = paid - share + transferAdjustment;
    // Show net "Despesas": cash paid on shared expenses, adjusted by member↔member
    // settlement transfers in the same period (payer +amount, receiver −amount).
    const paidAfterSettlements = paid + transferAdjustment;
    return {
      member_id: memberId,
      email: memberInfo.get(memberId)?.email ?? memberId,
      avatar_url: memberInfo.get(memberId)?.profile?.avatar_url ?? null,
      total_paid: Math.round(paidAfterSettlements * 100),
      total_share: Math.round(share * 100),
      monthly_income: Math.round((monthlyIncomeByMember.get(memberId) ?? 0) * 100),
      monthly_paid: Math.round(paidAfterSettlements * 100),
      balance: Math.round(balance * 100),
    };
  });

  return { settlements };
}

export async function getWalletSplitInfo(
  walletId: string,
  options?: { referenceDate?: string }
): Promise<{
  is_shared?: boolean;
  shared_option?: string | null;
  split_type?: string | null;
  tracking_mode?: string | null;
  split_mode?: string | null;
  default_split_method?: string | null;
  members?: Array<{
    id: string;
    user_id: string;
    display_name: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    current_month_income: number;
  }>;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Fetch wallet split_type and shared_option
  const { data: wallet, error: walletErr } = await supabase
    .from("wallets")
    .select("split_type, shared_option, tracking_mode, split_mode, default_split_method, is_shared")
    .eq("id", walletId)
    .single();
  if (walletErr || !wallet) return { error: walletErr?.message ?? "Wallet not found" };

  // Fetch wallet members
  const { data: memberData, error: memberErr } = await supabase
    .from("wallet_members")
    .select("id, user_id, member_name")
    .eq("wallet_id", walletId);

  const memberErrorMessage = memberErr ? memberErr.message : undefined;
  const memberIds = (memberData ?? []).map((m: any) => m.user_id);
  let profileRows: any[] = [];
  if (memberIds.length) {
    const profilesRes = await supabase
      .from("profiles")
      .select("id, first_name, last_name, avatar_url")
      .in("id", memberIds);
    profileRows = profilesRes.data ?? [];
  }
  const profilesById = new Map((profileRows ?? []).map((p: any) => [p.id, p]));

  // Format members - prioritize proper names and avoid UUID-like fallbacks in UI.
  let members = (memberData ?? []).map((m: any) => {
    const profile = profilesById.get(m.user_id) as any;
    const fullName = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim();
    const displayName =
      fullName ||
      m.member_name ||
      "Member";

    return {
      id: m.user_id,
      user_id: m.user_id,
      display_name: displayName,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      current_month_income: 0,
    };
  });

  const { start: monthStart, end: monthEnd } = utcMonthRangeForDate(
    options?.referenceDate?.trim() || new Date().toISOString().slice(0, 10)
  );
  const { data: incomesLocalSplit } = await supabase
    .from("transactions")
    .select("amount, received_by_member_id, created_by")
    .eq("wallet_id", walletId)
    .eq("status", "confirmed")
    .eq("type", "income")
    .gte("date", monthStart)
    .lte("date", monthEnd);
  const { data: incomesOtherSplit } = await supabase
    .from("transactions")
    .select("amount, received_by_member_id, created_by")
    .neq("wallet_id", walletId)
    .eq("status", "confirmed")
    .eq("type", "income")
    .eq("income_scope", "user")
    .in("received_by_member_id", memberIds)
    .gte("date", monthStart)
    .lte("date", monthEnd);
  const currentMonthIncomes = [...(incomesLocalSplit ?? []), ...(incomesOtherSplit ?? [])];
  const monthIncomeByMember = new Map<string, number>();
  for (const m of members) monthIncomeByMember.set(m.user_id, 0);
  const memberIdSetSplit = new Set(memberIds);
  for (const inc of currentMonthIncomes as Array<{
    amount: number;
    received_by_member_id: string | null;
    created_by: string | null;
  }>) {
    const key =
      inc.received_by_member_id && memberIdSetSplit.has(inc.received_by_member_id)
        ? inc.received_by_member_id
        : null;
    if (!key || !monthIncomeByMember.has(key)) continue;
    monthIncomeByMember.set(key, (monthIncomeByMember.get(key) ?? 0) + Number(inc.amount ?? 0));
  }
  members = members.map((m) => ({
    ...m,
    current_month_income: monthIncomeByMember.get(m.user_id) ?? 0,
  }));

  if (members.length === 0) {
    const { data: selfMember } = await supabase
      .from("wallet_members")
      .select("id, user_id")
      .eq("wallet_id", walletId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (selfMember) {
      const fallbackName =
        `${(user.user_metadata as any)?.first_name ?? ""} ${(user.user_metadata as any)?.last_name ?? ""}`.trim() ||
        (user.email ? user.email.split("@")[0] : "Member");
      members = [
        {
          id: selfMember.user_id,
          user_id: selfMember.user_id,
          display_name: fallbackName,
          first_name: null,
          last_name: null,
          avatar_url: null,
          current_month_income: 0,
        },
      ];
    }
  }

  // Infer shared_option from split_type if shared_option is not explicitly set
  let sharedOption = wallet.shared_option;
  if (typeof sharedOption === "string") {
    const normalized = sharedOption.trim().toLowerCase();
    if (normalized === "control") sharedOption = "track";
    else if (normalized === "split_equal") sharedOption = "split";
    else if (normalized === "split_income") sharedOption = "track_and_split";
    else sharedOption = normalized;
  }
  if (!sharedOption && wallet.split_type) {
    // If split_type is set but shared_option is not, infer it
    sharedOption = "split";
  }

  // If still no shared_option but wallet is shared, default to 'track'
  // This ensures non-null values for proper conditional rendering
  if (!sharedOption) {
    // Query to check if wallet is shared
    const { data: walletFull } = await supabase
      .from("wallets")
      .select("is_shared")
      .eq("id", walletId)
      .single();
    if (walletFull?.is_shared) {
      sharedOption = "track";
    }
  }

  return {
    is_shared: !!wallet.is_shared,
    shared_option: sharedOption,
    split_type: wallet.split_type,
    tracking_mode: wallet.tracking_mode ?? null,
    split_mode: wallet.split_mode ?? null,
    default_split_method: wallet.default_split_method ?? null,
    members,
    error: memberErrorMessage,
  };
}

export async function getCurrentUserId(): Promise<{ userId?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  return { userId: user.id };
}

export async function confirmSettlementTransfer(params: {
  walletId: string;
  payerMemberId: string;
  receiverMemberId: string;
  amountCents: number;
  date: string;
  description?: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const membership = await supabase
    .from("wallet_members")
    .select("user_id")
    .eq("wallet_id", params.walletId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error || !membership.data) return { error: "Not allowed" };

  if (!params.payerMemberId || !params.receiverMemberId) {
    return { error: "Settlement members are required" };
  }
  if (params.payerMemberId === params.receiverMemberId) {
    return { error: "Payer and receiver must be different" };
  }
  if (!Number.isFinite(params.amountCents) || params.amountCents <= 0) {
    return { error: "Settlement amount must be positive" };
  }

  const { data: transferCategories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("wallet_id", params.walletId)
    .eq("type", "transfer")
    .is("parent_id", null)
    .eq("is_active", true);

  const matchedSettlement = ((transferCategories ?? []) as Array<{ id: string; name: string }>)
    .find((c) => SETTLEMENT_CATEGORY_NAMES.has(normalizeCategoryName(c.name)));

  let categoryId = matchedSettlement?.id ?? null;
  if (!categoryId) {
    const { data: created, error: catErr } = await supabase
      .from("categories")
      .insert({
        wallet_id: params.walletId,
        name: "Settlement",
        type: "transfer",
        parent_id: null,
        created_by: user.id,
        is_active: true,
      })
      .select("id")
      .single();
    if (catErr || !created) return { error: catErr?.message ?? "Failed to create Settlement category" };
    categoryId = created.id;
  }

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      wallet_id: params.walletId,
      type: "transfer",
      category_id: categoryId,
      date: params.date,
      amount: params.amountCents / 100,
      description: params.description?.trim() || "Settlement",
      created_by: user.id,
      status: "confirmed",
      hold_balance: false,
      account_from_id: null,
      account_to_id: null,
      paid_by_member_id: params.payerMemberId,
      received_by_member_id: params.receiverMemberId,
    })
    .select("id")
    .single();
  if (txErr || !tx) return { error: txErr?.message ?? "Failed to create settlement transfer" };

  await logActivity(supabase, {
    action: "transaction_create",
    entity_type: "transaction",
    entity_id: tx.id,
    wallet_id: params.walletId,
    payload: {
      amount: params.amountCents / 100,
      type: "transfer",
      date: params.date,
      category: "Settlement",
      paid_by_member_id: params.payerMemberId,
      received_by_member_id: params.receiverMemberId,
    },
  });

  return {};
}

export type TransactionByMemberRow = {
  id: string;
  date: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  description: string | null;
  categoryLabel: string;
  subcategoryLabel: string;
  status: "confirmed" | "pending";
  holdBalance?: boolean;
  paidByMemberId: string | null;
  receivedByMemberId: string | null;
  paidByName: string;
  receivedByName: string;
};

export type MemberIncomeExpensePoint = {
  date: string;
  income: number;
  expense: number;
};

export async function getTransactionsByMember(
  walletId: string,
  memberId: string,
  opts?: { limit?: number; fromDate?: string; toDate?: string }
): Promise<TransactionByMemberRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const membership = await supabase
    .from("wallet_members")
    .select("user_id")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error || !membership.data) return [];

  const q = supabase
    .from("transactions")
    .select(
      "id, date, created_at, type, amount, description, status, hold_balance, paid_by_member_id, received_by_member_id, " +
      "category:categories(name, parent_id)"
    )
    .eq("wallet_id", walletId)
    .eq("status", "confirmed")
    .or(`paid_by_member_id.eq.${memberId},received_by_member_id.eq.${memberId}`)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (opts?.fromDate) q.gte("date", opts.fromDate);
  if (opts?.toDate) q.lte("date", opts.toDate);
  if (opts?.limit && opts.limit > 0) q.limit(opts.limit);

  const [{ data }, { data: members }] = await Promise.all([
    q,
    supabase
      .from("wallet_members")
      .select("user_id, member_name")
      .eq("wallet_id", walletId),
  ]);
  const memberNameById = new Map(
    ((members ?? []) as Array<{ user_id: string; member_name?: string | null }>).map((m) => [
      m.user_id,
      m.member_name?.trim() || "Member",
    ])
  );
  return ((data ?? []) as unknown as Array<{
    id: string;
    date: string;
    created_at?: string | null;
    type: "income" | "expense" | "transfer";
    amount: number;
    description: string | null;
    status?: string | null;
    hold_balance?: boolean | null;
    category?: { name?: string | null; parent_id?: string | null } | null;
    paid_by_member_id: string | null;
    received_by_member_id: string | null;
  }>).map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type,
    amount: Number(r.amount),
    description: r.description,
    categoryLabel: r.category?.parent_id ? "—" : (r.category?.name ?? "—"),
    subcategoryLabel: r.category?.parent_id ? (r.category?.name ?? "—") : "—",
    status: r.status === "pending" ? "pending" : "confirmed",
    holdBalance: !!r.hold_balance,
    paidByMemberId: r.paid_by_member_id,
    receivedByMemberId: r.received_by_member_id,
    paidByName: r.paid_by_member_id ? (memberNameById.get(r.paid_by_member_id) ?? "Member") : "—",
    receivedByName: r.received_by_member_id ? (memberNameById.get(r.received_by_member_id) ?? "Member") : "—",
  }));
}

export async function getMemberIncomeExpenseSeries(
  walletId: string,
  memberId: string,
  fromDate: string,
  toDate: string
): Promise<MemberIncomeExpensePoint[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const membership = await supabase
    .from("wallet_members")
    .select("user_id")
    .eq("wallet_id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error || !membership.data) return [];

  const incomesQuery = supabase
    .from("transactions")
    .select("date, amount")
    .eq("wallet_id", walletId)
    .eq("status", "confirmed")
    .eq("type", "income")
    .eq("received_by_member_id", memberId)
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

  const expensesQuery = supabase
    .from("transactions")
    .select("date, amount")
    .eq("wallet_id", walletId)
    .eq("status", "confirmed")
    .eq("type", "expense")
    .eq("paid_by_member_id", memberId)
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

  const [{ data: incomes }, { data: expenses }] = await Promise.all([
    incomesQuery,
    expensesQuery,
  ]);

  const incomeByDate = new Map<string, number>();
  for (const row of (incomes ?? []) as unknown as Array<{ date: string; amount: number }>) {
    const key = row.date.slice(0, 10);
    incomeByDate.set(key, (incomeByDate.get(key) ?? 0) + Number(row.amount));
  }

  const expenseByDate = new Map<string, number>();
  for (const row of (expenses ?? []) as unknown as Array<{ date: string; amount: number }>) {
    const key = row.date.slice(0, 10);
    expenseByDate.set(key, (expenseByDate.get(key) ?? 0) + Number(row.amount));
  }

  const points: MemberIncomeExpensePoint[] = [];
  const cursor = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    points.push({
      date: key,
      income: incomeByDate.get(key) ?? 0,
      expense: expenseByDate.get(key) ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}
