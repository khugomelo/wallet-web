import { getActiveWallets } from "@/lib/request-cache";

/**
 * Resolves the active wallet for dashboard/report pages: cookie if valid, else first active wallet
 * (same rule and same cached list as the dashboard layout).
 */
export async function getActiveWalletContext(cookieWalletId: string | null): Promise<{
  currentWalletId: string | null;
  walletTracksBalances: boolean;
}> {
  const list = await getActiveWallets();
  const current = list.find((w) => w.id === cookieWalletId) ?? list[0] ?? null;
  return {
    currentWalletId: current?.id ?? null,
    walletTracksBalances: current?.tracking_mode !== "basic",
  };
}
