"use server";

/** CSV export: confirmed expenses with each member's share "as if everyone had settled". */

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { expenseShares, type SplitMethod } from "@/lib/expense-shares";
import { expenseIsEffectivelyEssential } from "@/lib/expense-essential";
import { isSharedSplitWallet } from "@/lib/wallet-modes";
import type { Wallet } from "@/lib/types";

export type ExportExpenseRow = {
  walletName: string;
  date: string;
  description: string;
  total: number;
  category: string;
  subcategory: string;
  essential: boolean;
  paidBy: string;
  /** member id → share; empty for shared wallets that don't split. */
  shares: Record<string, number>;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 1000; // PostgREST default max rows per request

async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function monthEnd(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return `${isoDate.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export async function getExpensesForExport(params: {
  walletIds: string[];
  from: string;
  to: string;
}): Promise<{ members?: Array<{ id: string; name: string }>; rows?: ExportExpenseRow[]; error?: string }> {
  const { from, to } = params;
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return { error: "Invalid date range" };
  if (!params.walletIds.length) return { error: "Select at least one wallet" };

  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  try {
    // Only wallets the user belongs to.
    const { data: myMemberships, error: memErr } = await supabase
      .from("wallet_members")
      .select("wallet_id")
      .eq("user_id", user.id)
      .in("wallet_id", params.walletIds);
    if (memErr) return { error: memErr.message };
    const walletIds = (myMemberships ?? []).map((m) => m.wallet_id as string);
    if (!walletIds.length) return { error: "Not a member of the selected wallets" };

    const [{ data: wallets, error: wErr }, { data: members, error: mErr }] = await Promise.all([
      supabase.from("wallets").select("*").in("id", walletIds).eq("is_active", true),
      supabase.from("wallet_members").select("wallet_id, user_id, member_name, income_monthly").in("wallet_id", walletIds),
    ]);
    if (wErr) return { error: wErr.message };
    if (mErr) return { error: mErr.message };

    const allMemberIds = Array.from(new Set((members ?? []).map((m) => m.user_id as string)));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", allMemberIds);
    const profileName = new Map(
      (profiles ?? []).map((p) => [p.id as string, [p.first_name, p.last_name].filter(Boolean).join(" ").trim()])
    );
    const nameById = new Map<string, string>();
    for (const m of members ?? []) {
      if (!nameById.has(m.user_id)) nameById.set(m.user_id, profileName.get(m.user_id) || m.member_name || "Member");
    }

    // Incomes over whole months, so by-income shares match the settlement screen even for mid-month ranges.
    const incomeFrom = `${from.slice(0, 7)}-01`;
    const incomeTo = monthEnd(to);

    const rows: ExportExpenseRow[] = [];
    const usedMemberIds = new Set<string>();

    for (const wallet of (wallets ?? []) as Wallet[]) {
      const walletMembers = (members ?? []).filter((m) => m.wallet_id === wallet.id);
      const memberIds = walletMembers.map((m) => m.user_id as string);
      const isSplit = isSharedSplitWallet(wallet);

      const [expenses, categories] = await Promise.all([
        fetchAll<{
          id: string;
          date: string;
          amount: number;
          description: string | null;
          category_id: string;
          is_essential: boolean | null;
          paid_by_member_id: string | null;
          split_method_override: string | null;
        }>((a, b) =>
          supabase
            .from("transactions")
            .select("id, date, amount, description, category_id, is_essential, paid_by_member_id, split_method_override")
            .eq("wallet_id", wallet.id)
            .eq("type", "expense")
            .eq("status", "confirmed")
            .gte("date", from)
            .lte("date", to)
            .order("date", { ascending: true })
            .order("id", { ascending: true })
            .range(a, b)
        ),
        supabase.from("categories").select("id, name, parent_id, is_essential").eq("wallet_id", wallet.id),
      ]);
      if (categories.error) return { error: categories.error.message };
      const catById = new Map((categories.data ?? []).map((c) => [c.id as string, c]));

      const incomeByMonthAndMember = new Map<string, Map<string, number>>();
      const splitsByTx = new Map<string, Array<{ member_id: string; percentage: number }>>();
      if (isSplit && expenses.length) {
        const incomeCols = "date, amount, received_by_member_id";
        const [local, elsewhere] = await Promise.all([
          fetchAll<{ date: string; amount: number; received_by_member_id: string | null }>((a, b) =>
            supabase
              .from("transactions")
              .select(incomeCols)
              .eq("wallet_id", wallet.id)
              .eq("type", "income")
              .eq("status", "confirmed")
              .gte("date", incomeFrom)
              .lte("date", incomeTo)
              .order("id", { ascending: true })
              .range(a, b)
          ),
          fetchAll<{ date: string; amount: number; received_by_member_id: string | null }>((a, b) =>
            supabase
              .from("transactions")
              .select(incomeCols)
              .neq("wallet_id", wallet.id)
              .eq("type", "income")
              .eq("status", "confirmed")
              .eq("income_scope", "user")
              .in("received_by_member_id", memberIds)
              .gte("date", incomeFrom)
              .lte("date", incomeTo)
              .order("id", { ascending: true })
              .range(a, b)
          ),
        ]);
        for (const inc of [...local, ...elsewhere]) {
          const id = inc.received_by_member_id;
          if (!id || !memberIds.includes(id)) continue;
          const key = String(inc.date).slice(0, 7);
          const inner = incomeByMonthAndMember.get(key) ?? new Map<string, number>();
          inner.set(id, (inner.get(id) ?? 0) + Number(inc.amount ?? 0));
          incomeByMonthAndMember.set(key, inner);
        }

        // Chunk ids to keep the request URL short.
        const ids = expenses.map((e) => e.id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data: splits, error } = await supabase
            .from("transaction_splits")
            .select("transaction_id, member_id, percentage")
            .in("transaction_id", ids.slice(i, i + 200));
          if (error) return { error: error.message };
          for (const s of splits ?? []) {
            const arr = splitsByTx.get(s.transaction_id) ?? [];
            arr.push({ member_id: s.member_id, percentage: Number(s.percentage) });
            splitsByTx.set(s.transaction_id, arr);
          }
        }
      }

      const defaultMethod = (wallet.default_split_method ||
        (wallet.split_type === "by_income" ? "by_income" : "equally")) as SplitMethod;
      const configuredIncomeByMember = new Map<string, number>(
        walletMembers.map((m) => [m.user_id as string, Number(m.income_monthly ?? 0)])
      );

      for (const e of expenses) {
        const cat = catById.get(e.category_id);
        const parent = cat?.parent_id ? catById.get(cat.parent_id) : null;
        const amount = Number(e.amount);
        let shares = new Map<string, number>();
        if (isSplit) {
          shares = expenseShares({
            amount,
            date: String(e.date),
            method: (e.split_method_override as SplitMethod | null) || defaultMethod,
            memberIds,
            manualSplits: splitsByTx.get(e.id),
            incomeByMonthAndMember,
            configuredIncomeByMember,
          });
        } else if (memberIds.length === 1) {
          shares.set(memberIds[0], amount); // personal wallet: it's all yours
        }
        for (const id of Array.from(shares.keys())) usedMemberIds.add(id);

        const categoryName = parent?.name ?? cat?.name ?? "";
        rows.push({
          walletName: wallet.name,
          date: String(e.date).slice(0, 10),
          description: e.description ?? "",
          total: amount,
          category: categoryName,
          subcategory: cat?.parent_id ? cat.name : categoryName, // same as old sheets when there's no subcategory
          essential: expenseIsEffectivelyEssential("expense", e.is_essential, cat ?? null),
          paidBy: e.paid_by_member_id ? (nameById.get(e.paid_by_member_id) ?? "") : "",
          shares: Object.fromEntries(Array.from(shares, ([id, v]) => [id, Math.round(v * 100) / 100])),
        });
      }
    }

    // Current user first, then everyone else by name.
    const memberCols = Array.from(usedMemberIds)
      .map((id) => ({ id, name: nameById.get(id) ?? "Member" }))
      .sort((a, b) => (a.id === user.id ? -1 : b.id === user.id ? 1 : a.name.localeCompare(b.name)));

    return { members: memberCols, rows };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Export failed" };
  }
}
