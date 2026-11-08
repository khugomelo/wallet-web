export type SplitMethod = "equally" | "by_income" | "manual";

/**
 * Each member's share of one shared expense, "as if everyone had settled".
 * Single source of truth for settlements and CSV export.
 * - manual: stored percentages (normalised); falls through to equally when missing.
 * - by_income: that calendar month's confirmed income per member; falls back to the
 *   members' configured monthly income, then to equally.
 */
export function expenseShares(args: {
  amount: number;
  date: string;
  method: SplitMethod;
  memberIds: string[];
  manualSplits?: Array<{ member_id: string; percentage: number }>;
  incomeByMonthAndMember: Map<string, Map<string, number>>;
  configuredIncomeByMember: Map<string, number>;
}): Map<string, number> {
  const { amount, date, method, memberIds } = args;
  const shares = new Map<string, number>();
  const memberSet = new Set(memberIds);

  if (method === "manual") {
    const manual = (args.manualSplits ?? []).filter((s) => memberSet.has(s.member_id));
    const sumPct = (args.manualSplits ?? []).reduce((sum, s) => sum + s.percentage, 0);
    if (sumPct > 0) {
      for (const s of manual) shares.set(s.member_id, amount * (s.percentage / sumPct));
      return shares;
    }
  }

  if (method === "by_income") {
    const monthMap = args.incomeByMonthAndMember.get(date.slice(0, 7));
    const monthTotal = memberIds.reduce((sum, id) => sum + (monthMap?.get(id) ?? 0), 0);
    if (monthTotal > 0) {
      for (const id of memberIds) shares.set(id, amount * ((monthMap?.get(id) ?? 0) / monthTotal));
      return shares;
    }
    const configuredTotal = memberIds.reduce((sum, id) => sum + (args.configuredIncomeByMember.get(id) ?? 0), 0);
    if (configuredTotal > 0) {
      for (const id of memberIds) shares.set(id, amount * ((args.configuredIncomeByMember.get(id) ?? 0) / configuredTotal));
      return shares;
    }
  }

  if (memberIds.length === 0) return shares;
  for (const id of memberIds) shares.set(id, amount / memberIds.length);
  return shares;
}
