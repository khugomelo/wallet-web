"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TransactionDateInput } from "@/components/TransactionDateInput";
import { useWallet } from "@/contexts/WalletContext";
import { useToast } from "@/contexts/ToastContext";
import { getExpensesForExport } from "@/app/actions/export";
import { buildExpensesCsv } from "@/lib/expenses-csv";

type Preset = "thisMonth" | "lastMonth" | "thisYear" | "lastYear" | "custom";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function presetRange(p: Exclude<Preset, "custom">): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (p === "thisMonth") return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (p === "lastMonth") return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (p === "thisYear") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400";

export function ExportCsvButton() {
  const t = useTranslations("transactions.export");
  const { wallets, currentWalletId } = useWallet();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [range, setRange] = useState(presetRange("thisMonth"));
  const [walletChoice, setWalletChoice] = useState<string>(currentWalletId ?? "all");

  const activeWallets = wallets.filter((w) => w.is_active);

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  }

  async function handleExport() {
    setLoading(true);
    const walletIds = walletChoice === "all" ? activeWallets.map((w) => w.id) : [walletChoice];
    const res = await getExpensesForExport({ walletIds, from: range.from, to: range.to });
    setLoading(false);
    if (res.error || !res.rows || !res.members) {
      showToast(res.error ?? t("failed"), "error");
      return;
    }
    if (res.rows.length === 0) {
      showToast(t("empty"), "error");
      return;
    }
    const csv = buildExpensesCsv(res.rows, res.members, {
      wallet: t("columns.wallet"),
      description: t("columns.description"),
      total: t("columns.total"),
      date: t("columns.date"),
      subcategory: t("columns.subcategory"),
      category: t("columns.category"),
      essential: t("columns.essential"),
      paidBy: t("columns.paidBy"),
      yes: t("yes"),
      no: t("no"),
    });
    const walletLabel =
      walletChoice === "all" ? "all-wallets" : (activeWallets.find((w) => w.id === walletChoice)?.name ?? "wallet");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${walletLabel}_${range.from}_${range.to}.csv`.replace(/[\\/:*?"<>|\s]+/g, "-");
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  const presets: Preset[] = ["thisMonth", "lastMonth", "thisYear", "lastYear", "custom"];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
      >
        {t("button")}
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleExport}
        title={t("title")}
        message={t("message")}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        variant="confirm"
        loading={loading}
      >
        <div className="space-y-4 pt-2 text-left">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">{t("wallet")}</span>
            <select className={inputClass} value={walletChoice} onChange={(e) => setWalletChoice(e.target.value)}>
              <option value="all">{t("allWallets")}</option>
              {activeWallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1">
            <span className="text-sm font-medium text-slate-700">{t("period")}</span>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={preset === p}
                  onClick={() => choosePreset(p)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    preset === p
                      ? "border-green-600 bg-green-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {t(`presets.${p}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">{t("from")}</span>
              <TransactionDateInput
                className={inputClass}
                value={range.from}
                max={range.to}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, from: e.target.value }));
                }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">{t("to")}</span>
              <TransactionDateInput
                className={inputClass}
                value={range.to}
                min={range.from}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, to: e.target.value }));
                }}
              />
            </label>
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}
