"use server";

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getWalletCookie } from "@/app/actions/wallet-cookie";
import { getActiveWalletContext } from "@/lib/active-wallet-server";
import {
  getIncomeReceiverMemberIdsForOrFilter,
  transactionsForWalletOrReceiverUserIncomes,
} from "@/lib/income-scope";
import type { ConfirmedRow } from "@/components/AllTransactionsSection";
import {
  hubTxDisplayToConfirmedRow,
  mapHubTransactionRowsToDisplay,
  TRANSACTIONS_HUB_CONFIRMED_PAGE_SIZE,
  type HubTxRow,
} from "@/lib/transactions-hub-row-mapper";

const TX_SELECT =
  "id, wallet_id, date, type, amount, description, observations, is_essential, account_from_id, account_to_id, paid_by_member_id, status, hold_balance, " +
  "received_by_member_id, split_method_override, " +
  "category:categories(id, name, parent_id, is_essential)";

/**
 * Loads the next chunk of older confirmed transactions for the hub (same scope as the RSC page).
 */
export async function loadMoreHubConfirmedTransactions(offset: number): Promise<{
  rows: ConfirmedRow[];
  hasMore: boolean;
  error?: string;
}> {
  if (!Number.isFinite(offset) || offset < 0) {
    return { rows: [], hasMore: false, error: "invalid_offset" };
  }
  const supabase = await createClient();
  const cookie = await getWalletCookie();
  const { currentWalletId } = await getActiveWalletContext(cookie);
  if (!currentWalletId) {
    return { rows: [], hasMore: false, error: "no_wallet" };
  }
  const user = await getAuthUser();

  const incomeReceiverIds =
    user?.id != null
      ? await getIncomeReceiverMemberIdsForOrFilter(supabase, currentWalletId, user.id)
      : [];

  const pageSize = TRANSACTIONS_HUB_CONFIRMED_PAGE_SIZE;
  const fetchEnd = offset + pageSize; // exclusive upper bound for slice logic: fetch pageSize+1 via range inclusive

  const confirmedQuery = supabase
    .from("transactions")
    .select(TX_SELECT)
    .eq("status", "confirmed")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, fetchEnd);
  if (user?.id && incomeReceiverIds.length > 0) {
    confirmedQuery.or(transactionsForWalletOrReceiverUserIncomes(currentWalletId, incomeReceiverIds));
  } else {
    confirmedQuery.eq("wallet_id", currentWalletId);
  }

  const [{ data: accs }, { data: cats }, { data: txChunk }, { data: walletInfo }, { data: memberList }] =
    await Promise.all([
      supabase.from("accounts").select("id, name").eq("wallet_id", currentWalletId),
      supabase.from("categories").select("id, name, parent_id").eq("wallet_id", currentWalletId),
      confirmedQuery,
      supabase
        .from("wallets")
        .select("shared_option, split_type, default_split_method")
        .eq("id", currentWalletId)
        .single(),
      supabase.from("wallet_members").select("user_id, member_name").eq("wallet_id", currentWalletId),
    ]);

  const raw = (txChunk ?? []) as unknown as HubTxRow[];
  const hasMore = raw.length > pageSize;
  const rows = hasMore ? raw.slice(0, pageSize) : raw;

  const mapped = await mapHubTransactionRowsToDisplay(supabase, currentWalletId, rows, {
    accs: accs ?? [],
    cats: cats ?? [],
    walletInfo: walletInfo as {
      shared_option: string | null;
      split_type: string | null;
      default_split_method: string | null;
    } | null,
    memberList: (memberList ?? []) as { user_id: string; member_name: string | null }[],
  });

  return {
    rows: mapped.map(hubTxDisplayToConfirmedRow),
    hasMore,
  };
}
