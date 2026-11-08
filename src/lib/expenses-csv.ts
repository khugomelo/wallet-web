import type { ExportExpenseRow } from "@/app/actions/export";

export type ExpensesCsvLabels = {
  wallet: string;
  description: string;
  total: string;
  date: string;
  subcategory: string;
  category: string;
  essential: string;
  paidBy: string;
  yes: string;
  no: string;
};

function cell(v: string | number): string {
  const s = typeof v === "number" ? v.toFixed(2) : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Same column order as the old yearly sheets, plus Wallet and Paid by. BOM so Excel reads accents. */
export function buildExpensesCsv(
  rows: ExportExpenseRow[],
  members: Array<{ id: string; name: string }>,
  l: ExpensesCsvLabels
): string {
  const header = [l.wallet, l.description, l.total, ...members.map((m) => m.name), l.date, l.subcategory, l.category, l.essential, l.paidBy];
  const lines = rows.map((r) =>
    [
      r.walletName,
      r.description,
      r.total,
      ...members.map((m) => (m.id in r.shares ? r.shares[m.id] : "")),
      r.date,
      r.subcategory,
      r.category,
      r.essential ? l.yes : l.no,
      r.paidBy,
    ]
      .map(cell)
      .join(",")
  );
  return "﻿" + [header.map(cell).join(","), ...lines].join("\r\n");
}
