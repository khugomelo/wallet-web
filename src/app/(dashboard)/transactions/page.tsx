/** Transactions hub: movements, pending confirmations, and recurring rules (RSC, force-dynamic). */
import { createClient } from "@/lib/supabase/server";
import { getWalletCookie } from "@/app/actions/wallet-cookie";
import { getActiveWalletContext } from "@/lib/active-wallet-server";
import { ensureRecurringGenerated } from "@/app/actions/transactions";
import { PendingSection, type PendingRow } from "@/components/PendingSection";
import { RecurringSection, type RecurringRow } from "@/components/RecurringSection";
import { TransactionsTabs } from "@/components/TransactionsTabs";
import {
  getIncomeReceiverMemberIdsForOrFilter,
  transactionsForWalletOrReceiverUserIncomes,
} from "@/lib/income-scope";
import {
  mapHubTransactionRowsToDisplay,
  TRANSACTIONS_HUB_CONFIRMED_PAGE_SIZE,
  type HubTxDisplay,
  type HubTxRow,
} from "@/lib/transactions-hub-row-mapper";
import { workDayDateInMonth } from "@/lib/recurrence";
import { DashboardPageHeader } from "@/components/DashboardPageHeader";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
    const t = await getTranslations("transactions");
    const supabase = await createClient();
    const cookie = await getWalletCookie();
    const { currentWalletId } = await getActiveWalletContext(supabase, cookie);

    let transactions: HubTxDisplay[] = [];
    let pending: PendingRow[] = [];
    let recurring: RecurringRow[] = [];
    let isSplitWallet = false;
    let confirmedHubHasMore = false;

    if (currentWalletId) {
        await ensureRecurringGenerated(currentWalletId);
        const {
            data: { user },
        } = await supabase.auth.getUser();

        const incomeReceiverIds =
            user?.id != null
                ? await getIncomeReceiverMemberIdsForOrFilter(supabase, currentWalletId, user.id)
                : [];

        const pendingTxQuery = supabase
            .from("transactions")
            .select(
                "id, wallet_id, date, type, amount, description, observations, is_essential, account_from_id, account_to_id, paid_by_member_id, status, hold_balance, " +
                "received_by_member_id, split_method_override, " +
                "category:categories(id, name, parent_id, is_essential)"
            )
            .eq("status", "pending")
            .order("date", { ascending: false })
            .order("created_at", { ascending: false });
        if (user?.id && incomeReceiverIds.length > 0) {
            pendingTxQuery.or(transactionsForWalletOrReceiverUserIncomes(currentWalletId, incomeReceiverIds));
        } else {
            pendingTxQuery.eq("wallet_id", currentWalletId);
        }

        const confirmedTxQuery = supabase
            .from("transactions")
            .select(
                "id, wallet_id, date, type, amount, description, observations, is_essential, account_from_id, account_to_id, paid_by_member_id, status, hold_balance, " +
                "received_by_member_id, split_method_override, " +
                "category:categories(id, name, parent_id, is_essential)"
            )
            .eq("status", "confirmed")
            .order("date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(TRANSACTIONS_HUB_CONFIRMED_PAGE_SIZE + 1);
        if (user?.id && incomeReceiverIds.length > 0) {
            confirmedTxQuery.or(transactionsForWalletOrReceiverUserIncomes(currentWalletId, incomeReceiverIds));
        } else {
            confirmedTxQuery.eq("wallet_id", currentWalletId);
        }

        const [
            { data: accs },
            { data: cats },
            { data: pendingTx },
            { data: confirmedTx },
            { data: rules },
            { data: walletInfo },
            { data: memberList },
        ] = await Promise.all([
            supabase.from("accounts").select("id, name").eq("wallet_id", currentWalletId),
            supabase.from("categories").select("id, name, parent_id").eq("wallet_id", currentWalletId),
            pendingTxQuery,
            confirmedTxQuery,
            supabase
                .from("recurring_rules")
                .select("id, type, amount, description, category_id, account_from_id, account_to_id, recurrence_type, interval_months, interval_days, work_day_index, next_run_date, is_active, end_date")
                .eq("wallet_id", currentWalletId)
                .order("next_run_date", { ascending: true }),
            supabase
                .from("wallets")
                .select("shared_option, split_type, default_split_method")
                .eq("id", currentWalletId)
                .single(),
            supabase
                .from("wallet_members")
                .select("user_id, member_name")
                .eq("wallet_id", currentWalletId),
        ]);
        const catIdToName = new Map((cats ?? []).map((c) => [c.id, c.name]));
        const accountsMap = new Map((accs ?? []).map((a) => [a.id, a.name]));

        const confirmedRaw = (confirmedTx ?? []) as unknown as HubTxRow[];
        confirmedHubHasMore = confirmedRaw.length > TRANSACTIONS_HUB_CONFIRMED_PAGE_SIZE;
        const confirmedSliced = confirmedHubHasMore
            ? confirmedRaw.slice(0, TRANSACTIONS_HUB_CONFIRMED_PAGE_SIZE)
            : confirmedRaw;
        const pendingRows = (pendingTx ?? []) as unknown as HubTxRow[];
        const rows = [...pendingRows, ...confirmedSliced];

        let walletSharedOption = walletInfo?.shared_option ?? null;
        if (typeof walletSharedOption === "string") {
            const normalized = walletSharedOption.trim().toLowerCase();
            if (normalized === "control") walletSharedOption = "track";
            else if (normalized === "split_equal") walletSharedOption = "split";
            else if (normalized === "split_income") walletSharedOption = "track_and_split";
            else walletSharedOption = normalized;
        }
        isSplitWallet =
            walletSharedOption === "split" ||
            walletSharedOption === "track_and_split" ||
            (!walletSharedOption && !!walletInfo?.split_type);

        const allTx = await mapHubTransactionRowsToDisplay(supabase, currentWalletId, rows, {
            accs: accs ?? [],
            cats: cats ?? [],
            walletInfo: walletInfo as {
                shared_option: string | null;
                split_type: string | null;
                default_split_method: string | null;
            } | null,
            memberList: (memberList ?? []) as { user_id: string; member_name: string | null }[],
        });
        transactions = allTx;
        pending = allTx
            .filter((t) => t.status === "pending")
            .map(
                ({
                    id,
                    date,
                    type,
                    amount,
                    description,
                    categoryLabel,
                    subcategoryLabel,
                    accountFromName,
                    accountToName,
                    holdBalance,
                    hasAttachment,
                    isEssential,
                    postedFromWalletName,
                }) => ({
                    id,
                    date,
                    type,
                    amount,
                    description,
                    categoryLabel,
                    subcategoryLabel,
                    accountFromName,
                    accountToName,
                    holdBalance,
                    hasAttachment,
                    isEssential,
                    postedFromWalletName,
                })
            );

        recurring = (rules ?? []).map((r) => {
            const cat = cats?.find((c) => c.id === r.category_id);
            const categoryLabel = cat
                ? (cat.parent_id ? (catIdToName.get(cat.parent_id) ?? cat.name) : cat.name)
                : "—";
            const subcategoryLabel = cat?.parent_id ? (cat.name ?? "—") : "—";
            const accountFromName = r.account_from_id ? (accountsMap.get(r.account_from_id) ?? "—") : "—";
            const accountToName = r.account_to_id ? (accountsMap.get(r.account_to_id) ?? "—") : "—";
            let repeatLabel: string;
            if (r.recurrence_type === "daily") repeatLabel = t("recurring.repeat.daily");
            else if (r.recurrence_type === "weekly") repeatLabel = t("recurring.repeat.weekly");
            else if (r.recurrence_type === "monthly") repeatLabel = t("recurring.repeat.monthly");
            else if (r.recurrence_type === "yearly") repeatLabel = t("recurring.repeat.yearly");
            else if (r.recurrence_type === "interval_days" && r.interval_days)
                repeatLabel = t("recurring.repeat.everyDays", { count: r.interval_days });
            else if (r.recurrence_type === "interval_months" && r.interval_months)
                repeatLabel = t("recurring.repeat.everyMonths", { count: r.interval_months });
            else if (r.recurrence_type === "monthly_nth_work_day" && r.work_day_index)
                repeatLabel = t("recurring.repeat.nthWorkDay", { count: r.work_day_index });
            else if (r.recurrence_type === "monthly_nth_last_work_day" && r.work_day_index)
                repeatLabel = t("recurring.repeat.nthLastWorkDay", { count: r.work_day_index });
            else repeatLabel = t("recurring.repeat.unknown", { value: String(r.recurrence_type) });
            const isWorkDay =
                r.recurrence_type === "monthly_nth_work_day" ||
                r.recurrence_type === "monthly_nth_last_work_day";
            let nextRunDate = String(r.next_run_date);
            if (isWorkDay && r.work_day_index) {
                const d = new Date(String(r.next_run_date) + "T12:00:00Z");
                const y = d.getUTCFullYear();
                const m = d.getUTCMonth();
                const wdType =
                    r.recurrence_type === "monthly_nth_work_day"
                        ? "monthly_nth_work_day"
                        : "monthly_nth_last_work_day";
                const computed = workDayDateInMonth(y, m, wdType, r.work_day_index);
                if (computed) nextRunDate = computed;
            }
            const endDate = r.end_date != null ? String(r.end_date) : null;
            const isStopped =
                !!endDate && String(r.next_run_date) > endDate;
            return {
                id: r.id,
                description: (r.description ?? "").trim() || "—",
                type: r.type,
                amount: Number(r.amount),
                categoryLabel,
                subcategoryLabel,
                accountFromName,
                accountToName,
                repeatLabel,
                nextRunDate,
                isActive: !!r.is_active,
                endDate,
                isStopped,
            };
        });
    }

    const confirmed = transactions
        .filter((t) => t.status === "confirmed")
        .map(
            ({
                id,
                date,
                type,
                amount,
                description,
                observations,
                categoryLabel,
                subcategoryLabel,
                accountFromName,
                accountToName,
                paidByMemberName,
                paidByMemberAvatar,
                receivedByMemberName,
                receivedByMemberAvatar,
                splitMethod,
                hasAttachment,
                isEssential,
                postedFromWalletName,
            }) => ({
                id,
                date,
                type,
                amount,
                description,
                observations,
                categoryLabel,
                subcategoryLabel,
                accountFromName,
                accountToName,
                paidByMemberName,
                paidByMemberAvatar,
                receivedByMemberName,
                receivedByMemberAvatar,
                splitMethod,
                hasAttachment,
                isEssential,
                postedFromWalletName,
            })
        );

    return (
        <div className="space-y-6">
            {!currentWalletId ? (
                <>
                    <DashboardPageHeader title={t("title")} description={t("subtitle")} />
                    <p className="text-slate-600 dark:text-slate-400">
                        {t("emptyWalletMessage")}
                    </p>
                </>
            ) : (
                <div className="space-y-8">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <DashboardPageHeader title={t("title")} description={t("subtitle")} />
                        <ExportCsvButton />
                    </div>
                    <TransactionsTabs
                        confirmed={confirmed}
                        pending={pending}
                        recurring={recurring}
                        isSplitOnly={isSplitWallet}
                        confirmedHubHasMore={confirmedHubHasMore}
                    />
                </div>
            )}
        </div>
    );
}
