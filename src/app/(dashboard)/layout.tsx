/**
 * Authenticated shell: theme, wallet list + cookie, global transaction modals, sidebar + main outlet.
 */
import { getAuthUser } from "@/lib/supabase/server";
import { getActiveWallets, getProfileForRequest } from "@/lib/request-cache";
import { redirect } from "next/navigation";
import { getWalletCookie } from "@/app/actions/wallet-cookie";
import { TransactionModalsProvider } from "@/contexts/TransactionModalsContext";
import { ThemeProvider, ThemeScript } from "@/contexts/ThemeContext";
import { WalletProvider } from "@/contexts/WalletContext";
import { TransactionModals } from "@/components/TransactionModals";
import { SidebarNav } from "@/components/SidebarNav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [profile, list, cookie] = await Promise.all([
    getProfileForRequest(user.id),
    getActiveWallets(),
    getWalletCookie(),
  ]);
  const firstName = (profile.first_name ?? "").trim() || null;
  const theme = profile.theme ?? "system";
  const meta = user.user_metadata as { avatar_url?: string } | undefined;
  const avatarUrl = profile.avatar_url?.trim() || meta?.avatar_url?.trim() || null;

  const currentWalletId =
    (cookie && list.some((w) => w.id === cookie)) ? cookie : list[0]?.id ?? null;

  return (
    <ThemeProvider initialTheme={theme}>
      <ThemeScript theme={theme} />
      <WalletProvider
        currentWalletId={currentWalletId}
        wallets={list}
        user={user}
        firstName={firstName}
        avatarUrl={avatarUrl}
      >
        <TransactionModalsProvider>
          <div className="flex w-full min-h-screen">
            <SidebarNav />
            <main className="flex-1 min-w-0 py-6">
              <div className="w-full px-4 lg:px-6 xl:px-8 2xl:px-10">{children}</div>
            </main>
          </div>
          <TransactionModals />
        </TransactionModalsProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}
