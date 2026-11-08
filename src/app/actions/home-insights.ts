"use server";

/** Home briefing aggregates for a wallet and selected period (month, year, custom range). */

import { createClient } from "@/lib/supabase/server";

type LocaleCode = "en" | "pt" | "es" | "fr";
export type HomeInsightsPeriod = "month_to_date" | "last_month" | "this_year" | "custom";

type BriefingData = {
  anchorYear: number;
  anchorMonth: number;
  prevYear: number;
  prevMonth: number;
  hasAnyTransactions: boolean;
  monthIncome: number;
  monthExpenses: number;
  prevIncome: number;
  prevExpenses: number;
  busiestDay: { date: string; count: number } | null;
  topDays: Array<{ date: string; count: number }>;
  incomeChangePct: number | null;
  subscriptionsSharePct: number;
  diningOutPotentialSave: number;
  topCategory: { name: string; amount: number; sharePct: number } | null;
  subscriptionDetails: Array<{ label: string; amount: number }>;
  expenseTopCategories: Array<{ name: string; amount: number; sharePct: number }>;
  longestNoExpenseStreak: number;
  longestNoExpenseStreakToDate: number;
  savingsRatePct: number;
  monthDiningOut: number;
  prevDiningOut: number;
  diningChangePct: number | null;
  anchorDayCutoff: number;
  analysisPeriod: HomeInsightsPeriod;
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  periodDays: number;
  currentTxCount: number;
  previousTxCount: number;
  categoryEvolution: Array<{ name: string; current: number; previous: number; changePct: number | null }>;
  news: Array<{ title: string; link: string; source: string }>;
  fact: string;
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function monthRangeUTC(year: number, month1to12: number) {
  const start = `${year}-${String(month1to12).padStart(2, "0")}-01`;
  const endDay = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const end = `${year}-${String(month1to12).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return { start, end };
}

function formatDateUTC(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addDaysUTC(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateUTC(d);
}

function daysBetweenInclusive(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  return Math.max(1, Math.floor((e - s) / 86400000) + 1);
}

const MAX_HOME_CUSTOM_RANGE_DAYS = 366;

function parseCustomRange(start: string, end: string): { start: string; end: string } | null {
  const s = start.trim().slice(0, 10);
  const e = end.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return null;
  if (s > e) return null;
  if (daysBetweenInclusive(s, e) > MAX_HOME_CUSTOM_RANGE_DAYS) return null;
  return { start: s, end: e };
}

function stripXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function getNewsConfig(locale: LocaleCode) {
  if (locale === "pt") return { hl: "pt-PT", gl: "PT", ceid: "PT:pt", q: "financas pessoais OR poupanca" };
  if (locale === "es") return { hl: "es-419", gl: "ES", ceid: "ES:es", q: "finanzas personales OR ahorro" };
  if (locale === "fr") return { hl: "fr", gl: "FR", ceid: "FR:fr", q: "finance personnelle OR epargne" };
  return { hl: "en-US", gl: "US", ceid: "US:en", q: "personal finance OR budgeting" };
}

async function fetchLocalizedNews(locale: LocaleCode): Promise<Array<{ title: string; link: string; source: string }>> {
  const { hl, gl, ceid, q } = getNewsConfig(locale);
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  try {
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    return items.slice(0, 3).map((item) => {
      const title = stripXml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const link = stripXml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
      const source = stripXml(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "Google News");
      return { title, link, source };
    }).filter((n) => n.title && n.link);
  } catch {
    return [];
  }
}

function factForLocale(locale: LocaleCode): string {
  const day = Math.floor((Date.now() / 86400000) % 10000);
  const facts: Record<LocaleCode, string[]> = {
    en: [
      "Compound interest grows most when you start early, even with small amounts.",
      "The 50/30/20 budgeting rule became popular because it is simple to keep long-term.",
      "Tracking expenses regularly is one of the strongest predictors of better savings habits.",
    ],
    pt: [
      "Os juros compostos funcionam melhor quando começa cedo, mesmo com valores pequenos.",
      "A regra 50/30/20 ficou popular por ser simples de manter no longo prazo.",
      "Registar despesas com frequência é um dos hábitos mais ligados a melhor poupança.",
    ],
    es: [
      "El interés compuesto funciona mejor cuando empiezas pronto, incluso con importes pequeños.",
      "La regla 50/30/20 se hizo popular por su simplicidad para mantenerla a largo plazo.",
      "Registrar gastos con frecuencia es uno de los hábitos más ligados al ahorro.",
    ],
    fr: [
      "Les intérêts composés sont plus efficaces quand on commence tôt, même avec de petits montants.",
      "La règle 50/30/20 est devenue populaire grâce à sa simplicité sur le long terme.",
      "Suivre ses dépenses régulièrement est fortement lié à de meilleures habitudes d'épargne.",
    ],
  };
  const list = facts[locale] ?? facts.en;
  return list[day % list.length];
}

export async function getHomeBriefing(
  walletId: string,
  locale: LocaleCode,
  selectedPeriod: HomeInsightsPeriod = "month_to_date",
  customRange?: { start: string; end: string } | null
): Promise<BriefingData> {
  const supabase = await createClient();
  // Independent of each other: start together instead of one after another.
  const newsPromise = fetchLocalizedNews(locale);
  const [{ data: latestTx }, { data: categories }] = await Promise.all([
    supabase
      .from("transactions")
      .select("date")
      .eq("wallet_id", walletId)
      .eq("status", "confirmed")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("categories").select("id, name, parent_id").eq("wallet_id", walletId),
  ]);

  const latestDate = latestTx?.date ? new Date(`${latestTx.date}T00:00:00Z`) : null;
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const now = latestDate && latestDate < todayUtc ? latestDate : todayUtc;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const currentMonthRange = monthRangeUTC(year, month);
  const previousMonthRange = monthRangeUTC(prevYear, prevMonth);
  const hasAnyTransactions = !!latestDate;

  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]));

  if (!hasAnyTransactions) {
    const news = await newsPromise;
    const fact = factForLocale(locale);
    return {
      anchorYear: year,
      anchorMonth: month,
      prevYear,
      prevMonth,
      hasAnyTransactions: false,
      monthIncome: 0,
      monthExpenses: 0,
      prevIncome: 0,
      prevExpenses: 0,
      busiestDay: null,
      topDays: [],
      incomeChangePct: null,
      subscriptionsSharePct: 0,
      diningOutPotentialSave: 0,
      topCategory: null,
      subscriptionDetails: [],
      expenseTopCategories: [],
      longestNoExpenseStreak: 0,
      longestNoExpenseStreakToDate: 0,
      savingsRatePct: 0,
      monthDiningOut: 0,
      prevDiningOut: 0,
      diningChangePct: null,
      anchorDayCutoff: Math.min(new Date().getUTCDate(), new Date(Date.UTC(year, month, 0)).getUTCDate()),
      analysisPeriod: "month_to_date",
      periodStart: currentMonthRange.start,
      periodEnd: currentMonthRange.start,
      previousPeriodStart: previousMonthRange.start,
      previousPeriodEnd: previousMonthRange.start,
      periodDays: 1,
      currentTxCount: 0,
      previousTxCount: 0,
      categoryEvolution: [],
      news,
      fact,
    };
  }

  const nowUtcDay = now.getUTCDate();
  const anchorDaysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cutoffDay = Math.min(nowUtcDay, anchorDaysInMonth);
  const monthToDateStart = currentMonthRange.start;
  const monthToDateEnd = `${year}-${String(month).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`;

  const twoMonthsAgoMonth = prevMonth === 1 ? 12 : prevMonth - 1;
  const twoMonthsAgoYear = prevMonth === 1 ? prevYear - 1 : prevYear;
  const twoMonthsAgoRange = monthRangeUTC(twoMonthsAgoYear, twoMonthsAgoMonth);
  const prevMonthCutoff = Math.min(cutoffDay, new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate());
  const prevMonthToDateRange = {
    start: previousMonthRange.start,
    end: `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(prevMonthCutoff).padStart(2, "0")}`,
  };
  const thisYearRange = {
    start: `${year}-01-01`,
    end: formatDateUTC(now),
  };
  const prevYearRange = {
    start: `${year - 1}-01-01`,
    end: `${year - 1}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`,
  };

  let analysisPeriod: HomeInsightsPeriod = "month_to_date";
  let customParsed: { start: string; end: string } | null = null;
  if (selectedPeriod === "custom" && customRange) {
    customParsed = parseCustomRange(customRange.start, customRange.end);
  }
  if (selectedPeriod === "custom" && customParsed) {
    analysisPeriod = "custom";
  } else if (selectedPeriod === "last_month") {
    analysisPeriod = "last_month";
  } else if (selectedPeriod === "this_year") {
    analysisPeriod = "this_year";
  } else {
    analysisPeriod = "month_to_date";
  }

  const customPreviousRange = (() => {
    if (!customParsed) return null;
    const n = daysBetweenInclusive(customParsed.start, customParsed.end);
    const prevEnd = addDaysUTC(customParsed.start, -1);
    const prevStart = addDaysUTC(prevEnd, -(n - 1));
    return { start: prevStart, end: prevEnd };
  })();

  const currentRange =
    analysisPeriod === "custom" && customParsed
      ? customParsed
      : analysisPeriod === "last_month"
        ? previousMonthRange
        : analysisPeriod === "this_year"
          ? thisYearRange
          : { start: monthToDateStart, end: monthToDateEnd };

  const previousRange =
    analysisPeriod === "custom" && customPreviousRange
      ? customPreviousRange
      : analysisPeriod === "last_month"
        ? twoMonthsAgoRange
        : analysisPeriod === "this_year"
          ? prevYearRange
          : prevMonthToDateRange;

  const periodDays = daysBetweenInclusive(currentRange.start, currentRange.end);

  const { data: tx } = await supabase
    .from("transactions")
    .select("date, type, amount, description, category_id")
    .eq("wallet_id", walletId)
    .eq("status", "confirmed")
    .gte("date", previousRange.start)
    .lte("date", currentRange.end);

  const rows = (tx ?? []) as Array<{
    date: string;
    type: "income" | "expense" | "transfer";
    amount: number;
    description: string | null;
    category_id: string | null;
  }>;

  let monthIncome = 0;
  let monthExpenses = 0;
  let prevIncome = 0;
  let prevExpenses = 0;
  const dayCount = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();
  const previousExpenseByCategory = new Map<string, number>();
  const subscriptionsByLabel = new Map<string, number>();
  const expenseDays = new Set<string>();
  let subscriptionsAmount = 0;
  let diningOutAmount = 0;
  let prevDiningOut = 0;
  let currentTxCount = 0;
  let previousTxCount = 0;

  const subscriptionKeywords = ["subscription", "streaming", "netflix", "spotify", "subscricao", "suscripcion", "abonnement"];
  const diningKeywords = ["restaurant", "dining", "comer fora", "restaurante", "cafeteria", "bar", "uber eats", "ubereats"];

  for (const row of rows) {
    const amount = Number(row.amount);
    const inCurrent = row.date >= currentRange.start && row.date <= currentRange.end;
    const inPrevious = row.date >= previousRange.start && row.date <= previousRange.end;

    if (inCurrent) {
      currentTxCount += 1;
      dayCount.set(row.date, (dayCount.get(row.date) ?? 0) + 1);
      if (row.type === "income") monthIncome += amount;
      if (row.type === "expense") {
        monthExpenses += amount;
        expenseDays.add(row.date);

        const cat = row.category_id ? categoryById.get(row.category_id) : null;
        const root = cat?.parent_id ? categoryById.get(cat.parent_id) ?? cat : cat;
        const rootName = root?.name ?? "Other";
        expenseByCategory.set(rootName, (expenseByCategory.get(rootName) ?? 0) + amount);

        const sourceText = `${row.description ?? ""} ${cat?.name ?? ""} ${root?.name ?? ""}`;
        const normalized = normalizeText(sourceText);
        if (subscriptionKeywords.some((k) => normalized.includes(k))) subscriptionsAmount += amount;
        if (subscriptionKeywords.some((k) => normalized.includes(k))) {
          const label = row.description?.trim() || rootName;
          subscriptionsByLabel.set(label, (subscriptionsByLabel.get(label) ?? 0) + amount);
        }
        if (diningKeywords.some((k) => normalized.includes(k))) diningOutAmount += amount;
      }
    }

    if (inPrevious) {
      previousTxCount += 1;
      if (row.type === "income") prevIncome += amount;
      if (row.type === "expense") {
        prevExpenses += amount;
        const cat = row.category_id ? categoryById.get(row.category_id) : null;
        const root = cat?.parent_id ? categoryById.get(cat.parent_id) ?? cat : cat;
        const rootName = root?.name ?? "Other";
        previousExpenseByCategory.set(rootName, (previousExpenseByCategory.get(rootName) ?? 0) + amount);
        const sourceText = `${row.description ?? ""} ${cat?.name ?? ""} ${root?.name ?? ""}`;
        const normalized = normalizeText(sourceText);
        if (diningKeywords.some((k) => normalized.includes(k))) prevDiningOut += amount;
      }
    }
  }

  let busiestDay: { date: string; count: number } | null = null;
  dayCount.forEach((count, date) => {
    if (!busiestDay || count > busiestDay.count) busiestDay = { date, count };
  });
  const topDays = Array.from(dayCount.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (b.count - a.count) || a.date.localeCompare(b.date))
    .slice(0, 7);

  const incomeChangePct = prevIncome > 0 && monthIncome > 0
    ? ((monthIncome - prevIncome) / prevIncome) * 100
    : null;
  const subscriptionsSharePct = monthExpenses > 0 ? (subscriptionsAmount / monthExpenses) * 100 : 0;
  const diningOutPotentialSave = diningOutAmount * 0.1;

  let topCategory: { name: string; amount: number; sharePct: number } | null = null;
  expenseByCategory.forEach((amount, name) => {
    if (!topCategory || amount > topCategory.amount) {
      topCategory = {
        name,
        amount,
        sharePct: monthExpenses > 0 ? (amount / monthExpenses) * 100 : 0,
      };
    }
  });
  const expenseTopCategories = Array.from(expenseByCategory.entries())
    .map(([name, amount]) => ({
      name,
      amount,
      sharePct: monthExpenses > 0 ? (amount / monthExpenses) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  const subscriptionDetails = Array.from(subscriptionsByLabel.entries())
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const categoryUnion = new Set<string>([
    ...Array.from(expenseByCategory.keys()),
    ...Array.from(previousExpenseByCategory.keys()),
  ]);
  const categoryEvolution = Array.from(categoryUnion)
    .map((name) => {
      const current = expenseByCategory.get(name) ?? 0;
      const previous = previousExpenseByCategory.get(name) ?? 0;
      const changePct = previous > 0 ? ((current - previous) / previous) * 100 : null;
      return { name, current, previous, changePct };
    })
    .sort((a, b) => (b.current + b.previous) - (a.current + a.previous))
    .slice(0, 6);

  const daysInMonth = periodDays;
  let longestNoExpenseStreak = 0;
  let currentStreak = 0;
  for (let d = 0; d < daysInMonth; d += 1) {
    const dayKey = addDaysUTC(currentRange.start, d);
    if (expenseDays.has(dayKey)) {
      currentStreak = 0;
    } else {
      currentStreak += 1;
      if (currentStreak > longestNoExpenseStreak) longestNoExpenseStreak = currentStreak;
    }
  }
  let longestNoExpenseStreakToDate = 0;
  let currentStreakToDate = 0;
  for (let d = 0; d < daysInMonth; d += 1) {
    const dayKey = addDaysUTC(currentRange.start, d);
    if (expenseDays.has(dayKey)) {
      currentStreakToDate = 0;
    } else {
      currentStreakToDate += 1;
      if (currentStreakToDate > longestNoExpenseStreakToDate) longestNoExpenseStreakToDate = currentStreakToDate;
    }
  }

  const savingsRatePct = monthIncome > 0 ? Math.max(0, ((monthIncome - monthExpenses) / monthIncome) * 100) : 0;
  const diningChangePct =
    prevDiningOut > 0
      ? ((diningOutAmount - prevDiningOut) / prevDiningOut) * 100
      : null;
  const news = await newsPromise;
  const fact = factForLocale(locale);

  const anchorYearOut =
    analysisPeriod === "custom" && customParsed ? parseInt(customParsed.end.slice(0, 4), 10) : year;
  const anchorMonthOut =
    analysisPeriod === "custom" && customParsed ? parseInt(customParsed.end.slice(5, 7), 10) : month;
  const anchorDayCutoffOut =
    analysisPeriod === "custom" && customParsed ? parseInt(customParsed.end.slice(8, 10), 10) : cutoffDay;

  return {
    anchorYear: anchorYearOut,
    anchorMonth: anchorMonthOut,
    prevYear,
    prevMonth,
    hasAnyTransactions,
    monthIncome,
    monthExpenses,
    prevIncome,
    prevExpenses,
    busiestDay,
    topDays,
    incomeChangePct,
    subscriptionsSharePct,
    diningOutPotentialSave,
    topCategory,
    subscriptionDetails,
    expenseTopCategories,
    longestNoExpenseStreak,
    longestNoExpenseStreakToDate,
    savingsRatePct,
    monthDiningOut: diningOutAmount,
    prevDiningOut,
    diningChangePct,
    anchorDayCutoff: anchorDayCutoffOut,
    analysisPeriod,
    periodStart: currentRange.start,
    periodEnd: currentRange.end,
    previousPeriodStart: previousRange.start,
    previousPeriodEnd: previousRange.end,
    periodDays,
    currentTxCount,
    previousTxCount,
    categoryEvolution,
    news,
    fact,
  };
}
