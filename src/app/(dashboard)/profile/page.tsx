/** Profile settings: display name, theme, locale, devices, and preferences (RSC). */
import { getAuthUser } from "@/lib/supabase/server";
import { getProfileForRequest } from "@/lib/request-cache";
import { DevicesSection } from "@/components/DevicesSection";
import { LanguageSelector } from "@/components/LanguageSelector";
import { ProfileSettingsForm } from "@/components/ProfileSettingsForm";
import { ThemeSelector } from "@/components/ThemeSelector";
import { getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from "@/components/DashboardPageHeader";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const t = await getTranslations('settings');
  const user = await getAuthUser();
  if (!user) return null;

  const profile = await getProfileForRequest(user.id);

  return (
    <div className="space-y-10">
      <DashboardPageHeader title={t("title")} description={t("subtitle")} />
      <ProfileSettingsForm
        first_name={profile.first_name}
        last_name={profile.last_name}
        avatar_url={profile.avatar_url}
        birth_date={profile.birth_date}
        country={profile.country}
        email={user.email ?? ""}
      />
      <hr className="border-slate-200 dark:border-slate-700" />
      <div className="grid gap-8 md:grid-cols-2">
        <ThemeSelector />
        <LanguageSelector language={profile.language} />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("preferencesNote")}
      </p>
      <hr className="border-slate-200 dark:border-slate-700" />
      <DevicesSection />
    </div>
  );
}
