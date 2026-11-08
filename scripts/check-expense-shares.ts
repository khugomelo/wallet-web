// Run: node --experimental-strip-types scripts/check-expense-shares.ts
import assert from "node:assert/strict";
import { expenseShares } from "../src/lib/expense-shares.ts";
import { buildExpensesCsv } from "../src/lib/expenses-csv.ts";

const ids = ["a", "b", "c"];
const none = new Map<string, number>();
const round = (m: Map<string, number>) => Object.fromEntries(Array.from(m, ([k, v]) => [k, Math.round(v * 100) / 100]));

// by_income: shares follow that month's income (60% / 30% / 10%)
const jan = new Map([["2026-01", new Map([["a", 3000], ["b", 1500], ["c", 500]])]]);
assert.deepEqual(
  round(expenseShares({ amount: 50, date: "2026-01-11", method: "by_income", memberIds: ids, incomeByMonthAndMember: jan, configuredIncomeByMember: none })),
  { a: 30, b: 15, c: 5 }
);
// by_income with no income that month and nothing configured → equal split
assert.deepEqual(
  round(expenseShares({ amount: 30, date: "2026-02-01", method: "by_income", memberIds: ids, incomeByMonthAndMember: jan, configuredIncomeByMember: none })),
  { a: 10, b: 10, c: 10 }
);
// manual percentages are normalised
assert.deepEqual(
  round(expenseShares({ amount: 100, date: "2026-01-01", method: "manual", memberIds: ids, manualSplits: [{ member_id: "a", percentage: 30 }, { member_id: "b", percentage: 10 }], incomeByMonthAndMember: jan, configuredIncomeByMember: none })),
  { a: 75, b: 25 }
);

// CSV: quoting, empty share cells, yes/no
const csv = buildExpensesCsv(
  [{ walletName: "Home", date: "2026-01-11", description: 'Shop "A", Ltd', total: 40.99, category: "Groceries", subcategory: "Groceries", essential: true, paidBy: "Ann", shares: { a: 26.11 } }],
  [{ id: "a", name: "Ann" }, { id: "b", name: "Ben" }],
  { wallet: "W", description: "D", total: "T", date: "Dt", subcategory: "S", category: "C", essential: "E", paidBy: "P", yes: "Yes", no: "No" }
);
assert.equal(csv, '\uFEFFW,D,T,Ann,Ben,Dt,S,C,E,P\r\nHome,"Shop ""A"", Ltd",40.99,26.11,,2026-01-11,Groceries,Groceries,Yes,Ann');
console.log("ok");
