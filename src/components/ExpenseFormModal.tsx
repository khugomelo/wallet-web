"use client";

import {
  getCategories,
  getCategoriesFlatForSearch,
  getSubcategories,
  getTransaction,
  getRecentTransactionsByType,
  getRecentTransactionsByCategory,
  createTransaction,
  updateTransaction,
  confirmTransaction,
  deleteTransaction,
  type CategoryFlatRow,
  type RecentSimilarRow,
  type TransactionDetail,
} from "@/app/actions/transactions";
import { uploadTransactionAttachment, type TransactionAttachmentRow } from "@/app/actions/transaction-attachments";
import { getWalletSplitInfo, getCurrentUserId } from "@/app/actions/wallets";
import { getCategory } from "@/app/actions/categories";
import { BalanceHint } from "@/components/BalanceHint";
import { CategorySubcategorySearchField } from "@/components/CategorySubcategorySearchField";
import { TransactionDateInput } from "@/components/TransactionDateInput";
import { TransactionObservationsAttachments } from "@/components/TransactionObservationsAttachments";
import { CategoryModal } from "@/components/CategoryModal";
import { getRecurringRule, type RecurringRuleRow } from "@/app/actions/recurring";
import { CopyIcon, TransactionTypeIcon } from "@/components/ActionIcons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/contexts/ToastContext";
import { useWallet } from "@/contexts/WalletContext";
import {
  type RecurrenceType,
  RECURRENCE_OPTIONS,
  isRecurrenceOptionSeparator,
} from "@/lib/recurrence";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TransactionModalMode } from "@/contexts/TransactionModalsContext";
import { useLocale, useTranslations } from "next-intl";
import {
  intlLocaleFromAppLocale,
  formatMoneyAmountTwoDecimals,
  normalizeMoneyInputString,
} from "@/lib/money-format";
import { EssentialTagToggle } from "@/components/EssentialTagToggle";
import { recurrenceOptionLabel } from "@/lib/recurrence-labels";
import { useTransactionModalReferenceData } from "@/hooks/useTransactionModalReferenceData";

type EssentialMode = "inherit" | "yes" | "no";

function dbToEssentialMode(v: boolean | null | undefined): EssentialMode {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "inherit";
}

function essentialModeToDb(mode: EssentialMode): boolean | null {
  if (mode === "inherit") return null;
  return mode === "yes";
}

type Props = {
  open: boolean;
  onClose: () => void;
  mode?: TransactionModalMode;
  transactionId?: string;
  copyFromTransactionId?: string;
  copyFromRecurringId?: string;
  prefetchedTransaction?: TransactionDetail | null;
  prefetchedRecurringRule?: RecurringRuleRow | null;
};

const inputClass =
  "w-full text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800";

const clampPct = (v: number) => Math.min(100, Math.max(0, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const formatPctInput = (v: number) => {
  const fixed = round2(v).toFixed(2);
  return fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed.endsWith("0") ? fixed.slice(0, -1) : fixed;
};

/** Expense modal: same mode matrix as income; includes essential tag and split fields. */
export function ExpenseFormModal({
  open,
  onClose,
  mode = "new",
  transactionId,
  copyFromTransactionId,
  copyFromRecurringId,
  prefetchedTransaction = null,
  prefetchedRecurringRule = null,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const localeTag = intlLocaleFromAppLocale(locale);
  const t = useTranslations("transactions.form");
  const { showToast } = useToast();
  const { currentWalletId: activeWalletId, wallets } = useWallet();
  // Wallet the expense goes to: new expenses can pick another wallet without switching the sidebar one.
  const [pickedWalletId, setPickedWalletId] = useState<string | null>(null);
  const currentWalletId = pickedWalletId ?? activeWalletId;
  const overlayRef = useRef<HTMLDivElement>(null);

  const { accounts, categories, categoriesFlat, setCategories, setCategoriesFlat } =
    useTransactionModalReferenceData(open, currentWalletId, "expense");
  const [subcategories, setSubcategories] = useState<{ id: string; name: string }[]>([]);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [observations, setObservations] = useState("");
  const [attachments, setAttachments] = useState<TransactionAttachmentRow[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachmentFileError, setAttachmentFileError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [accountFromId, setAccountFromId] = useState("");
  const [paidByMemberId, setPaidByMemberId] = useState<string | null>(null);
  const [walletSharedOption, setWalletSharedOption] = useState<string | null>(null);
  const [walletSplitType, setWalletSplitType] = useState<string | null>(null);
  const [walletTrackingMode, setWalletTrackingMode] = useState<string | null>(null);
  const [splitMethod, setSplitMethod] = useState<"equally" | "by_income" | "manual">("equally");
  const [manualSplits, setManualSplits] = useState<Array<{ member_id: string; percentage: string }>>([]);
  const [walletMembers, setWalletMembers] = useState<
    {
      id: string;
      user_id: string;
      display_name: string;
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
      current_month_income?: number;
    }[]
  >([]);
  const [saveAsPending, setSaveAsPending] = useState(false);
  const [holdBalance, setHoldBalance] = useState(true);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("monthly");
  const [intervalMonths, setIntervalMonths] = useState("");
  const [intervalDays, setIntervalDays] = useState("");
  const [workDayIndex, setWorkDayIndex] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [status, setStatus] = useState<"confirmed" | "pending">("confirmed");
  const [dialog, setDialog] = useState<"confirm" | "cancel" | null>(null);
  const [recentSimilar, setRecentSimilar] = useState<RecentSimilarRow[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [copyingSimilarId, setCopyingSimilarId] = useState<string | null>(null);
  const [catModal, setCatModal] = useState<
    | { kind: "add-category"; type: "income" | "expense" | "transfer" }
    | { kind: "add-subcategory"; type: "income" | "expense" | "transfer"; parentId: string; parentName: string }
    | null
  >(null);
  const skipNextSubcategoryReset = useRef(false);
  const [essentialMode, setEssentialMode] = useState<EssentialMode>("inherit");
  const [categoryDefaultEssential, setCategoryDefaultEssential] = useState(false);
  const editOriginal = useRef<{ amount: number; accountFromId: string; holdBalance: boolean } | null>(null);
  const autoSelectedMember = useRef(false);
  /** Avoid resetting split method when refetching incomes for a new expense after the date changes. */
  const appliedDefaultSplitForSession = useRef(false);
  const isEdit = mode === "edit" && !!transactionId;
  const isCopy = mode === "copy" && !!copyFromTransactionId;
  const shouldBlockForm = loadingData && (isEdit || isCopy || !!copyFromRecurringId);
  const showSimilarTransactions =
    mode === "new" && !copyFromTransactionId && !copyFromRecurringId;
  const targetAfterSave = pathname?.startsWith("/portfolio") ? "/portfolio" : "/transactions";

  const essentialLeafCategoryId = useMemo(() => {
    if (!categoryId) return "";
    if (subcategories.length > 0) return subcategoryId || "";
    return subcategoryId || categoryId;
  }, [categoryId, subcategoryId, subcategories.length]);

  useEffect(() => {
    if (!open || !currentWalletId) {
      setCategoryDefaultEssential(false);
      return;
    }
    const leaf = essentialLeafCategoryId;
    if (!leaf) {
      setCategoryDefaultEssential(false);
      return;
    }
    getCategory(leaf).then((c) => setCategoryDefaultEssential(!!c?.is_essential));
  }, [open, currentWalletId, essentialLeafCategoryId]);

  const isEffectivelyEssential = useMemo(
    () => essentialMode === "yes" || (essentialMode === "inherit" && categoryDefaultEssential),
    [essentialMode, categoryDefaultEssential]
  );

  useEffect(() => {
    if (!open || !currentWalletId) {
      autoSelectedMember.current = false;
      appliedDefaultSplitForSession.current = false;
    }
    if (!open) setPickedWalletId(null);
  }, [open, currentWalletId]);

  function changeWallet(id: string) {
    setPickedWalletId(id === activeWalletId ? null : id);
    // Categories, accounts and members belong to a wallet, so clear what was picked for the old one.
    setCategoryId("");
    setSubcategoryId("");
    setAccountFromId("");
    setPaidByMemberId(null);
    setManualSplits([]);
    autoSelectedMember.current = false;
    appliedDefaultSplitForSession.current = false;
  }

  useEffect(() => {
    if (!open || !currentWalletId) return;
    if (isEdit && transactionId) {
      setLoadingData(true);
      const txPromise =
        prefetchedTransaction && prefetchedTransaction.id === transactionId
          ? Promise.resolve(prefetchedTransaction)
          : getTransaction(transactionId);
      txPromise.then(async (m) => {
        if (!m) return;
        setStatus(m.status);
        editOriginal.current = {
          amount: m.amount,
          accountFromId: m.account_from_id ?? "",
          holdBalance: m.hold_balance,
        };
        const parentId = m.parent_id ?? null;
        const catId = parentId || m.category_id;
        const subId = parentId ? m.category_id : "";
        setDate(m.date);
        setAmount(formatMoneyAmountTwoDecimals(m.amount, localeTag));
        setDescription(m.description ?? "");
        setObservations((m as { observations?: string | null }).observations ?? "");
        setAttachments(
          Array.isArray((m as { attachments?: TransactionAttachmentRow[] }).attachments)
            ? ((m as { attachments: TransactionAttachmentRow[] }).attachments ?? [])
            : []
        );
        setPendingFiles([]);
        setAttachmentFileError(null);
        setAccountFromId(m.account_from_id ?? "");
        setPaidByMemberId(m.paid_by_member_id ?? null);
        if (
          m.split_method_override === "equally" ||
          m.split_method_override === "by_income" ||
          m.split_method_override === "manual"
        ) {
          setSplitMethod(m.split_method_override);
        }
        if (Array.isArray(m.manual_splits)) {
          setManualSplits(
            m.manual_splits.map((s: { member_id: string; percentage: number }) => ({
              member_id: s.member_id,
              percentage: String(s.percentage),
            }))
          );
        }
        setCategoryId(catId);
        setSubcategoryId(subId);
        skipNextSubcategoryReset.current = true;
        const subs =
          "subcategories" in m && Array.isArray(m.subcategories)
            ? m.subcategories
            : await getSubcategories(catId);
        setSubcategories(subs);
        setEssentialMode(dbToEssentialMode((m as { is_essential?: boolean | null }).is_essential));
        setLoadingData(false);
      });
      return;
    }
    if (isCopy && copyFromTransactionId) {
      setLoadingData(true);
      const txCopyPromise =
        prefetchedTransaction && prefetchedTransaction.id === copyFromTransactionId
          ? Promise.resolve(prefetchedTransaction)
          : getTransaction(copyFromTransactionId);
      txCopyPromise.then(async (m) => {
        if (!m) return;
        const parentId = m.parent_id ?? null;
        const catId = parentId || m.category_id;
        const subId = parentId ? m.category_id : "";
        setDate(new Date().toISOString().slice(0, 10));
        setAmount(formatMoneyAmountTwoDecimals(m.amount, localeTag));
        setDescription(m.description ?? "");
        setObservations((m as { observations?: string | null }).observations ?? "");
        setAttachments([]);
        setPendingFiles([]);
        setAttachmentFileError(null);
        setAccountFromId(m.account_from_id ?? "");
        setPaidByMemberId(m.paid_by_member_id ?? null);
        if (
          m.split_method_override === "equally" ||
          m.split_method_override === "by_income" ||
          m.split_method_override === "manual"
        ) {
          setSplitMethod(m.split_method_override);
        }
        if (Array.isArray(m.manual_splits)) {
          setManualSplits(
            m.manual_splits.map((s: { member_id: string; percentage: number }) => ({
              member_id: s.member_id,
              percentage: String(s.percentage),
            }))
          );
        }
        setCategoryId(catId);
        setSubcategoryId(subId);
        setSaveAsPending(m.status === "pending");
        skipNextSubcategoryReset.current = true;
        const subs =
          "subcategories" in m && Array.isArray(m.subcategories)
            ? m.subcategories
            : await getSubcategories(catId);
        setSubcategories(subs);
        setEssentialMode(dbToEssentialMode((m as { is_essential?: boolean | null }).is_essential));
        setLoadingData(false);
      });
      return;
    }
    if (isCopy && copyFromRecurringId) {
      setLoadingData(true);
      const rPromise =
        prefetchedRecurringRule && prefetchedRecurringRule.id === copyFromRecurringId
          ? Promise.resolve(prefetchedRecurringRule)
          : getRecurringRule(copyFromRecurringId);
      rPromise.then(async (r) => {
        if (!r) {
          setLoadingData(false);
          return;
        }
        const cat = await getCategory(r.category_id);
        let catId = r.category_id;
        let subId = "";
        if (cat) {
          if (cat.parent_id) {
            catId = cat.parent_id;
            subId = r.category_id;
          }
        }
        setDate(new Date().toISOString().slice(0, 10));
        setAmount(formatMoneyAmountTwoDecimals(r.amount, localeTag));
        setDescription(r.description ?? "");
        setAccountFromId(r.account_from_id ?? "");
        setCategoryId(catId);
        setSubcategoryId(subId);
        setIsRecurring(true);
        setRecurrenceType((r.recurrence_type as RecurrenceType) || "monthly");
        setIntervalMonths(
          r.recurrence_type === "interval_months" && r.interval_months != null
            ? String(r.interval_months)
            : ""
        );
        setIntervalDays(
          r.recurrence_type === "interval_days" && r.interval_days != null
            ? String(r.interval_days)
            : ""
        );
        setWorkDayIndex(
          (r.recurrence_type === "monthly_nth_work_day" ||
            r.recurrence_type === "monthly_nth_last_work_day") &&
            r.work_day_index != null
            ? String(r.work_day_index)
            : ""
        );
        skipNextSubcategoryReset.current = true;
        const subs = await getSubcategories(catId);
        setSubcategories(subs);
        setEssentialMode("inherit");
        setLoadingData(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional deps
  }, [
    open,
    currentWalletId,
    isEdit,
    isCopy,
    transactionId,
    copyFromTransactionId,
    copyFromRecurringId,
    localeTag,
    prefetchedTransaction,
    prefetchedRecurringRule,
  ]);

  useEffect(() => {
    if (!categoryId) {
      setSubcategories([]);
      setSubcategoryId("");
      return;
    }
    if (skipNextSubcategoryReset.current) {
      skipNextSubcategoryReset.current = false;
      getSubcategories(categoryId).then(setSubcategories);
      return;
    }
    getSubcategories(categoryId).then(setSubcategories);
    setSubcategoryId("");
  }, [categoryId]);

  useEffect(() => {
    if (!open || !currentWalletId) {
      if (!currentWalletId) setRecentSimilar([]);
      return;
    }
    if (!showSimilarTransactions) {
      setRecentSimilar([]);
      setLoadingSimilar(false);
      return;
    }
    setLoadingSimilar(true);
    if (!categoryId) {
      getRecentTransactionsByType(currentWalletId, "expense", 20)
        .then(setRecentSimilar)
        .finally(() => setLoadingSimilar(false));
    } else {
      getRecentTransactionsByCategory(
        currentWalletId,
        "expense",
        categoryId,
        subcategoryId || null,
        20
      )
        .then(setRecentSimilar)
        .finally(() => setLoadingSimilar(false));
    }
  }, [open, currentWalletId, categoryId, subcategoryId, showSimilarTransactions]);

  async function handleCopyFromSimilar(id: string) {
    setCopyingSimilarId(id);
    const m = await getTransaction(id);
    setCopyingSimilarId(null);
    if (!m) return;
    const parentId = m.parent_id ?? null;
    const catId = parentId || m.category_id;
    const subId = parentId ? m.category_id : "";
    skipNextSubcategoryReset.current = true;
    setAmount(formatMoneyAmountTwoDecimals(m.amount, localeTag));
    setDescription(m.description ?? "");
    setObservations((m as { observations?: string | null }).observations ?? "");
    setAttachments([]);
    setPendingFiles([]);
    setAttachmentFileError(null);
    setAccountFromId(m.account_from_id ?? "");
    setCategoryId(catId);
    setSubcategoryId(subId);
    getSubcategories(catId).then(setSubcategories);
    setEssentialMode(dbToEssentialMode((m as { is_essential?: boolean | null }).is_essential));
    setError(null);
  }

  const resetForm = useCallback(() => {
    setDate(new Date().toISOString().slice(0, 10));
    setDescription("");
    setObservations("");
    setAttachments([]);
    setPendingFiles([]);
    setAttachmentFileError(null);
    setCategoryId("");
    setSubcategoryId("");
    setAmount("");
    setAccountFromId("");
    setPaidByMemberId(null);
    setSplitMethod("equally");
    setManualSplits([]);
    setSaveAsPending(false);
    setHoldBalance(true);
    setIsRecurring(false);
    setRecurrenceType("monthly");
    setIntervalMonths("");
    setIntervalDays("");
    setWorkDayIndex("");
    setError(null);
    setEssentialMode("inherit");
    editOriginal.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    if (mode === "new" && !transactionId && !copyFromTransactionId && !copyFromRecurringId) {
      resetForm();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading && !loadingData) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opening new
  }, [open, activeWalletId, onClose, loading, loadingData, resetForm, mode, transactionId, copyFromTransactionId, copyFromRecurringId]);

  useEffect(() => {
    if (!open || !currentWalletId) return;
    getWalletSplitInfo(currentWalletId, { referenceDate: date }).then((result) => {
      const sharedOption = result.shared_option ?? null;
      const members = result.members ?? [];
      setWalletSharedOption(sharedOption);
      setWalletSplitType(result.split_type ?? null);
      setWalletTrackingMode(result.tracking_mode ?? null);
      const defaultSplitMethod =
        result.default_split_method === "by_income" || result.default_split_method === "manual"
          ? result.default_split_method
          : "equally";
      const isBrandNew =
        mode === "new" && !transactionId && !copyFromTransactionId && !copyFromRecurringId;
      if (isBrandNew && !appliedDefaultSplitForSession.current) {
        setSplitMethod(defaultSplitMethod);
        appliedDefaultSplitForSession.current = true;
      }
      setWalletMembers(members);

      if (
        !isEdit &&
        !isCopy &&
        !autoSelectedMember.current &&
        (sharedOption === "split" || sharedOption === "track_and_split") &&
        members.length > 0
      ) {
        autoSelectedMember.current = true;
        getCurrentUserId().then((userResult) => {
          if (userResult.userId) {
            const currentMember = members.find((m) => m.user_id === userResult.userId);
            if (currentMember) {
              setPaidByMemberId((prev) => prev ?? currentMember.id);
            }
          }
        });
      }
    });
  }, [open, currentWalletId, date, isEdit, isCopy, mode, transactionId, copyFromTransactionId, copyFromRecurringId]);

  const isSplitOnly = walletSharedOption === "split" || (!walletSharedOption && !!walletSplitType);
  const isBasicTracking = walletTrackingMode === "basic" || (!walletTrackingMode && isSplitOnly);
  const requiresAccounts = !isBasicTracking;
  const isSplitWallet = walletSharedOption === "track_and_split" || isSplitOnly;
  const effectiveSplitMethod = isSplitWallet ? splitMethod : "equally";
  const expenseAmount = parseFloat(amount.replace(",", ".")) || 0;

  useEffect(() => {
    if (!isSplitWallet) return;
    if (!manualSplits.length && walletMembers.length > 0) {
      const equalShare = (100 / walletMembers.length).toFixed(2);
      setManualSplits(walletMembers.map((m) => ({ member_id: m.user_id, percentage: equalShare })));
      return;
    }
    const memberIds = new Set(walletMembers.map((m) => m.user_id));
    setManualSplits((prev) => {
      const byId = new Map(prev.map((s) => [s.member_id, s.percentage]));
      return walletMembers
        .filter((m) => memberIds.has(m.user_id))
        .map((m) => ({ member_id: m.user_id, percentage: byId.get(m.user_id) ?? "0" }));
    });
  }, [isSplitWallet, walletMembers, manualSplits.length]);

  const rebalanceManualSplit = useCallback((memberId: string, rawValue: string) => {
    setManualSplits((prev) => {
      const ordered = walletMembers.map((m) => {
        const current = prev.find((s) => s.member_id === m.user_id)?.percentage ?? "0";
        return { member_id: m.user_id, percentage: current };
      });
      if (ordered.length === 0) return prev;
      if (ordered.length === 1) return [{ member_id: ordered[0].member_id, percentage: "100" }];

      const parsed = Number.parseFloat(String(rawValue).replace(",", "."));
      const edited = round2(clampPct(Number.isFinite(parsed) ? parsed : 0));
      const others = ordered.filter((s) => s.member_id !== memberId);
      const targetOthers = round2(100 - edited);

      const existingOthers = others.map((s) => round2(clampPct(Number.parseFloat(s.percentage.replace(",", ".")) || 0)));
      const sumExistingOthers = existingOthers.reduce((sum, v) => sum + v, 0);
      let nextOthers: number[] = [];
      if (sumExistingOthers <= 0) {
        const equal = targetOthers / others.length;
        nextOthers = others.map(() => round2(equal));
      } else {
        nextOthers = existingOthers.map((v) => round2((v / sumExistingOthers) * targetOthers));
      }
      const diff = round2(targetOthers - nextOthers.reduce((sum, v) => sum + v, 0));
      if (nextOthers.length > 0) {
        const last = nextOthers.length - 1;
        nextOthers[last] = round2(clampPct(nextOthers[last] + diff));
      }

      const otherById = new Map(others.map((o, idx) => [o.member_id, nextOthers[idx] ?? 0]));
      return ordered.map((s) =>
        s.member_id === memberId
          ? { ...s, percentage: formatPctInput(edited) }
          : { ...s, percentage: formatPctInput(otherById.get(s.member_id) ?? 0) }
      );
    });
  }, [walletMembers]);

  const splitPreviewRows = useMemo(() => {
    if (!isSplitWallet || walletMembers.length === 0) return [];

    const normalizedPercentages = (weights: number[]) => {
      if (!weights.length) return [];
      const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
      const total = safeWeights.reduce((sum, w) => sum + w, 0);
      const base = total > 0 ? safeWeights : safeWeights.map(() => 1);
      const denom = base.reduce((sum, w) => sum + w, 0) || 1;
      const p = base.map((w) => round2((w / denom) * 100));
      const diff = round2(100 - p.reduce((sum, x) => sum + x, 0));
      if (p.length > 0) p[p.length - 1] = round2(p[p.length - 1] + diff);
      return p.map((x) => clampPct(x));
    };

    let pcts: number[] = [];
    if (effectiveSplitMethod === "equally") {
      pcts = normalizedPercentages(walletMembers.map(() => 1));
    } else if (effectiveSplitMethod === "by_income") {
      pcts = normalizedPercentages(walletMembers.map((m) => Number(m.current_month_income ?? 0)));
    } else {
      const byId = new Map(manualSplits.map((s) => [s.member_id, Number.parseFloat(s.percentage.replace(",", ".")) || 0]));
      pcts = walletMembers.map((m) => round2(clampPct(byId.get(m.user_id) ?? 0)));
    }

    return walletMembers.map((m, idx) => {
      const pct = pcts[idx] ?? 0;
      const value = round2((Math.max(0, expenseAmount) * pct) / 100);
      return { memberId: m.user_id, name: m.display_name, percentage: pct, value };
    });
  }, [isSplitWallet, walletMembers, effectiveSplitMethod, manualSplits, expenseAmount]);

  function validate(): string | null {
    const num = parseFloat(amount.replace(",", "."));
    if (isNaN(num) || num <= 0) return t("validation.amountPositive");
    const catId = subcategoryId || categoryId;
    if (!catId) return t("validation.categoryRequired");
    if (subcategories.length > 0 && !subcategoryId) return t("validation.subcategoryRequired");
    if (!description.trim()) return t("validation.descriptionRequired");

    // Account required for 'track' and 'track_and_split' wallets, not for 'split'
    if (requiresAccounts && !accountFromId) return t("validation.accountFromRequired");

    // Member required for 'split' and 'track_and_split' wallets
    if (isSplitWallet && !paidByMemberId) return t("validation.memberPaidRequired");
    if (isSplitWallet && effectiveSplitMethod === "manual") {
      const total = manualSplits.reduce((sum, s) => sum + (parseFloat(s.percentage.replace(",", ".")) || 0), 0);
      if (Math.abs(total - 100) > 0.01) return t("validation.manualSplitTotal");
    }

    if (isRecurring && recurrenceType === "interval_months") {
      const x = parseInt(intervalMonths, 10);
      if (isNaN(x) || x < 1) return t("validation.intervalMonthsValid");
    }
    if (isRecurring && recurrenceType === "interval_days") {
      const x = parseInt(intervalDays, 10);
      if (isNaN(x) || x < 1) return t("validation.intervalDaysValid");
    }
    const isWorkDay =
      isRecurring &&
      (recurrenceType === "monthly_nth_work_day" ||
        recurrenceType === "monthly_nth_last_work_day");
    if (isWorkDay) {
      const x = parseInt(workDayIndex, 10);
      if (isNaN(x) || x < 1 || x > 31) return t("validation.workDayIndexValid");
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentWalletId) return;
    setError(null);
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setLoading(true);
    const num = parseFloat(amount.replace(",", "."));
    const catId = subcategoryId || categoryId;
    const isWorkDay =
      isRecurring &&
      (recurrenceType === "monthly_nth_work_day" ||
        recurrenceType === "monthly_nth_last_work_day");

    if (isEdit && transactionId) {
      const useRecurring = status === "confirmed" && isRecurring;
      const res = await updateTransaction(transactionId, {
        type: "expense",
        category_id: catId,
        date,
        amount: num,
        account_from_id: accountFromId,
        account_to_id: null,
        description: description.trim(),
        observations: observations.trim() || null,
        is_recurring: useRecurring,
        recurrence_type: useRecurring ? recurrenceType : undefined,
        interval_months:
          useRecurring && recurrenceType === "interval_months" && intervalMonths.trim()
            ? parseInt(intervalMonths, 10)
            : null,
        interval_days:
          useRecurring && recurrenceType === "interval_days" && intervalDays.trim()
            ? parseInt(intervalDays, 10)
            : null,
        work_day_index: isWorkDay && workDayIndex.trim() ? parseInt(workDayIndex, 10) : null,
        paid_by_member_id: paidByMemberId,
        received_by_member_id: null,
        split_method_override: isSplitWallet ? effectiveSplitMethod : null,
        manual_splits:
          isSplitWallet && effectiveSplitMethod === "manual"
            ? manualSplits.map((s) => ({
              member_id: s.member_id,
              percentage: parseFloat(s.percentage.replace(",", ".")) || 0,
            }))
            : [],
        is_essential: essentialModeToDb(essentialMode),
      });
      setLoading(false);
      if (res.error) {
        setError(res.error);
        showToast(res.error, "error");
        return;
      }
      showToast(t("toasts.transactionUpdated"));
      onClose();
      router.push(targetAfterSave);
      router.refresh();
      return;
    }

    const res = await createTransaction({
      wallet_id: currentWalletId,
      type: "expense",
      category_id: catId,
      date,
      amount: num,
      account_from_id: accountFromId,
      account_to_id: null,
      description: description.trim(),
      observations: observations.trim() || null,
      is_recurring: isRecurring,
      recurrence_type: isRecurring ? recurrenceType : undefined,
      interval_months:
        isRecurring && recurrenceType === "interval_months" && intervalMonths.trim()
          ? parseInt(intervalMonths, 10)
          : null,
      interval_days:
        isRecurring && recurrenceType === "interval_days" && intervalDays.trim()
          ? parseInt(intervalDays, 10)
          : null,
      work_day_index:
        isWorkDay && workDayIndex.trim() ? parseInt(workDayIndex, 10) : null,
      paid_by_member_id: paidByMemberId,
      received_by_member_id: null,
      split_method_override: isSplitWallet ? effectiveSplitMethod : null,
      manual_splits:
        isSplitWallet && effectiveSplitMethod === "manual"
          ? manualSplits.map((s) => ({
            member_id: s.member_id,
            percentage: parseFloat(s.percentage.replace(",", ".")) || 0,
          }))
          : [],
      status: saveAsPending ? "pending" : "confirmed",
      hold_balance: saveAsPending ? holdBalance : false,
      is_essential: essentialModeToDb(essentialMode),
    });
    setLoading(false);
    if (res.error) {
      setError(res.error);
      showToast(res.error, "error");
      return;
    }
    if (res.id && currentWalletId && pendingFiles.length > 0) {
      for (const f of pendingFiles) {
        const fd = new FormData();
        fd.set("file", f);
        const up = await uploadTransactionAttachment(currentWalletId, res.id, fd);
        if (up.error) showToast(up.error, "error");
      }
      setPendingFiles([]);
    }
    showToast(t("toasts.transactionAdded"));
    onClose();
    router.push(targetAfterSave);
    router.refresh();
  }

  async function handleConfirm() {
    if (!currentWalletId || !transactionId) return;
    setError(null);
    const err = validate();
    if (err) {
      setError(err);
      setDialog(null);
      showToast(err, "error");
      return;
    }
    setLoading(true);
    const num = parseFloat(amount.replace(",", "."));
    const catId = subcategoryId || categoryId;
    const up = await updateTransaction(transactionId, {
      type: "expense",
      category_id: catId,
      date,
      amount: num,
      account_from_id: accountFromId,
      account_to_id: null,
      description: description.trim(),
      observations: observations.trim() || null,
      is_recurring: false,
      paid_by_member_id: paidByMemberId,
      received_by_member_id: null,
      split_method_override: isSplitWallet ? effectiveSplitMethod : null,
      manual_splits:
        isSplitWallet && effectiveSplitMethod === "manual"
          ? manualSplits.map((s) => ({
            member_id: s.member_id,
            percentage: parseFloat(s.percentage.replace(",", ".")) || 0,
          }))
          : [],
      is_essential: essentialModeToDb(essentialMode),
    });
    if (up.error) {
      setError(up.error);
      setLoading(false);
      setDialog(null);
      showToast(up.error, "error");
      return;
    }
    const cr = await confirmTransaction(transactionId);
    setLoading(false);
    setDialog(null);
    if (cr.error) {
      setError(cr.error);
      showToast(cr.error, "error");
      return;
    }
    showToast(t("toasts.transactionConfirmed"));
    onClose();
    router.push(targetAfterSave);
    router.refresh();
  }

  async function handleDelete() {
    if (!transactionId) return;
    setLoading(true);
    const res = await deleteTransaction(transactionId);
    setLoading(false);
    setDialog(null);
    if (res.error) {
      showToast(res.error, "error");
      return;
    }
    showToast(status === "pending" ? t("toasts.pendingTransactionCanceled") : t("toasts.transactionDeleted"));
    onClose();
    router.push(targetAfterSave);
    router.refresh();
  }

  if (!open) return null;

  if (!currentWalletId) {
    return (
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div
          className="absolute inset-0 bg-black/40"
          aria-hidden
          onClick={onClose}
        />
        <div className="relative rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 shadow-xl p-6 max-w-sm">
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            {t("noWallet")}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {t("close")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden
        onClick={() => !loading && !loadingData && onClose()}
      />
      <div
        className="relative w-full max-w-[76.8rem] h-[min(78vh,780px)] max-h-[min(78vh,780px)] overflow-hidden flex flex-col rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 shadow-xl text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 pt-4 pb-2 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2.5">
            <TransactionTypeIcon
              type="expense"
              aria-hidden
              className="[&_svg]:h-5 [&_svg]:w-5 dark:text-red-400"
            />
            <h2 id="expense-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {isEdit
                ? status === "pending"
                  ? t("editPendingExpense")
                  : t("editExpense")
                : t("newExpense")}
            </h2>
          </div>
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col min-h-0 flex-1 overflow-hidden"
        >
          {shouldBlockForm ? (
            <div className="min-h-[200px] flex items-center justify-center">
              <div className="h-8 w-8 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" aria-hidden />
            </div>
          ) : (
            <div
              className={`p-2 sm:p-3 flex-1 min-h-0 grid grid-cols-1 gap-2 lg:gap-3 items-stretch overflow-hidden ${
                showSimilarTransactions ? "lg:grid-cols-3" : "lg:grid-cols-2"
              }`}
            >
            <div className="min-h-0 overflow-y-auto min-w-0 space-y-2.5 lg:pr-1 friendly-scroll">
              {!isEdit && wallets.filter((w) => w.is_active).length > 1 && (
                <div>
                  <label htmlFor="expense-wallet" className="block text-xs font-medium mb-1">{t("fields.wallet")}</label>
                  <select
                    id="expense-wallet"
                    value={currentWalletId}
                    onChange={(e) => changeWallet(e.target.value)}
                    disabled={loading}
                    className={inputClass}
                  >
                    {wallets
                      .filter((w) => w.is_active)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium mb-1">{t("fields.date")}</label>
                <TransactionDateInput
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t("fields.description")}</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  required
                  placeholder={t("fields.descriptionPlaceholder")}
                  className={inputClass}
                />
              </div>
              <TransactionObservationsAttachments
                observations={observations}
                onObservationsChange={setObservations}
                walletId={currentWalletId}
                transactionId={isEdit && transactionId ? transactionId : null}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                pendingFiles={pendingFiles}
                onPendingFilesChange={setPendingFiles}
                fileError={attachmentFileError}
                onFileError={setAttachmentFileError}
                disabled={shouldBlockForm || loading}
                textareaClassName={inputClass}
              />
            </div>
            <div className="min-h-0 overflow-y-auto min-w-0 space-y-2.5 pt-2 lg:pt-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-700 lg:pl-3 friendly-scroll">
              <CategorySubcategorySearchField
                flat={categoriesFlat}
                disabled={shouldBlockForm}
                inputClassName={inputClass}
                onPick={(parentId, subId) => {
                  skipNextSubcategoryReset.current = true;
                  setEssentialMode("inherit");
                  setCategoryId(parentId);
                  setSubcategoryId(subId);
                  getSubcategories(parentId).then(setSubcategories);
                }}
              />
              <div>
                <label className="block text-xs font-medium mb-1">{t("fields.category")}</label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={categoryId}
                    onChange={(e) => {
                      setEssentialMode("inherit");
                      setCategoryId(e.target.value);
                    }}
                    required
                    className={inputClass + " flex-1"}
                  >
                    <option value="">{t("fields.selectCategory")}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {!categoryId && (
                    <button
                      type="button"
                      onClick={() => setCatModal({ kind: "add-category", type: "expense" })}
                      className="shrink-0 p-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                      title={t("fields.addCategory")}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                    </button>
                  )}
                </div>
              </div>
              {(subcategories.length > 0 || categoryId) && (
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {subcategories.length > 0 ? t("fields.subcategoryRequired") : t("fields.subcategory")}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={subcategoryId}
                      onChange={(e) => {
                        setEssentialMode("inherit");
                        setSubcategoryId(e.target.value);
                      }}
                      required={subcategories.length > 0}
                      className={inputClass + " flex-1"}
                    >
                      <option value="">{subcategories.length > 0 ? t("fields.selectSubcategory") : t("fields.none")}</option>
                      {subcategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {categoryId && (
                      <button
                        type="button"
                        onClick={() => {
                          const parent = categories.find((c) => c.id === categoryId);
                          if (parent) setCatModal({ kind: "add-subcategory", type: "expense", parentId: parent.id, parentName: parent.name });
                        }}
                        className="shrink-0 p-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                        title={t("fields.addSubcategory")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium mb-1">{t("fields.amount")}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={() => setAmount((a) => normalizeMoneyInputString(a, localeTag))}
                  required
                  placeholder={t("fields.amountPlaceholder")}
                  className={inputClass}
                />
              </div>
              {requiresAccounts && (
                <div>
                  <label className="block text-xs font-medium mb-1">{t("fields.accountFrom")}</label>
                  <select
                    value={accountFromId}
                    onChange={(e) => setAccountFromId(e.target.value)}
                    required={requiresAccounts}
                    className={inputClass}
                  >
                    <option value="">{t("fields.selectAccount")}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const num = parseFloat(amount.replace(",", "."));
                    if (isNaN(num) || num <= 0) return null;
                    const orig = editOriginal.current;
                    const accountChanged =
                      isEdit && orig && !orig.holdBalance && orig.accountFromId && orig.accountFromId !== accountFromId;
                    return (
                      <>
                        {/* Original account reversal when account changed */}
                        {accountChanged && (() => {
                          const oldAcc = accounts.find((a) => a.id === orig.accountFromId);
                          if (!oldAcc) return null;
                          return (
                            <BalanceHint
                              label={oldAcc.name}
                              currentBalance={oldAcc.current_balance}
                              afterBalance={oldAcc.current_balance + orig.amount}
                            />
                          );
                        })()}
                        {/* Selected account */}
                        {(() => {
                          const acc = accounts.find((a) => a.id === accountFromId);
                          if (!acc) return null;
                          const sameAccount = isEdit && orig && !orig.holdBalance && orig.accountFromId === accountFromId;
                          const afterBalance = sameAccount
                            ? acc.current_balance - (num - orig.amount)
                            : acc.current_balance - num;
                          return (
                            <BalanceHint
                              label={accountChanged ? acc.name : undefined}
                              currentBalance={acc.current_balance}
                              afterBalance={afterBalance}
                            />
                          );
                        })()}
                      </>
                    );
                  })()}
                </div>
              )}
              {isSplitWallet && (
                <div>
                  <label className="block text-xs font-medium mb-2">
                    {walletSharedOption !== null ? t("fields.paidByMemberRequired") : t("fields.paidByMember")}
                  </label>
                  <select
                    value={paidByMemberId ?? ""}
                    onChange={(e) => setPaidByMemberId(e.target.value || null)}
                    required={isSplitWallet}
                    className={inputClass}
                  >
                    <option value="">Select user</option>
                    {walletMembers.map((m) => (
                      <option key={m.id} value={m.user_id}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                  {walletMembers.length === 0 && (
                    <div className="text-xs text-slate-500 mt-1">{t("fields.noMembers")}</div>
                  )}
                </div>
              )}
              {isSplitWallet && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-2">
                  <label className="block text-xs font-medium">{t("fields.splitMethod")}</label>
                  <select
                    value={splitMethod}
                    onChange={(e) => setSplitMethod(e.target.value as "equally" | "by_income" | "manual")}
                    className={inputClass}
                  >
                    <option value="equally">
                      {t("fields.splitMethodEqually")}
                    </option>
                    <option value="by_income">
                      {t("fields.splitMethodByIncome")}
                    </option>
                    <option value="manual">
                      {t("fields.splitMethodManual")}
                    </option>
                  </select>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 dark:bg-slate-800/60">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-slate-600 dark:text-slate-300">
                            {t("fields.paidByMember")}
                          </th>
                          <th className="px-2 py-1.5 text-right font-medium text-slate-600 dark:text-slate-300 w-28">
                            %
                          </th>
                          <th className="px-2 py-1.5 text-right font-medium text-slate-600 dark:text-slate-300 w-28">
                            {t("fields.splitValue")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {splitPreviewRows.map((r) => {
                          const current = manualSplits.find((s) => s.member_id === r.memberId)?.percentage ?? "0";
                          return (
                            <tr key={r.memberId}>
                              <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{r.name}</td>
                              <td className="px-2 py-1.5 text-right">
                                {effectiveSplitMethod === "manual" ? (
                                  <div className="inline-flex items-center gap-1">
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="0.01"
                                      value={current}
                                      onChange={(e) => rebalanceManualSplit(r.memberId, e.target.value)}
                                      className="w-20 text-right text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800"
                                    />
                                    <span className="text-slate-500">%</span>
                                  </div>
                                ) : (
                                  <span className="font-medium text-slate-700 dark:text-slate-200">
                                    {r.percentage.toFixed(2)}%
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">
                                {r.value.toLocaleString("pt-PT", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{" "}
                                €
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!!essentialLeafCategoryId && (
                <div className="flex flex-wrap items-center gap-2">
                  <EssentialTagToggle
                    label={t("fields.essential")}
                    ariaDismissLabel={t("fields.essentialDismissAria")}
                    ariaActivateLabel={t("fields.essentialActivateAria")}
                    isActive={isEffectivelyEssential}
                    onDismiss={() => setEssentialMode("no")}
                    onActivate={() => {
                      if (categoryDefaultEssential) setEssentialMode("inherit");
                      else setEssentialMode("yes");
                    }}
                  />
                </div>
              )}
              {(!isEdit || status !== "pending") && (
                <div className="flex flex-col gap-3 p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                  {!isEdit && (
                    <>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={saveAsPending}
                          onChange={(e) => {
                            setSaveAsPending(e.target.checked);
                            if (!e.target.checked) setHoldBalance(true);
                          }}
                        />
                        <span className="text-xs font-medium">{t("options.saveAsPending")}</span>
                      </label>
                      {saveAsPending && (
                        <label className="flex items-center gap-2 cursor-pointer pl-6 -mt-1">
                          <input
                            type="checkbox"
                            checked={holdBalance}
                            onChange={(e) => setHoldBalance(e.target.checked)}
                          />
                          <span className="text-xs text-slate-600 dark:text-slate-400">
                            {t("options.holdBalance")}
                          </span>
                        </label>
                      )}
                    </>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isRecurring}
                      onChange={(e) => setIsRecurring(e.target.checked)}
                    />
                    <span className="text-xs font-medium">{t("options.makeRecurring")}</span>
                  </label>
                  {isRecurring && (
                    <div className="space-y-3 pl-6">
                      <div>
                        <label className="block text-xs font-medium mb-1">{t("options.schedule")}</label>
                        <select
                          value={recurrenceType}
                          onChange={(e) => {
                            const v = e.target.value as RecurrenceType;
                            if (v) setRecurrenceType(v);
                          }}
                          className="w-full max-w-xs px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800"
                        >
                          {RECURRENCE_OPTIONS.map((o, i) =>
                            isRecurrenceOptionSeparator(o) ? (
                              <option key={`sep-${i}`} disabled>
                                {o.label}
                              </option>
                            ) : (
                              <option key={o.value} value={o.value}>
                                {recurrenceOptionLabel(t, o.value, o.label)}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                      {recurrenceType === "interval_days" && (
                        <div>
                          <label className="block text-xs font-medium mb-1">{t("options.intervalDays")}</label>
                          <input
                            type="number"
                            min={1}
                            value={intervalDays}
                            onChange={(e) => setIntervalDays(e.target.value)}
                            placeholder={t("options.intervalDaysPlaceholder")}
                            className="w-full max-w-[120px] px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800"
                          />
                        </div>
                      )}
                      {recurrenceType === "interval_months" && (
                        <div>
                          <label className="block text-xs font-medium mb-1">{t("options.intervalMonths")}</label>
                          <input
                            type="number"
                            min={1}
                            value={intervalMonths}
                            onChange={(e) => setIntervalMonths(e.target.value)}
                            placeholder={t("options.intervalMonthsPlaceholder")}
                            className="w-full max-w-[120px] px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800"
                          />
                        </div>
                      )}
                      {(recurrenceType === "monthly_nth_work_day" ||
                        recurrenceType === "monthly_nth_last_work_day") && (
                          <div>
                            <label className="block text-xs font-medium mb-1">
                              {recurrenceType === "monthly_nth_last_work_day"
                                ? t("options.nthLastWorkDay")
                                : t("options.nthWorkDay")}
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={31}
                              value={workDayIndex}
                              onChange={(e) => setWorkDayIndex(e.target.value)}
                              placeholder={t("options.workDayPlaceholder")}
                              className="w-full max-w-[120px] px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800"
                            />
                          </div>
                        )}
                    </div>
                  )}
                </div>
              )}
              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>
            {showSimilarTransactions && (
              <div className="min-h-0 flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 lg:min-w-0">
                <div className="shrink-0 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 lg:px-4 lg:py-3 border-b border-slate-200 dark:border-slate-700">
                  <h3 className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {!categoryId
                      ? t("similar.expenses")
                      : subcategoryId
                        ? t("similar.expensesSubcategory")
                        : t("similar.expensesCategory")}
                  </h3>
                </div>
                <div className="p-2 lg:p-3 flex-1 min-h-0 overflow-y-auto min-h-[100px] friendly-scroll">
                  {loadingSimilar ? (
                    <p className="text-xs text-slate-500">{t("similar.loading")}</p>
                  ) : recentSimilar.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      {!categoryId ? t("similar.noExpenses") : t("similar.noSimilar")}
                    </p>
                  ) : (
                    <div className="w-full min-w-0 text-xs">
                      <div className="flex items-center justify-between gap-6 pb-1.5 border-b border-slate-200 dark:border-slate-700 text-slate-500">
                        <span className="font-medium min-w-0 max-w-[42%] truncate">{t("similar.tableDescription")}</span>
                        <span className="font-medium shrink-0">{t("similar.tableAmount")}</span>
                      </div>
                      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                        {recentSimilar.map((r) => (
                          <li key={r.id} className="py-1.5 min-w-0">
                            <div className="text-[10px] leading-tight text-slate-500 dark:text-slate-400 tabular-nums">
                              {r.date}
                            </div>
                            <div className="mt-0.5 flex items-start justify-between gap-4 min-w-0">
                              <div className="min-w-0 max-w-[38%] flex-none text-left sm:max-w-[40%]">
                                <p className="text-slate-700 dark:text-slate-200 break-words hyphens-auto">
                                  {r.description || "—"}
                                </p>
                                <p className="mt-0.5 text-[10px] leading-tight text-slate-500 dark:text-slate-400 break-words">
                                  {r.account_from_name ?? "—"}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-start gap-2">
                                <span className="tabular-nums text-right text-red-600 dark:text-red-400 whitespace-nowrap pt-px">
                                  −{r.amount.toLocaleString("pt-PT", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  €
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyFromSimilar(r.id)}
                                  disabled={!!copyingSimilarId}
                                  className="p-1 rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-600 dark:hover:text-slate-200 disabled:opacity-50 transition-colors shrink-0"
                                  title={copyingSimilarId === r.id ? t("similar.copying") : t("similar.copy")}
                                  aria-label={copyingSimilarId === r.id ? t("similar.copying") : t("similar.copy")}
                                >
                                  <CopyIcon aria-hidden />
                                </button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>
          )}
          {!shouldBlockForm && (
            <div className="shrink-0 flex flex-wrap gap-2 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
            <button
              type="button"
              onClick={onClose}
              disabled={loading || loadingData}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              {t("buttons.cancel")}
            </button>
            {isEdit && status === "pending" && (
              <>
                <button
                  type="button"
                  onClick={() => setDialog("confirm")}
                  disabled={loading || loadingData}
                  className="px-3 py-1.5 text-xs rounded-lg bg-green-700 text-white hover:bg-green-600 disabled:opacity-50"
                >
                  {loading ? t("buttons.confirming") : t("buttons.confirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setDialog("cancel")}
                  disabled={loading || loadingData}
                  className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-600 dark:border-red-400 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  {loading ? t("buttons.cancelling") : t("buttons.cancelPending")}
                </button>
              </>
            )}
            <button
              type="submit"
              disabled={loading || loadingData}
              className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:opacity-50"
            >
              {loading ? t("buttons.saving") : t("buttons.save")}
            </button>
            </div>
          )}
        </form>
      </div>

      <ConfirmDialog
        open={dialog === "confirm"}
        onClose={() => setDialog(null)}
        onConfirm={handleConfirm}
        title={t("confirmDialogs.confirmTitle")}
        message={t("confirmDialogs.confirmMessage")}
        confirmLabel={t("confirmDialogs.confirmButton")}
        cancelLabel={t("confirmDialogs.goBack")}
        variant="confirm"
        loading={loading}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        onConfirm={handleDelete}
        title={t("confirmDialogs.cancelTitle")}
        message={t("confirmDialogs.cancelMessage")}
        confirmLabel={t("confirmDialogs.cancelButton")}
        cancelLabel={t("confirmDialogs.keepButton")}
        variant="cancel"
        loading={loading}
      />
      {
        catModal && (
          <CategoryModal
            mode={catModal}
            open={true}
            onClose={() => setCatModal(null)}
            onSaved={(newId) => {
              if (!currentWalletId) return;
              if (catModal.kind === "add-category") {
                Promise.all([
                  getCategories(currentWalletId, "expense"),
                  getCategoriesFlatForSearch(currentWalletId, "expense"),
                ]).then(([cats, flat]) => {
                  setCategories(cats);
                  setCategoriesFlat(flat);
                  if (newId) setCategoryId(newId);
                });
              } else if (catModal.kind === "add-subcategory") {
                Promise.all([
                  getSubcategories(categoryId),
                  getCategoriesFlatForSearch(currentWalletId, "expense"),
                ]).then(([subs, flat]) => {
                  setSubcategories(subs);
                  setCategoriesFlat(flat);
                  if (newId) {
                    skipNextSubcategoryReset.current = true;
                    setSubcategoryId(newId);
                  }
                });
              }
            }}
          />
        )
      }
    </div>
  );
}
