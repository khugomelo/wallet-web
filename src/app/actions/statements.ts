"use server";

/** Yearly statements by category and savings/investment aggregates. */

import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
    getIncomeReceiverMemberIdsForOrFilter,
    transactionsForWalletOrReceiverUserIncomes,
} from "@/lib/income-scope";

type StatementRow = {
    category: string;
    subcategory: string | null;
    total: number;
    monthlyBreakdown: Record<string, number>;
    monthlyTransactions: Record<
        string,
        { id: string; date: string; description: string | null; amount: number }[]
    >;
    subcategories?: StatementRow[];
};

type StatementsResult = {
    income: StatementRow[];
    expenses: StatementRow[];
};

export type StatementsViewMode = "incomeExpenses" | "savingsInvestments";

type TransactionWithCategory = {
    id: string;
    date: string;
    type: string;
    amount: number;
    description: string | null;
    category_id?: string | null;
    category?: { id: string; name: string; parent_id: string | null } | null;
};

const SAVINGS_INVESTMENTS_CATEGORY_ALIASES = new Set([
    "savings",
    "saving",
    "investments",
    "investment",
    "poupancas",
    "poupanca",
    "investimentos",
    "investimento",
    "ahorros",
    "ahorro",
    "inversiones",
    "inversion",
    "epargne",
    "investissement",
    "investissements",
]);

function normalizeCategoryName(name: string | null | undefined): string {
    return (name || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function getSavingsInvestmentCategoryIds(
    categories: { id: string; name: string; parent_id: string | null }[]
): Set<string> {
    const categoryMap = buildCategoryMap(categories);
    const matchingIds = new Set<string>();
    for (const category of categories) {
        const normalizedCategory = normalizeCategoryName(category.name);
        const parentName = category.parent_id ? categoryMap.get(category.parent_id)?.name : null;
        const normalizedParent = normalizeCategoryName(parentName);
        if (
            SAVINGS_INVESTMENTS_CATEGORY_ALIASES.has(normalizedCategory) ||
            SAVINGS_INVESTMENTS_CATEGORY_ALIASES.has(normalizedParent)
        ) {
            matchingIds.add(category.id);
        }
    }
    return matchingIds;
}

function buildCategoryMap(categories: { id: string; name: string; parent_id: string | null }[]) {
    const categoryMap = new Map<string, { name: string; parent_id: string | null }>();
    categories.forEach((cat) => {
        categoryMap.set(cat.id, { name: cat.name, parent_id: cat.parent_id });
    });
    return categoryMap;
}

function getCategoryContext(
    transaction: TransactionWithCategory,
    categoryMap: Map<string, { name: string; parent_id: string | null }>
) {
    const categoryId = transaction.category?.id || transaction.category_id || "";
    const categoryName = transaction.category?.name || categoryMap.get(categoryId)?.name || "(Uncategorized)";
    const category = categoryMap.get(categoryId);
    let parentCategoryName = categoryName;
    let isSubcategory = false;

    if (category?.parent_id) {
        const parentCat = categoryMap.get(category.parent_id);
        if (parentCat) {
            parentCategoryName = parentCat.name;
            isSubcategory = true;
        }
    }

    return {
        categoryName,
        parentCategoryName,
        isSubcategory,
    };
}

function formatStatements(map: Map<string, StatementRow>) {
    const result: StatementRow[] = [];
    const processedCategories = new Set<string>();

    const parentCategories = new Map<string, StatementRow>();
    map.forEach((row) => {
        if (!row.subcategory && !processedCategories.has(row.category)) {
            parentCategories.set(row.category, row);
            processedCategories.add(row.category);
        }
    });

    parentCategories.forEach((parentRow, categoryName) => {
        const subcats: StatementRow[] = [];
        map.forEach((subRow) => {
            if (subRow.category === categoryName && subRow.subcategory) {
                subcats.push(subRow);
            }
        });

        if (subcats.length > 0) {
            (parentRow as StatementRow).subcategories = subcats;
        }
        result.push(parentRow);
    });

    map.forEach((row) => {
        if (row.subcategory && !parentCategories.has(row.category)) {
            const orphanedParent: StatementRow = {
                category: row.category,
                subcategory: null,
                total: 0,
                monthlyBreakdown: {},
                monthlyTransactions: {},
                subcategories: [],
            };

            map.forEach((subRow) => {
                if (subRow.category === row.category && subRow.subcategory) {
                    orphanedParent.subcategories?.push(subRow);
                    orphanedParent.total += subRow.total;
                    Object.keys(subRow.monthlyBreakdown).forEach((month) => {
                        orphanedParent.monthlyBreakdown[month] =
                            (orphanedParent.monthlyBreakdown[month] || 0) + subRow.monthlyBreakdown[month];
                    });
                    Object.keys(subRow.monthlyTransactions).forEach((month) => {
                        if (!orphanedParent.monthlyTransactions[month]) {
                            orphanedParent.monthlyTransactions[month] = [];
                        }
                        orphanedParent.monthlyTransactions[month].push(
                            ...subRow.monthlyTransactions[month]
                        );
                    });
                }
            });

            if (!processedCategories.has(row.category)) {
                result.push(orphanedParent);
                processedCategories.add(row.category);
            }
        }
    });

    return result;
}

function isSavingsOrInvestmentsCategory(
    transaction: TransactionWithCategory,
    categoryMap: Map<string, { name: string; parent_id: string | null }>
) {
    const { categoryName, parentCategoryName } = getCategoryContext(transaction, categoryMap);
    const normalizedCategory = normalizeCategoryName(categoryName);
    const normalizedParent = normalizeCategoryName(parentCategoryName);
    return (
        SAVINGS_INVESTMENTS_CATEGORY_ALIASES.has(normalizedCategory) ||
        SAVINGS_INVESTMENTS_CATEGORY_ALIASES.has(normalizedParent)
    );
}

export async function getStatementsByCategory(
    walletId: string,
    startDate: string,
    endDate: string
): Promise<StatementsResult> {
    const supabase = await createClient();
    const user = await getAuthUser();

    const catsPromise = supabase
        .from("categories")
        .select("id, name, parent_id")
        .eq("wallet_id", walletId);
    const receiverIdsPromise =
        user?.id != null
            ? getIncomeReceiverMemberIdsForOrFilter(supabase, walletId, user.id)
            : Promise.resolve(null as string[] | null);

    const [{ data: walletCategories }, receiverIds] = await Promise.all([catsPromise, receiverIdsPromise]);

    // Fetch all transactions for the wallet in the date range with category info
    // Exclude transfers - only show income and expense
    const txQuery = supabase
        .from("transactions")
        .select("id, date, type, amount, description, category_id, category:categories(id, name, parent_id)")
        .eq("status", "confirmed")
        .in("type", ["income", "expense"])
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false });
    if (user?.id && receiverIds) {
        txQuery.or(transactionsForWalletOrReceiverUserIncomes(walletId, receiverIds));
    } else {
        txQuery.eq("wallet_id", walletId);
    }

    const { data: transactions, error } = await txQuery;

    if (error) {
        console.error("Error fetching transactions:", error);
        return { income: [], expenses: [] };
    }

    const incomeMap = new Map<string, StatementRow>();
    const expenseMap = new Map<string, StatementRow>();

    // Build category map from wallet categories + any category/parent used by cross-wallet incomes.
    const categoryMap = buildCategoryMap(walletCategories || []);
    const categoryIdsNeeded = new Set<string>();
    (transactions as any as TransactionWithCategory[]).forEach((transaction) => {
        const categoryId = transaction.category?.id || transaction.category_id || "";
        if (categoryId) categoryIdsNeeded.add(categoryId);
        if (transaction.category?.parent_id) categoryIdsNeeded.add(transaction.category.parent_id);
    });
    const missingCategoryIds = Array.from(categoryIdsNeeded).filter((id) => !categoryMap.has(id));
    if (missingCategoryIds.length > 0) {
        const { data: extraCategories } = await supabase
            .from("categories")
            .select("id, name, parent_id")
            .in("id", missingCategoryIds);
        (extraCategories || []).forEach((cat) => {
            categoryMap.set(cat.id, { name: cat.name, parent_id: cat.parent_id });
        });
    }

    (transactions as any as TransactionWithCategory[]).forEach((transaction) => {
        const { categoryName, parentCategoryName, isSubcategory } = getCategoryContext(transaction, categoryMap);

        const monthKey = transaction.date.slice(0, 7); // YYYY-MM
        const map = transaction.type === "income" ? incomeMap : expenseMap;
        const key = isSubcategory ? `${parentCategoryName}|${categoryName}` : categoryName;

        if (!map.has(key)) {
            map.set(key, {
                category: parentCategoryName,
                subcategory: isSubcategory ? categoryName : null,
                total: 0,
                monthlyBreakdown: {},
                monthlyTransactions: {},
            });
        }

        const row = map.get(key)!;
        row.total += transaction.amount;
        row.monthlyBreakdown[monthKey] = (row.monthlyBreakdown[monthKey] || 0) + transaction.amount;
        if (!row.monthlyTransactions[monthKey]) {
            row.monthlyTransactions[monthKey] = [];
        }
        row.monthlyTransactions[monthKey].push({
            id: transaction.id,
            date: transaction.date,
            description: transaction.description,
            amount: transaction.amount,
        });
    });

    return {
        income: formatStatements(incomeMap),
        expenses: formatStatements(expenseMap),
    };
}

/** One server round-trip: years + tables for the resolved year (avoids sequential client waterfalls). */
export async function getStatementsPagePayload(
    walletId: string,
    viewMode: StatementsViewMode,
    selectedYear: number
): Promise<{
    years: number[];
    effectiveYear: number;
    dateRange: { start: string; end: string } | null;
    income: StatementRow[];
    expenses: StatementRow[];
    savingsInvestments: StatementRow[];
}> {
    const years = await getAvailableYears(walletId, viewMode);
    const currentYear = new Date().getFullYear();
    const effectiveYear = years.includes(selectedYear)
        ? selectedYear
        : years.includes(currentYear)
          ? currentYear
          : years[0] ?? currentYear;

    const dateRange = { start: `${effectiveYear}-01-01`, end: `${effectiveYear}-12-31` };

    if (viewMode === "incomeExpenses") {
        const data = await getStatementsByCategory(walletId, dateRange.start, dateRange.end);
        return {
            years,
            effectiveYear,
            dateRange,
            income: data.income,
            expenses: data.expenses,
            savingsInvestments: [],
        };
    }

    const savingsInvestments = await getSavingsInvestmentStatements(
        walletId,
        dateRange.start,
        dateRange.end
    );
    return {
        years,
        effectiveYear,
        dateRange,
        income: [],
        expenses: [],
        savingsInvestments,
    };
}

export async function getSavingsInvestmentStatements(
    walletId: string,
    startDate: string,
    endDate: string
): Promise<StatementRow[]> {
    const supabase = await createClient();
    const { data: allCategories, error: catError } = await supabase
        .from("categories")
        .select("id, name, parent_id")
        .eq("wallet_id", walletId);
    if (catError) {
        console.error("Error fetching categories for savings/investments:", catError);
        return [];
    }
    const categoryRows = (allCategories || []) as { id: string; name: string; parent_id: string | null }[];
    const matchingCategoryIds = Array.from(getSavingsInvestmentCategoryIds(categoryRows));
    if (matchingCategoryIds.length === 0) {
        return [];
    }
    const categoryMap = buildCategoryMap(categoryRows);
    const { data: transactions, error } = await supabase
        .from("transactions")
        .select("id, date, type, amount, description, category_id, category:categories(id, name, parent_id)")
        .eq("wallet_id", walletId)
        .eq("status", "confirmed")
        .eq("type", "transfer")
        .in("category_id", matchingCategoryIds)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false });

    if (error) {
        console.error("Error fetching savings/investments transactions:", error);
        return [];
    }

    const transferMap = new Map<string, StatementRow>();
    (transactions as unknown as TransactionWithCategory[]).forEach((transaction) => {
        const { categoryName, parentCategoryName, isSubcategory } = getCategoryContext(transaction, categoryMap);
        const monthKey = transaction.date.slice(0, 7);
        const key = isSubcategory ? `${parentCategoryName}|${categoryName}` : categoryName;

        if (!transferMap.has(key)) {
            transferMap.set(key, {
                category: parentCategoryName,
                subcategory: isSubcategory ? categoryName : null,
                total: 0,
                monthlyBreakdown: {},
                monthlyTransactions: {},
            });
        }

        const row = transferMap.get(key)!;
        row.total += transaction.amount;
        row.monthlyBreakdown[monthKey] = (row.monthlyBreakdown[monthKey] || 0) + transaction.amount;
        if (!row.monthlyTransactions[monthKey]) {
            row.monthlyTransactions[monthKey] = [];
        }
        row.monthlyTransactions[monthKey].push({
            id: transaction.id,
            date: transaction.date,
            description: transaction.description,
            amount: transaction.amount,
        });
    });

    return formatStatements(transferMap);
}

export async function getAvailableYears(
    walletId: string,
    mode: StatementsViewMode = "incomeExpenses"
): Promise<number[]> {
    const supabase = await createClient();
    const user = await getAuthUser();

    let transactions: { date: string }[] = [];
    let error: { message: string } | null = null;

    if (mode === "incomeExpenses") {
        const txMinQuery = supabase
            .from("transactions")
            .select("date")
            .eq("status", "confirmed")
            .in("type", ["income", "expense"])
            .order("date", { ascending: true })
            .limit(1);
        const txMaxQuery = supabase
            .from("transactions")
            .select("date")
            .eq("status", "confirmed")
            .in("type", ["income", "expense"])
            .order("date", { ascending: false })
            .limit(1);
        if (user?.id) {
            const receiverIds = await getIncomeReceiverMemberIdsForOrFilter(supabase, walletId, user.id);
            txMinQuery.or(transactionsForWalletOrReceiverUserIncomes(walletId, receiverIds));
            txMaxQuery.or(transactionsForWalletOrReceiverUserIncomes(walletId, receiverIds));
        } else {
            txMinQuery.eq("wallet_id", walletId);
            txMaxQuery.eq("wallet_id", walletId);
        }
        const [minRes, maxRes] = await Promise.all([txMinQuery, txMaxQuery]);
        error = minRes.error || maxRes.error;
        transactions = [
            ...((minRes.data as { date: string }[] | null) || []),
            ...((maxRes.data as { date: string }[] | null) || []),
        ];
    } else {
        const { data: catData, error: catError } = await supabase
            .from("categories")
            .select("id, name, parent_id")
            .eq("wallet_id", walletId);
        if (catError) {
            error = catError;
        } else {
            const matchingCategoryIds = Array.from(
                getSavingsInvestmentCategoryIds(
                    (catData || []) as { id: string; name: string; parent_id: string | null }[]
                )
            );
            if (matchingCategoryIds.length === 0) {
                transactions = [];
            } else {
                const [minRes, maxRes] = await Promise.all([
                    supabase
                        .from("transactions")
                        .select("date")
                        .eq("wallet_id", walletId)
                        .eq("status", "confirmed")
                        .eq("type", "transfer")
                        .in("category_id", matchingCategoryIds)
                        .order("date", { ascending: true })
                        .limit(1),
                    supabase
                        .from("transactions")
                        .select("date")
                        .eq("wallet_id", walletId)
                        .eq("status", "confirmed")
                        .eq("type", "transfer")
                        .in("category_id", matchingCategoryIds)
                        .order("date", { ascending: false })
                        .limit(1),
                ]);
                error = minRes.error || maxRes.error;
                transactions = [
                    ...((minRes.data as { date: string }[] | null) || []),
                    ...((maxRes.data as { date: string }[] | null) || []),
                ];
            }
        }
    }

    if (error || !transactions) {
        console.error("Error fetching transactions for years:", error);
        return [new Date().getFullYear()];
    }

    if (transactions.length === 0) {
        return [new Date().getFullYear()];
    }

    const years = transactions
        .map((t) => Number(t.date.slice(0, 4)))
        .filter((y) => Number.isFinite(y));
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) {
        return [new Date().getFullYear()];
    }
    const out: number[] = [];
    for (let y = maxYear; y >= minYear; y -= 1) out.push(y);
    return out;
}