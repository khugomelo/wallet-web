"use server";

/** Wallet categories and subcategories: CRUD and lookups for transaction forms. */

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";

const PROTECTED_SALARY_NAMES = new Set(["salary", "salario", "salaire"]);
const PROTECTED_SETTLEMENT_NAMES = new Set(["settlement", "acerto", "liquidacion", "reglement"]);

function normalizeCategoryName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function getCategory(id: string | null) {
  if (!id) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("id, name, parent_id, is_essential")
    .eq("id", id)
    .single();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    parent_id: data.parent_id as string | null,
    is_essential: !!(data as { is_essential?: boolean }).is_essential,
  };
}

export async function createCategory(params: {
  wallet_id: string;
  name: string;
  type: "income" | "expense" | "transfer";
  parent_id?: string | null;
  is_essential?: boolean;
}): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const isEssential = params.type === "expense" && !!params.is_essential;

  const { data, error } = await supabase
    .from("categories")
    .insert({
      wallet_id: params.wallet_id,
      name: params.name,
      type: params.type,
      parent_id: params.parent_id ?? null,
      created_by: user.id,
      is_active: true,
      is_essential: isEssential,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (params.parent_id && params.type === "expense") {
    const { error: clearErr } = await supabase
      .from("categories")
      .update({ is_essential: false })
      .eq("id", params.parent_id);
    if (clearErr) {
      if (data?.id) await supabase.from("categories").delete().eq("id", data.id);
      return { error: clearErr.message };
    }
  }

  await logActivity(supabase, {
    action: "category_create",
    entity_type: "category",
    entity_id: data?.id ?? undefined,
    wallet_id: params.wallet_id,
    payload: {
      name: params.name,
      type: params.type,
      parent_id: params.parent_id,
      is_essential: isEssential,
    },
  });
  return { id: data?.id };
}

export async function updateCategory(
  id: string,
  params: { name?: string; is_active?: boolean; is_essential?: boolean; parent_id?: string | null }
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("categories")
    .select("wallet_id, name, parent_id, is_essential, type")
    .eq("id", id)
    .single();
  if (!existing) return { error: "Category not found" };

  const rowType = (existing as { type?: string }).type;
  let parentIdChanged = false;

  if (params.parent_id !== undefined) {
    if (existing.parent_id == null) {
      return { error: "Only subcategories can change parent category." };
    }
    if (params.parent_id === null || params.parent_id === "") {
      return { error: "Subcategory must have a parent category." };
    }
    if (params.parent_id === id) {
      return { error: "Invalid parent category." };
    }
    if (params.parent_id !== existing.parent_id) {
      const { data: newParent, error: pErr } = await supabase
        .from("categories")
        .select("id, wallet_id, type, parent_id")
        .eq("id", params.parent_id)
        .single();
      if (pErr || !newParent) return { error: "Parent category not found." };
      const np = newParent as { wallet_id: string; type: string; parent_id: string | null };
      if (
        np.wallet_id !== existing.wallet_id ||
        np.type !== rowType ||
        np.parent_id !== null
      ) {
        return { error: "Invalid parent category." };
      }
    }
  }

  const { count: childCount } = await supabase
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", id);
  const hasChildren = (childCount ?? 0) > 0;
  const isRoot = existing.parent_id == null;

  const updates: Record<string, unknown> = {};
  const payload: Record<string, { old?: unknown; new: unknown }> = {};

  if (params.name !== undefined) {
    updates.name = params.name;
    payload.name = { old: existing.name, new: params.name };
  }
  if (params.is_active !== undefined) {
    updates.is_active = params.is_active;
    payload.is_active = { new: params.is_active };
  }
  if (isRoot && hasChildren) {
    updates.is_essential = false;
    if (existing.is_essential) {
      payload.is_essential = { old: true, new: false };
    }
  } else if (
    rowType === "expense" &&
    params.is_essential !== undefined &&
    existing.is_essential !== params.is_essential
  ) {
    updates.is_essential = params.is_essential;
    payload.is_essential = { old: existing.is_essential, new: params.is_essential };
  }

  if (rowType !== "expense" && existing.is_essential) {
    updates.is_essential = false;
    payload.is_essential = { old: existing.is_essential, new: false };
  }

  if (params.parent_id !== undefined && existing.parent_id != null && params.parent_id !== existing.parent_id) {
    updates.parent_id = params.parent_id;
    payload.parent_id = { old: existing.parent_id, new: params.parent_id };
    parentIdChanged = true;
  }

  if (Object.keys(updates).length === 0) return {};

  const { error: err } = await supabase.from("categories").update(updates).eq("id", id);
  if (err) return { error: err.message };

  if (parentIdChanged && rowType === "expense" && params.parent_id) {
    await supabase.from("categories").update({ is_essential: false }).eq("id", params.parent_id);
  }

  await logActivity(supabase, {
    action: "category_edit",
    entity_type: "category",
    entity_id: id,
    wallet_id: existing.wallet_id,
    payload: { changes: payload },
  });
  return {};
}

/**
 * Returns the number of transactions that reference this category
 * (and its subcategories, if it is a parent category).
 */
export async function getCategoryUsage(
  id: string
): Promise<{ transactionCount: number; childCount: number }> {
  const supabase = await createClient();

  // Collect all category IDs to check (self + children)
  const { data: children } = await supabase
    .from("categories")
    .select("id")
    .eq("parent_id", id);
  const childIds = (children ?? []).map((c) => c.id);
  const allIds = [id, ...childIds];

  // Count transactions referencing any of those IDs
  let transactionCount = 0;
  for (const catId of allIds) {
    const { count } = await supabase
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .eq("category_id", catId);
    transactionCount += count ?? 0;
  }

  return { transactionCount, childCount: childIds.length };
}

/**
 * Deletes a category (and its subcategories).
 * - If transactions reference the category: deactivates instead of deleting
 *   so that confirmed transactions maintain their category data.
 * - If no transactions reference it: hard-deletes.
 */
export async function deleteCategory(id: string): Promise<{ error?: string; deactivated?: boolean }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("categories")
    .select("wallet_id, name, parent_id, type")
    .eq("id", id)
    .single();
  if (!existing) return { error: "Category not found" };

  const { data: wallet } = await supabase
    .from("wallets")
    .select("split_mode, shared_option")
    .eq("id", existing.wallet_id)
    .maybeSingle();
  const splitActive =
    wallet?.split_mode === "split" ||
    wallet?.shared_option === "split" ||
    wallet?.shared_option === "track_and_split";
  const normalizedName = normalizeCategoryName(existing.name);
  const isProtectedIncome =
    existing.parent_id == null &&
    existing.type === "income" &&
    PROTECTED_SALARY_NAMES.has(normalizedName);
  const isProtectedTransfer =
    existing.parent_id == null &&
    existing.type === "transfer" &&
    PROTECTED_SETTLEMENT_NAMES.has(normalizedName);
  if (splitActive && (isProtectedIncome || isProtectedTransfer)) {
    return { error: "This category is required in split wallets and cannot be deleted." };
  }

  // Collect child IDs
  const { data: children } = await supabase
    .from("categories")
    .select("id")
    .eq("parent_id", id);
  const childIds = (children ?? []).map((c) => c.id);
  const allIds = [id, ...childIds];

  // Count transactions referencing this category or its subcategories
  let transactionCount = 0;
  for (const catId of allIds) {
    const { count } = await supabase
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .eq("category_id", catId);
    transactionCount += count ?? 0;
  }

  if (transactionCount > 0) {
    // Deactivate instead of deleting to preserve transaction data
    const { error: deactivateErr } = await supabase
      .from("categories")
      .update({ is_active: false })
      .in("id", allIds);
    if (deactivateErr) return { error: deactivateErr.message };

    await logActivity(supabase, {
      action: "category_deactivate",
      entity_type: "category",
      entity_id: id,
      wallet_id: existing.wallet_id,
      payload: { name: existing.name, reason: "has_transactions", transactionCount },
    });
    return { deactivated: true };
  }

  // No transactions — safe to hard-delete
  if (childIds.length > 0) {
    const { error: childErr } = await supabase
      .from("categories")
      .delete()
      .eq("parent_id", id);
    if (childErr) return { error: childErr.message };
  }

  const { error: err } = await supabase.from("categories").delete().eq("id", id);
  if (err) return { error: err.message };

  await logActivity(supabase, {
    action: "category_delete",
    entity_type: "category",
    entity_id: id,
    wallet_id: existing.wallet_id,
    payload: { name: existing.name },
  });
  return {};
}

export type CopyableCategoryGroup = {
  wallet_id: string;
  wallet_name: string;
  categories: Array<{
    id: string;
    name: string;
    children: Array<{ id: string; name: string }>;
  }>;
};

export async function getCopyableCategories(
  targetWalletId: string,
  type: "income" | "expense" | "transfer"
): Promise<{ groups?: CopyableCategoryGroup[]; error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { data: memberships, error: memberErr } = await supabase
    .from("wallet_members")
    .select("wallet_id, wallets(name)")
    .eq("user_id", user.id);
  if (memberErr) return { error: memberErr.message };

  const walletRows = (memberships ?? [])
    .map((m: any) => ({
      wallet_id: m.wallet_id as string,
      wallet_name: (Array.isArray(m.wallets) ? m.wallets[0]?.name : m.wallets?.name) as string | undefined,
    }))
    .filter((w) => w.wallet_id && w.wallet_id !== targetWalletId);
  if (walletRows.length === 0) return { groups: [] };

  const walletIds = walletRows.map((w) => w.wallet_id);
  const { data: cats, error: catErr } = await supabase
    .from("categories")
    .select("id, name, parent_id, wallet_id")
    .in("wallet_id", walletIds)
    .eq("type", type)
    .order("name");
  if (catErr) return { error: catErr.message };

  const byWallet = new Map<string, { roots: Map<string, { id: string; name: string; children: Array<{ id: string; name: string }> }>; byId: Map<string, { id: string; name: string; parent_id: string | null }> }>();
  for (const w of walletRows) {
    byWallet.set(w.wallet_id, { roots: new Map(), byId: new Map() });
  }
  for (const c of (cats ?? []) as Array<{ id: string; name: string; parent_id: string | null; wallet_id: string }>) {
    const slot = byWallet.get(c.wallet_id);
    if (!slot) continue;
    slot.byId.set(c.id, { id: c.id, name: c.name, parent_id: c.parent_id });
    if (!c.parent_id) slot.roots.set(c.id, { id: c.id, name: c.name, children: [] });
  }
  for (const c of (cats ?? []) as Array<{ id: string; name: string; parent_id: string | null; wallet_id: string }>) {
    if (!c.parent_id) continue;
    const slot = byWallet.get(c.wallet_id);
    const root = slot?.roots.get(c.parent_id);
    if (root) root.children.push({ id: c.id, name: c.name });
  }

  const groups: CopyableCategoryGroup[] = walletRows
    .map((w) => ({
      wallet_id: w.wallet_id,
      wallet_name: w.wallet_name ?? "Wallet",
      categories: Array.from(byWallet.get(w.wallet_id)?.roots.values() ?? []),
    }))
    .filter((g) => g.categories.length > 0);
  return { groups };
}

export async function copyCategoriesToWallet(params: {
  target_wallet_id: string;
  source_wallet_id: string;
  type: "income" | "expense" | "transfer";
  root_category_ids: string[];
}): Promise<{ copiedCount?: number; error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  if (!params.root_category_ids.length) return { copiedCount: 0 };

  const { data: memberships } = await supabase
    .from("wallet_members")
    .select("wallet_id")
    .eq("user_id", user.id)
    .in("wallet_id", [params.target_wallet_id, params.source_wallet_id]);
  const allowed = new Set((memberships ?? []).map((m) => m.wallet_id));
  if (!allowed.has(params.target_wallet_id) || !allowed.has(params.source_wallet_id)) {
    return { error: "No access to one of the wallets" };
  }

  const { data: sourceRoots, error: sourceErr } = await supabase
    .from("categories")
    .select("id, name")
    .eq("wallet_id", params.source_wallet_id)
    .eq("type", params.type)
    .is("parent_id", null)
    .in("id", params.root_category_ids);
  if (sourceErr) return { error: sourceErr.message };
  if (!sourceRoots?.length) return { copiedCount: 0 };

  const sourceRootIds = sourceRoots.map((r) => r.id);
  const { data: sourceChildren } = await supabase
    .from("categories")
    .select("id, name, parent_id")
    .eq("wallet_id", params.source_wallet_id)
    .eq("type", params.type)
    .in("parent_id", sourceRootIds);

  const { data: targetExisting } = await supabase
    .from("categories")
    .select("id, name, parent_id")
    .eq("wallet_id", params.target_wallet_id)
    .eq("type", params.type);
  const existingRoots = new Map(
    (targetExisting ?? [])
      .filter((c) => c.parent_id == null)
      .map((c) => [c.name.trim().toLowerCase(), c.id])
  );

  let copiedCount = 0;
  const rootMap = new Map<string, string>();
  for (const root of sourceRoots) {
    const key = root.name.trim().toLowerCase();
    if (existingRoots.has(key)) {
      rootMap.set(root.id, existingRoots.get(key)!);
      continue;
    }
    const { data: inserted, error: insErr } = await supabase
      .from("categories")
      .insert({
        wallet_id: params.target_wallet_id,
        name: root.name,
        type: params.type,
        parent_id: null,
        created_by: user.id,
        is_active: true,
      })
      .select("id")
      .single();
    if (insErr) return { error: insErr.message };
    copiedCount++;
    if (inserted?.id) rootMap.set(root.id, inserted.id);
  }

  const existingChildrenByParent = new Map<string, Set<string>>();
  for (const c of targetExisting ?? []) {
    if (!c.parent_id) continue;
    const key = c.parent_id;
    if (!existingChildrenByParent.has(key)) existingChildrenByParent.set(key, new Set());
    existingChildrenByParent.get(key)!.add(c.name.trim().toLowerCase());
  }

  for (const child of sourceChildren ?? []) {
    const targetParentId = rootMap.get(child.parent_id);
    if (!targetParentId) continue;
    const key = child.name.trim().toLowerCase();
    const set = existingChildrenByParent.get(targetParentId) ?? new Set<string>();
    if (set.has(key)) continue;
    const { error: childErr } = await supabase.from("categories").insert({
      wallet_id: params.target_wallet_id,
      name: child.name,
      type: params.type,
      parent_id: targetParentId,
      created_by: user.id,
      is_active: true,
    });
    if (childErr) return { error: childErr.message };
    set.add(key);
    existingChildrenByParent.set(targetParentId, set);
    copiedCount++;
  }

  await logActivity(supabase, {
    action: "category_copy",
    entity_type: "category",
    wallet_id: params.target_wallet_id,
    payload: {
      source_wallet_id: params.source_wallet_id,
      type: params.type,
      copied_count: copiedCount,
    },
  });

  return { copiedCount };
}
