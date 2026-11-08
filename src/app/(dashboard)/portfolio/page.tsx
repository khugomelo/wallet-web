/** Portfolio: balances, period selector, settlements for the active wallet (RSC). */
import { createClient } from "@/lib/supabase/server";
import { getWalletCookie } from "@/app/actions/wallet-cookie";
import { getActiveWalletContext } from "@/lib/active-wallet-server";
import { getActiveWallets } from "@/lib/request-cache";
import { ensureRecurringGenerated } from "@/app/actions/transactions";
import { getWalletSettlements } from "@/app/actions/wallets";
import { CurrentBalancesSection } from "@/components/CurrentBalancesSection";
import { PortfolioPeriodSelector } from "@/components/PortfolioPeriodSelector";
import { SettlementsSection } from "@/components/SettlementsSection";
import type { AccountType } from "@/lib/account-types";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function PortfolioPage({
    searchParams,
}: {
    searchParams?: { year?: string; month?: string; period?: string };
}) {
    const t = await getTranslations("portfolio");
    const supabase = await createClient();
    const cookie = await getWalletCookie();
    const { currentWalletId } = await getActiveWalletContext(cookie);

    let accounts: {
        id: string;
        name: string;
        account_type: AccountType;
        initial_balance: number;
        current_balance: number;
        last_update: string | null;
        plafond: number | null;
    }[] = [];
    let totalInitialBalance = 0;
    let totalBalance = 0;
    let pendingAmounts: Record<string, number> = {};
    let walletSharedOption: string | null = null;
    let walletSplitType: string | null = null;
    let walletName: string | null = null;
    let settlements: any[] = [];
    let availableYears: number[] = [new Date().getUTCFullYear()];

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    const requestedYear = Number(searchParams?.year);
    const requestedMonth = Number(searchParams?.month);
    const periodType: "monthly" | "yearly" =
        searchParams?.period === "yearly" ? "yearly" : "monthly";
    let activeYear = Number.isInteger(requestedYear) ? requestedYear : currentYear;
    let activeMonth =
        Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
            ? requestedMonth
            : currentMonth;

    if (currentWalletId) {
        // Recurring generation only adds held pending rows, which nothing below reads: run it alongside.
        const [, { data: accountsData }, walletList] = await Promise.all([
            ensureRecurringGenerated(currentWalletId),
            supabase
                .from("accounts")
                .select("id, name, account_type, initial_balance, current_balance, plafond")
                .eq("wallet_id", currentWalletId)
                .eq("is_active", true),
            getActiveWallets(),
        ]);
        const walletData = walletList.find((w) => w.id === currentWalletId);
        walletSharedOption = walletData?.shared_option ?? null;
        walletSplitType = walletData?.split_type ?? null;
        walletName = walletData?.name ?? null;

        const settlementsTask = (async () => {
            if (walletSharedOption === "split" || walletSharedOption === "track_and_split") {
                const [{ data: minTx }, { data: maxTx }] = await Promise.all([
                    supabase
                        .from("transactions")
                        .select("date")
                        .eq("wallet_id", currentWalletId)
                        .order("date", { ascending: true })
                        .limit(1),
                    supabase
                        .from("transactions")
                        .select("date")
                        .eq("wallet_id", currentWalletId)
                        .order("date", { ascending: false })
                        .limit(1),
                ]);
                const minYear = minTx?.[0]?.date ? Number(String(minTx[0].date).slice(0, 4)) : currentYear;
                const maxYear = maxTx?.[0]?.date ? Number(String(maxTx[0].date).slice(0, 4)) : currentYear;
                availableYears = Array.from({ length: Math.max(1, maxYear - minYear + 1) }, (_, i) => minYear + i);

                const selectedYearForWallet =
                    Number.isInteger(requestedYear) && availableYears.includes(requestedYear)
                        ? requestedYear
                        : currentYear;
                const selectedMonthForWallet =
                    Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
                        ? requestedMonth
                        : currentMonth;
                activeYear = selectedYearForWallet;
                activeMonth = selectedMonthForWallet;

                const { settlements: settle } = await getWalletSettlements(currentWalletId, {
                    year: selectedYearForWallet,
                    month: periodType === "monthly" ? selectedMonthForWallet : undefined,
                    granularity: periodType === "yearly" ? "year" : "month",
                });
                if (settle) {
                    settlements = settle;
                }
            }
        })();
        settlementsTask.catch(() => {}); // still rethrown by the await below; avoids an unhandled-rejection crash meanwhile

        const data = accountsData;
        const accountIds = (data ?? []).map((a) => a.id);

        const lastUpdates: Record<string, string | null> = {};
        let pendingRows: { type: string; amount: number; account_from_id: string | null; account_to_id: string | null }[] =
            [];

        if (accountIds.length > 0) {
            const [rpcRes, pendingRes] = await Promise.all([
                supabase.rpc("account_last_transaction_dates", {
                    p_wallet_id: currentWalletId,
                    p_account_ids: accountIds,
                }),
                supabase
                    .from("transactions")
                    .select("type, amount, account_from_id, account_to_id")
                    .eq("wallet_id", currentWalletId)
                    .eq("status", "pending")
                    .eq("hold_balance", false),
            ]);
            pendingRows = (pendingRes.data ?? []) as typeof pendingRows;

            if (!rpcRes.error && Array.isArray(rpcRes.data)) {
                for (const row of rpcRes.data as { account_id: string; last_date: string }[]) {
                    if (row.account_id) {
                        lastUpdates[row.account_id] = row.last_date ? String(row.last_date).slice(0, 10) : null;
                    }
                }
            }
        } else {
            const { data: pendingOnly } = await supabase
                .from("transactions")
                .select("type, amount, account_from_id, account_to_id")
                .eq("wallet_id", currentWalletId)
                .eq("status", "pending")
                .eq("hold_balance", false);
            pendingRows = (pendingOnly ?? []) as typeof pendingRows;
        }

        const pa: Record<string, number> = {};
        for (const tx of pendingRows) {
            const amt = Number(tx.amount);
            if (tx.type === "income" && tx.account_to_id) {
                pa[tx.account_to_id] = (pa[tx.account_to_id] ?? 0) + amt;
            } else if (tx.type === "expense" && tx.account_from_id) {
                pa[tx.account_from_id] = (pa[tx.account_from_id] ?? 0) - amt;
            } else if (tx.type === "transfer") {
                if (tx.account_from_id) pa[tx.account_from_id] = (pa[tx.account_from_id] ?? 0) - amt;
                if (tx.account_to_id) pa[tx.account_to_id] = (pa[tx.account_to_id] ?? 0) + amt;
            }
        }
        pendingAmounts = pa;

        accounts = (data ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            account_type: (a.account_type ?? "bank_account") as AccountType,
            initial_balance: Number(a.initial_balance),
            current_balance: Number(a.current_balance),
            last_update: lastUpdates[a.id] ?? null,
            plafond: a.plafond != null ? Number(a.plafond) : null,
        }));
        totalInitialBalance = accounts.reduce((s, a) => s + a.initial_balance, 0);
        totalBalance = accounts.reduce((s, a) => s + a.current_balance, 0);
        await settlementsTask;
    }

    const periodStart =
        periodType === "yearly"
            ? `${activeYear}-01-01`
            : `${activeYear}-${String(activeMonth).padStart(2, "0")}-01`;
    const periodEnd =
        periodType === "yearly"
            ? `${activeYear}-12-31`
            : `${activeYear}-${String(activeMonth).padStart(2, "0")}-${String(
                new Date(Date.UTC(activeYear, activeMonth, 0)).getUTCDate()
            ).padStart(2, "0")}`;

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-semibold">{t("title")}</h1>
                <p className="text-slate-600 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>

            {!currentWalletId ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-6 text-center">
                    <p className="text-slate-600 dark:text-slate-400 mb-4">
                        {t("emptyMessage")}
                    </p>
                    <Link
                        href="/wallets"
                        className="inline-block px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700"
                    >
                        {t("createWallet")}
                    </Link>
                </div>
            ) : (
                <>
                    {(walletSharedOption === "track" || walletSharedOption === "track_and_split") && (
                        <CurrentBalancesSection
                            accounts={accounts}
                            totalInitialBalance={totalInitialBalance}
                            totalBalance={totalBalance}
                            currentWalletId={currentWalletId}
                            walletName={walletName}
                            pendingAmounts={pendingAmounts}
                        />
                    )}
                    {(walletSharedOption === "split" || walletSharedOption === "track_and_split") && (
                        <>
                            <SettlementsSection
                                settlements={settlements}
                                splitType={walletSplitType}
                                walletId={currentWalletId}
                                periodType={periodType}
                                periodStart={periodStart}
                                periodEnd={periodEnd}
                                headerControl={
                                    (walletSharedOption === "split" || walletSharedOption === "track_and_split") ? (
                                        <PortfolioPeriodSelector
                                            years={availableYears}
                                            periodType={periodType}
                                            selectedYear={activeYear}
                                            selectedMonth={activeMonth}
                                        />
                                    ) : undefined
                                }
                            />
                        </>
                    )}
                </>
            )}
        </div>
    );
}
