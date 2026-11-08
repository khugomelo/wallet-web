/** In-app home: smart briefing for the active wallet and selected insight period (RSC). */
import { getWalletCookie } from "@/app/actions/wallet-cookie";
import { getHomeBriefing, type HomeInsightsPeriod } from "@/app/actions/home-insights";
import { HomeSmartBriefing } from "@/components/HomeSmartBriefing";
import { getActiveWalletContext } from "@/lib/active-wallet-server";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

function parseHomePeriod(searchParams?: {
  insightPeriod?: string;
  from?: string;
  to?: string;
}): { period: HomeInsightsPeriod; customRange: { start: string; end: string } | null } {
  const raw = searchParams?.insightPeriod?.trim();
  const from = searchParams?.from?.trim().slice(0, 10) ?? "";
  const to = searchParams?.to?.trim().slice(0, 10) ?? "";
  if (raw === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) {
    return { period: "custom", customRange: { start: from, end: to } };
  }
  if (raw === "last_month") return { period: "last_month", customRange: null };
  if (raw === "this_year") return { period: "this_year", customRange: null };
  // Legacy: auto, last_30_days, month_to_date, unknown → this month
  return { period: "month_to_date", customRange: null };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: { insightPeriod?: string; from?: string; to?: string };
}) {
  const t = await getTranslations("home");
  const locale = (await getLocale()) as "en" | "pt" | "es" | "fr";
  const cookie = await getWalletCookie();
  const { currentWalletId } = await getActiveWalletContext(cookie);
  const { period: selectedPeriod, customRange } = parseHomePeriod(searchParams);

  const briefing = currentWalletId
    ? await getHomeBriefing(currentWalletId, locale, selectedPeriod, customRange)
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">{t("subtitle")}</p>
      </div>
      {!currentWalletId || !briefing ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-6 text-center">
          <p className="text-slate-600 dark:text-slate-400 mb-4">{t("emptyMessage")}</p>
          <Link
            href="/wallets"
            className="inline-block px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700"
          >
            {t("createWallet")}
          </Link>
        </div>
      ) : (
        <HomeSmartBriefing
          walletId={currentWalletId}
          data={briefing}
          selectedPeriod={selectedPeriod}
          customFrom={customRange?.start ?? null}
          customTo={customRange?.end ?? null}
        />
      )}
    </div>
  );
}
