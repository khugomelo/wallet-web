"use client";

import {
  getSettlementsDisplayOptions,
  getSettlementsOrder,
  saveSettlementsDisplayOptions,
  saveSettlementsOrder,
  type SettlementsDisplayOptions,
} from "@/app/actions/preferences";
import {
  confirmSettlementTransfer,
  getMemberIncomeExpenseSeries,
  getTransactionsByMember,
  type MemberIncomeExpensePoint,
  type TransactionByMemberRow,
} from "@/app/actions/wallets";
import { TransactionTypeIcon } from "@/components/ActionIcons";
import { AvatarImage } from "@/components/AvatarImage";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TransactionRowActions } from "@/components/TransactionRowActions";
import { useToast } from "@/contexts/ToastContext";
import { formatCategorySubcategory } from "@/lib/transaction-labels";
import { transactionRowBgClass } from "@/lib/transaction-row-style";
import {
  balanceSheetToolbarIconButtonClass,
  balanceSheetToolbarIconButtonOpenClass,
} from "@/lib/balance-sheet-toolbar-icons";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Settlement = {
  member_id: string;
  email: string;
  avatar_url: string | null;
  total_paid: number;
  total_share: number;
  monthly_income: number;
  monthly_paid: number;
  balance: number;
};

type Props = {
  settlements: Settlement[];
  splitType: string | null;
  walletId: string;
  periodType: "monthly" | "yearly";
  periodStart: string;
  periodEnd: string;
  headerControl?: ReactNode;
};

type SettlementFlow = {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  amountCents: number;
};

const STORAGE_KEY_HIDE_SETTLEMENTS = "j-wallet-hide-settlements";
const DEFAULT_DISPLAY: SettlementsDisplayOptions = {
  showUserPhoto: true,
};
type RangeKey = "thisMonth" | "thisYear" | "custom";
const RANGE_OPTIONS: { key: RangeKey; labelKey: string }[] = [
  { key: "thisYear", labelKey: "thisYear" },
  { key: "thisMonth", labelKey: "thisMonth" },
  { key: "custom", labelKey: "custom" },
];

function sortByOrder<T extends { member_id: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return [...items];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? 1e9 : i;
  };
  return [...items].sort((a, b) => rank(a.member_id) - rank(b.member_id));
}

function DragHandleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-slate-400"
      aria-hidden
    >
      <line x1="8" y1="6" x2="8" y2="18" />
      <line x1="12" y1="6" x2="12" y2="18" />
      <line x1="16" y1="6" x2="16" y2="18" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  if (hidden) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.576 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
        <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
        <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-4.963" />
        <path d="m2 2 20 20" />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function OptionsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

type MemberTxState = {
  transactions: TransactionByMemberRow[];
  full: boolean;
  loading: boolean;
};

export function SettlementsSection({
  settlements,
  splitType: _splitType,
  walletId,
  periodType,
  periodStart,
  periodEnd,
  headerControl,
}: Props) {
  const t = useTranslations("home.settlements");
  const locale = useLocale();
  const router = useRouter();
  const { showToast } = useToast();
  const formatAmount = (value: number) =>
    value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const [mounted, setMounted] = useState(false);
  const [hideBalances, setHideBalances] = useState(false);
  const [savedOrder, setSavedOrder] = useState<string[]>([]);
  const [editOrder, setEditOrder] = useState<string[] | null>(null);
  const [orderEditing, setOrderEditing] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transactionsByMember, setTransactionsByMember] = useState<Record<string, MemberTxState>>({});
  const [displayOpts, setDisplayOpts] = useState<SettlementsDisplayOptions>(DEFAULT_DISPLAY);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const optionsPopRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  const [chartMemberId, setChartMemberId] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<RangeKey>("thisYear");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [series, setSeries] = useState<MemberIncomeExpensePoint[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [modalTransactions, setModalTransactions] = useState<TransactionByMemberRow[]>([]);
  const [modalTransactionsLoading, setModalTransactionsLoading] = useState(false);
  const [showModalTransactions, setShowModalTransactions] = useState(false);
  const [modalFilter, setModalFilter] = useState<"day" | "period" | "all">("period");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [confirmFlow, setConfirmFlow] = useState<SettlementFlow | null>(null);
  const [confirmingFlow, setConfirmingFlow] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HIDE_SETTLEMENTS);
      setHideBalances(raw === "true");
    } catch {
      setHideBalances(false);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPrefsLoaded(false);
    Promise.all([
      getSettlementsOrder(walletId),
      getSettlementsDisplayOptions(walletId),
    ]).then(([order, opts]) => {
      if (cancelled) return;
      setSavedOrder(order);
      setEditOrder(null);
      setDisplayOpts(opts);
      setPrefsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [walletId]);

  useEffect(() => {
    setExpandedId(null);
    setTransactionsByMember({});
  }, [walletId, periodType, periodStart, periodEnd]);

  const startReorder = useCallback(() => {
    const ids = savedOrder.length
      ? savedOrder.filter((id) => settlements.some((s) => s.member_id === id))
      : settlements.map((s) => s.member_id);
    const extra = settlements
      .filter((s) => !ids.includes(s.member_id))
      .map((s) => s.member_id);
    setEditOrder([...ids, ...extra]);
    setOrderEditing(true);
  }, [savedOrder, settlements]);

  const cancelReorder = useCallback(() => {
    setOrderEditing(false);
    setEditOrder(null);
    setDraggingId(null);
  }, []);

  const saveReorder = useCallback(async () => {
    if (!editOrder?.length) {
      setOrderEditing(false);
      return;
    }
    setSavingOrder(true);
    await saveSettlementsOrder(walletId, editOrder);
    setSavedOrder(editOrder);
    setSavingOrder(false);
    setOrderEditing(false);
    setEditOrder(null);
  }, [walletId, editOrder]);

  const toggleHide = useCallback(() => {
    setHideBalances((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_HIDE_SETTLEMENTS, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleOptions = useCallback(() => {
    setOptionsOpen((prev) => {
      if (!prev && optionsBtnRef.current) {
        const r = optionsBtnRef.current.getBoundingClientRect();
        setPopPos({ top: r.bottom + 6, left: r.right });
      }
      return !prev;
    });
  }, []);

  const toggleDisplayOpt = useCallback(
    (key: keyof SettlementsDisplayOptions) => {
      setDisplayOpts((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        void saveSettlementsDisplayOptions(walletId, next);
        return next;
      });
    },
    [walletId]
  );

  useEffect(() => {
    if (!optionsOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        optionsBtnRef.current?.contains(e.target as Node) ||
        optionsPopRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOptionsOpen(false);
    }
    function handleScroll() {
      setOptionsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [optionsOpen]);

  const chartMember = useMemo(
    () => settlements.find((s) => s.member_id === chartMemberId) ?? null,
    [settlements, chartMemberId]
  );

  const resolveRangeDates = useCallback(() => {
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    const fromDate = (d: Date) => d.toISOString().slice(0, 10);

    switch (chartRange) {
      case "thisMonth": {
        const d = new Date(today.getFullYear(), today.getMonth(), 1);
        return { from: fromDate(d), to: end };
      }
      case "thisYear": {
        const d = new Date(today.getFullYear(), 0, 1);
        return { from: fromDate(d), to: end };
      }
      case "custom":
        if (!customFrom || !customTo) return null;
        return { from: customFrom, to: customTo };
      default:
        return { from: undefined, to: undefined };
    }
  }, [chartRange, customFrom, customTo]);

  const activePeriod = useMemo(() => resolveRangeDates(), [resolveRangeDates]);

  const xAxisMonthTicks = useMemo(() => {
    if (series.length === 0) return [];
    const monthStarts: string[] = [];
    const seen = new Set<string>();
    for (const point of series) {
      const monthKey = point.date.slice(0, 7);
      if (!seen.has(monthKey) && point.date.endsWith("-01")) {
        seen.add(monthKey);
        monthStarts.push(point.date);
      }
    }
    const firstDate = series[0]?.date;
    if (firstDate) {
      const firstMonthKey = firstDate.slice(0, 7);
      if (!seen.has(firstMonthKey)) monthStarts.unshift(firstDate);
    }
    return monthStarts;
  }, [series]);

  const loadModalTransactions = useCallback(
    async (memberId: string, full: boolean, fromDate?: string, toDate?: string) => {
      setModalTransactionsLoading(true);
      const list = await getTransactionsByMember(walletId, memberId, {
        limit: full ? 0 : 5,
        fromDate,
        toDate,
      });
      setModalTransactions(list);
      setModalTransactionsLoading(false);
    },
    [walletId]
  );

  const openChart = useCallback((memberId: string) => {
    setChartMemberId(memberId);
    setChartRange("thisYear");
    setCustomFrom("");
    setCustomTo("");
    setSeries([]);
    setShowModalTransactions(true);
    setModalFilter("all");
    setSelectedDay(null);
    setModalTransactions([]);
    setModalTransactionsLoading(false);
  }, []);

  const applyModalFilter = useCallback(
    async (filter: "day" | "period" | "all", day?: string, full = false) => {
      if (!chartMemberId) return;
      let fromDate: string | undefined;
      let toDate: string | undefined;

      if (filter === "day" && day) {
        fromDate = day;
        toDate = day;
      }
      if (filter === "period") {
        const dates = resolveRangeDates();
        if (!dates) return;
        fromDate = dates.from;
        toDate = dates.to;
      }

      setModalFilter(filter);
      setSelectedDay(filter === "day" ? day ?? null : null);
      setShowModalTransactions(true);
      await loadModalTransactions(chartMemberId, full, fromDate, toDate);
    },
    [chartMemberId, resolveRangeDates, loadModalTransactions]
  );

  useEffect(() => {
    if (!chartMemberId) return;
    const dates = resolveRangeDates();
    if (!dates?.from || !dates?.to) return;
    setSeriesLoading(true);
    getMemberIncomeExpenseSeries(walletId, chartMemberId, dates.from, dates.to)
      .then((rows) => setSeries(rows))
      .finally(() => setSeriesLoading(false));
  }, [walletId, chartMemberId, resolveRangeDates]);

  useEffect(() => {
    if (!chartMemberId || !showModalTransactions || modalFilter !== "all") return;
    void applyModalFilter("all", undefined, true);
  }, [chartMemberId, showModalTransactions, modalFilter, applyModalFilter]);

  const handleConfirmSettlement = useCallback(async () => {
    if (!confirmFlow) return;
    setConfirmingFlow(true);
    const rawMonthLabel = new Intl.DateTimeFormat(locale, { month: "long" }).format(
      new Date(`${periodEnd}T00:00:00`)
    );
    const monthLabel = rawMonthLabel
      ? rawMonthLabel.charAt(0).toLocaleUpperCase(locale) + rawMonthLabel.slice(1)
      : rawMonthLabel;
    const settlementDescription = t("settlementDescription", { month: monthLabel });
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    // Settle inside the period being viewed: settling October on Nov 3 must land on Oct 31, not count toward November.
    const transactionDate = periodEnd < today ? periodEnd : today;
    const res = await confirmSettlementTransfer({
      walletId,
      payerMemberId: confirmFlow.fromId,
      receiverMemberId: confirmFlow.toId,
      amountCents: confirmFlow.amountCents,
      date: transactionDate,
      description: settlementDescription,
    });
    setConfirmingFlow(false);
    if (res.error) {
      showToast(res.error, "error");
      return;
    }
    setConfirmFlow(null);
    showToast(t("settlementConfirmedSuccess"));
    router.refresh();
  }, [confirmFlow, walletId, periodEnd, showToast, t, router, locale]);

  const activeOrder = orderEditing && editOrder ? editOrder : savedOrder;
  const sorted = useMemo(() => {
    const ordered = sortByOrder(settlements, activeOrder);
    return activeOrder.length ? ordered : [...ordered].sort((a, b) => b.balance - a.balance);
  }, [settlements, activeOrder]);
  const settlementNameById = useMemo(
    () => new Map(settlements.map((s) => [s.member_id, s.email])),
    [settlements]
  );
  const resolveMemberName = useCallback(
    (id: string | null, fallbackName: string) => {
      const trimmed = fallbackName.trim();
      if (!id) return trimmed || "—";
      if (trimmed && trimmed.toLowerCase() !== "member") return trimmed;
      return settlementNameById.get(id) ?? (trimmed || "—");
    },
    [settlementNameById]
  );

  const moveCard = useCallback((fromId: string, toId: string) => {
    setEditOrder((prev) => {
      const ids = prev ? [...prev] : settlements.map((s) => s.member_id);
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(toId);
      if (from === -1 || to === -1 || from === to) return ids;
      const [item] = ids.splice(from, 1);
      ids.splice(to, 0, item);
      return ids;
    });
  }, [settlements]);

  const loadTransactions = useCallback(
    async (memberId: string, limit: number) => {
      setTransactionsByMember((prev) => ({
        ...prev,
        [memberId]: {
          transactions: prev[memberId]?.transactions ?? [],
          full: limit === 0,
          loading: true,
        },
      }));
      const list = await getTransactionsByMember(walletId, memberId, {
        limit: limit || undefined,
        fromDate: periodStart,
        toDate: periodEnd,
      });
      setTransactionsByMember((prev) => ({
        ...prev,
        [memberId]: {
          transactions: list,
          full: limit === 0,
          loading: false,
        },
      }));
    },
    [walletId, periodStart, periodEnd]
  );

  const toggleExpand = useCallback(
    (memberId: string) => {
      if (expandedId === memberId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(memberId);
      const state = transactionsByMember[memberId];
      if (!state?.transactions?.length && !state?.loading) {
        void loadTransactions(memberId, 5);
      }
    },
    [expandedId, transactionsByMember, loadTransactions]
  );

  const handleSeeAll = useCallback(
    (memberId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const state = transactionsByMember[memberId];
      void loadTransactions(memberId, state?.full ? 5 : 0);
    },
    [transactionsByMember, loadTransactions]
  );

  const settlementFlows = useMemo<SettlementFlow[]>(() => {
    const creditors = settlements
      .filter((s) => s.balance > 0)
      .map((s) => ({ memberId: s.member_id, name: s.email, remaining: Math.round(s.balance) }))
      .sort((a, b) => b.remaining - a.remaining);
    const debtors = settlements
      .filter((s) => s.balance < 0)
      .map((s) => ({ memberId: s.member_id, name: s.email, remaining: Math.round(Math.abs(s.balance)) }))
      .sort((a, b) => b.remaining - a.remaining);

    const flows: SettlementFlow[] = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const amount = Math.min(debtor.remaining, creditor.remaining);
      if (amount > 0) {
        flows.push({
          fromId: debtor.memberId,
          toId: creditor.memberId,
          fromName: debtor.name,
          toName: creditor.name,
          amountCents: amount,
        });
        debtor.remaining -= amount;
        creditor.remaining -= amount;
      }
      if (debtor.remaining <= 0) i += 1;
      if (creditor.remaining <= 0) j += 1;
    }
    return flows;
  }, [settlements]);

  if (!settlements || settlements.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
        <h3 className="text-lg font-semibold mb-4">{t("title")}</h3>
        <p className="text-slate-600 dark:text-slate-400">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("title")}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("subtitle")}</p>
        </div>
        {mounted && prefsLoaded && (
          <div className="flex items-center gap-2">
            {headerControl}
            <button
              type="button"
              onClick={toggleHide}
              className={balanceSheetToolbarIconButtonClass}
              aria-label={hideBalances ? t("showBalances") : t("hideBalances")}
              title={hideBalances ? t("showBalances") : t("hideBalances")}
            >
              <EyeIcon hidden={hideBalances} />
            </button>
            {orderEditing ? (
              <>
                <button
                  type="button"
                  onClick={saveReorder}
                  disabled={savingOrder}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-green-300 bg-green-50 text-green-800 hover:bg-green-100 disabled:opacity-50"
                >
                  {savingOrder ? t("saving") : t("saveOrder")}
                </button>
                <button
                  type="button"
                  onClick={cancelReorder}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                >
                  {t("cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startReorder}
                className={balanceSheetToolbarIconButtonClass}
                aria-label={t("reorderUsers")}
                title={t("reorderUsers")}
              >
                <DragHandleIcon />
              </button>
            )}
            <button
              ref={optionsBtnRef}
              type="button"
              onClick={toggleOptions}
              className={optionsOpen ? balanceSheetToolbarIconButtonOpenClass : balanceSheetToolbarIconButtonClass}
              aria-label={t("displayOptions")}
              title={t("displayOptions")}
            >
              <OptionsIcon />
            </button>
          </div>
        )}
      </div>

      {!prefsLoaded ? (
        <div className="h-48 flex items-center justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" aria-hidden />
        </div>
      ) : (
      <div className="space-y-3">
        {sorted.map((settlement) => {
          const state = transactionsByMember[settlement.member_id];
          const txLoading = state?.loading ?? false;
          const txRows = state?.transactions ?? [];
          const txFull = state?.full ?? false;
          const isExpanded = expandedId === settlement.member_id;
          const balanceClass =
            settlement.balance > 0
              ? "text-green-600 dark:text-green-400"
              : settlement.balance < 0
                ? "text-red-600 dark:text-red-400"
                : "text-slate-600 dark:text-slate-400";
          const balanceLabel =
            settlement.balance > 0
              ? t("toReceive")
              : settlement.balance < 0
                ? t("toPay")
                : t("settled");
          return (
            <Fragment key={settlement.member_id}>
              <div
                draggable={orderEditing}
                onDragStart={() => setDraggingId(settlement.member_id)}
                onDragOver={(e) => {
                  if (!orderEditing) return;
                  e.preventDefault();
                }}
                onDrop={() => {
                  if (!orderEditing || !draggingId) return;
                  moveCard(draggingId, settlement.member_id);
                  setDraggingId(null);
                }}
                className="rounded-lg bg-slate-50 dark:bg-slate-700/50 p-3 space-y-1.5"
              >
                <div className="grid grid-cols-[minmax(180px,1fr)_130px_130px_140px_52px] items-center gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {displayOpts.showUserPhoto && (
                      <AvatarImage
                        src={settlement.avatar_url}
                        size={22}
                        className="h-[22px] w-[22px] rounded-full object-cover shrink-0"
                        fallback={
                          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M20 21a8 8 0 0 0-16 0" />
                              <circle cx="12" cy="8" r="4" />
                            </svg>
                          </span>
                        }
                      />
                    )}
                    <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{settlement.email}</p>
                    {orderEditing && <span className="text-slate-500"><DragHandleIcon /></span>}
                  </div>
                  <div className="text-right min-w-0">
                    <p className="text-[11px] leading-none text-slate-500 dark:text-slate-400 mb-1">{t("incomesLabel")}</p>
                    <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                      {hideBalances ? "••••" : `${formatAmount(settlement.monthly_income / 100)} €`}
                    </p>
                  </div>
                  <div className="text-right min-w-0">
                    <p className="text-[11px] leading-none text-slate-500 dark:text-slate-400 mb-1">{t("expensesLabel")}</p>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                      {hideBalances ? "••••" : `${formatAmount(settlement.monthly_paid / 100)} €`}
                    </p>
                  </div>
                  <div className="text-right min-w-0">
                    <p className="text-[11px] leading-none text-slate-500 dark:text-slate-400 mb-1">{balanceLabel}</p>
                    <p className={`text-base font-semibold ${balanceClass}`}>
                      {hideBalances ? "••••" : `${settlement.balance > 0 ? "+" : ""}${formatAmount(settlement.balance / 100)} €`}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => openChart(settlement.member_id)}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500"
                      aria-label={t("viewIncomeExpenseEvolution")}
                      title={t("viewIncomeExpenseEvolution")}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M3 3v18h18" />
                        <path d="m19 9-5 5-4-4-3 3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleExpand(settlement.member_id)}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500"
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? t("collapse") : t("expand")}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        aria-hidden
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              {isExpanded && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
                  {txLoading && txRows.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-500">{t("loading")}</p>
                  ) : txRows.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-500">{t("noTransactionsForUser")}</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 dark:bg-slate-800">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300 w-10">{t("tableType")}</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("tableDate")}</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("tableDescription")}</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("tableCategory")}</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">{t("tableAmount")}</th>
                          <th className="px-3 py-2 w-20" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {txRows.map((row) => (
                          <tr key={row.id} className={transactionRowBgClass(row.type)}>
                            <td className="px-3 py-2">
                              <TransactionTypeIcon type={row.type} />
                            </td>
                            <td className="px-3 py-2">{row.date}</td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-[180px] truncate">
                              <span className="block truncate">{row.description || "—"}</span>
                              {row.type === "transfer" && (
                                <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {row.paidByMemberId === settlement.member_id
                                    ? t("transferredTo", {
                                      member: resolveMemberName(row.receivedByMemberId, row.receivedByName),
                                    })
                                    : t("transferredFrom", {
                                      member: resolveMemberName(row.paidByMemberId, row.paidByName),
                                    })}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                              {formatCategorySubcategory(row.categoryLabel, row.subcategoryLabel)}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums ${row.type === "income"
                              ? "text-green-600 dark:text-green-400"
                              : row.type === "expense"
                                ? "text-red-600 dark:text-red-400"
                                : row.paidByMemberId === settlement.member_id
                                  ? "text-red-600 dark:text-red-400"
                                  : row.receivedByMemberId === settlement.member_id
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-blue-600 dark:text-blue-400"
                              }`}>
                              {hideBalances
                                ? "••••"
                                : `${row.type === "income"
                                  ? "+"
                                  : row.type === "expense"
                                    ? "−"
                                    : row.type === "transfer"
                                      ? row.paidByMemberId === settlement.member_id
                                        ? "−"
                                        : row.receivedByMemberId === settlement.member_id
                                          ? "+"
                                          : ""
                                      : ""
                                  }${formatAmount(row.amount)} €`}
                            </td>
                            <td className="px-3 py-2">
                              <TransactionRowActions
                                id={row.id}
                                status={row.status}
                                holdBalance={row.holdBalance}
                                showEdit={row.status === "pending"}
                                onAfterAction={() => loadTransactions(settlement.member_id, txFull ? 0 : 5)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {!txLoading && txRows.length > 0 && (
                    <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={(e) => handleSeeAll(settlement.member_id, e)}
                        className="text-xs px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        {txFull ? t("showLess") : t("seeAll")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      )}

      <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/30 p-4">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("whoPaysWhom")}</h4>
        {settlementFlows.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t("allSettledNow")}</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {settlementFlows.map((flow, idx) => (
              <div
                key={`${flow.fromId}-${flow.toId}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  {t("payFlow", {
                    from: flow.fromName,
                    to: flow.toName,
                    amount: hideBalances ? "••••" : `${formatAmount(flow.amountCents / 100)} €`,
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmFlow(flow)}
                  className="text-[11px] px-2.5 py-1 rounded border border-green-300 bg-green-50 text-green-800 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/30 dark:text-green-200 dark:hover:bg-green-900/50"
                >
                  {t("confirmSettlement")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!confirmFlow}
        onClose={() => !confirmingFlow && setConfirmFlow(null)}
        onConfirm={handleConfirmSettlement}
        title={t("confirmSettlementTitle")}
        message={
          confirmFlow
            ? t("confirmSettlementMessage", {
              from: confirmFlow.fromName,
              to: confirmFlow.toName,
              amount: `${formatAmount(confirmFlow.amountCents / 100)} €`,
            })
            : ""
        }
        confirmLabel={t("confirmSettlement")}
        cancelLabel={t("cancel")}
        variant="confirm"
        loading={confirmingFlow}
      />
      {chartMemberId &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-start justify-center p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            onClick={() => setChartMemberId(null)}
          >
            <div className="absolute inset-0 bg-slate-900/50" />
            <div
              className="relative w-full max-w-5xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-6 text-[11px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{chartMember?.email ?? t("memberEvolution")}</h3>
                  <p className="text-sm text-slate-500">{t("memberEvolutionSubtitle")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setChartMemberId(null)}
                  className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t("close")}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-4">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setChartRange(opt.key)}
                    className={
                      "rounded-lg px-3 py-1.5 text-[11px] border " +
                      (chartRange === opt.key
                        ? "border-slate-700 bg-slate-900 text-white"
                        : "border-slate-200 dark:border-slate-700 text-slate-600")
                    }
                  >
                    {t(`ranges.${opt.labelKey}`)}
                  </button>
                ))}
                {chartRange === "custom" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px]"
                    />
                    <span className="text-[11px] text-slate-500">{t("to")}</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px]"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                {seriesLoading ? (
                  <div className="h-64 flex items-center justify-center text-slate-500">
                    {t("loadingEvolution")}
                  </div>
                ) : series.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-slate-500">
                    {t("noSeriesData")}
                  </div>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={series}
                        margin={{ top: 8, right: 22, left: 14, bottom: 4 }}
                        onClick={(e) => {
                          const label = (e as { activeLabel?: string } | null)?.activeLabel;
                          if (label) void applyModalFilter("day", label, true);
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          ticks={xAxisMonthTicks}
                          tickFormatter={(v) =>
                            new Date(`${String(v)}T00:00:00`).toLocaleDateString(locale, {
                              month: "2-digit",
                              year: "2-digit",
                            })
                          }
                          tick={{ fontSize: 10 }}
                          interval={0}
                          minTickGap={24}
                          padding={{ left: 8, right: 8 }}
                        />
                        <YAxis
                          tickFormatter={(v: number) => `${formatAmount(v)} €`}
                          width={80}
                          tick={{ fontSize: 10 }}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            `${formatAmount(value)} €`,
                            name === "income" ? t("incomesLabel") : t("expensesLabel"),
                          ]}
                          labelFormatter={(label) => String(label)}
                          itemStyle={{ fontSize: 11 }}
                          labelStyle={{ fontSize: 11 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="income"
                          stroke="#16a34a"
                          strokeWidth={2}
                          dot={false}
                          name="income"
                        />
                        <Line
                          type="monotone"
                          dataKey="expense"
                          stroke="#dc2626"
                          strokeWidth={2}
                          dot={false}
                          name="expense"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="mt-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t("transactions")}</h4>
                    {modalFilter === "day" && selectedDay && (
                      <p className="text-xs text-slate-500">
                        {t("day", { date: new Date(selectedDay).toLocaleDateString(locale) })}
                      </p>
                    )}
                    {modalFilter === "period" && showModalTransactions && activePeriod && (
                      <p className="text-xs text-slate-500">
                        {t("period", { from: activePeriod.from ?? "—", to: activePeriod.to ?? "—" })}
                      </p>
                    )}
                    {modalFilter === "all" && showModalTransactions && (
                      <p className="text-xs text-slate-500">{t("allTransactions")}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void applyModalFilter("period", undefined, true)}
                      className="text-[11px] px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                    >
                      {t("showPeriod")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyModalFilter("all", undefined, true)}
                      className="text-[11px] px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                    >
                      {t("showAll")}
                    </button>
                  </div>
                </div>

                {modalTransactionsLoading ? (
                  <p className="text-xs text-slate-500">{t("loading")}</p>
                ) : modalTransactions.length === 0 ? (
                  <p className="text-xs text-slate-500">{t("noTransactionsForUser")}</p>
                ) : (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
                    <table className="w-full text-[11px] min-w-[640px]">
                      <thead className="bg-slate-100 dark:bg-slate-800">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-slate-600 dark:text-slate-300 w-10">{t("tableType")}</th>
                          <th className="px-4 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("tableDate")}</th>
                          <th className="px-4 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("tableDescription")}</th>
                          <th className="px-4 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("tableCategory")}</th>
                          <th className="px-4 py-2 text-right font-medium text-slate-600 dark:text-slate-300">{t("tableAmount")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {modalTransactions.map((row) => (
                          <tr key={row.id} className={transactionRowBgClass(row.type)}>
                            <td className="px-4 py-2">
                              <TransactionTypeIcon type={row.type} />
                            </td>
                            <td className="px-4 py-2">{row.date}</td>
                            <td className="px-4 py-2 text-slate-700 dark:text-slate-300 max-w-[260px] truncate">
                              <span className="block truncate">{row.description || "—"}</span>
                              {row.type === "transfer" && (
                                <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {row.paidByMemberId === chartMemberId
                                    ? t("transferredTo", {
                                      member: resolveMemberName(row.receivedByMemberId, row.receivedByName),
                                    })
                                    : t("transferredFrom", {
                                      member: resolveMemberName(row.paidByMemberId, row.paidByName),
                                    })}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-slate-600 dark:text-slate-400 max-w-[220px] truncate">
                              {formatCategorySubcategory(row.categoryLabel, row.subcategoryLabel)}
                            </td>
                            <td className={`px-4 py-2 text-right tabular-nums ${row.type === "income"
                              ? "text-green-600 dark:text-green-400"
                              : row.type === "expense"
                                ? "text-red-600 dark:text-red-400"
                                : row.paidByMemberId === chartMemberId
                                  ? "text-red-600 dark:text-red-400"
                                  : row.receivedByMemberId === chartMemberId
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-blue-600 dark:text-blue-400"
                              }`}>
                              {hideBalances
                                ? "••••"
                                : `${row.type === "income"
                                  ? "+"
                                  : row.type === "expense"
                                    ? "−"
                                    : row.type === "transfer"
                                      ? row.paidByMemberId === chartMemberId
                                        ? "−"
                                        : row.receivedByMemberId === chartMemberId
                                          ? "+"
                                          : ""
                                      : ""
                                  }${formatAmount(row.amount)} €`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
      {optionsOpen &&
        popPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={optionsPopRef}
            className="fixed z-[9999] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-4 w-64"
            style={{ top: popPos.top, left: popPos.left, transform: "translateX(-100%)" }}
          >
            <h3 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-200">
              {t("displayOptions")}
            </h3>
            <label className="flex items-center gap-3 cursor-pointer py-1.5">
              <input
                type="checkbox"
                checked={displayOpts.showUserPhoto}
                onChange={() => toggleDisplayOpt("showUserPhoto")}
                className="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">
                {t("showUserPhoto")}
              </span>
            </label>
          </div>,
          document.body
        )}
    </div>
  );
}
