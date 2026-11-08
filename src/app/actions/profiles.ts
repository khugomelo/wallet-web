"use server";

/** User profile rows: theme, locale, avatar, names; used by dashboard layout. */

import { createClient, getAuthUser } from "@/lib/supabase/server";

export type ThemeMode = "light" | "dark" | "system";
export type LanguageCode = "en" | "pt" | "es" | "fr";

export type Profile = {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  birth_date: string | null;
  country: string | null;
  theme: ThemeMode;
  language: LanguageCode;
};

/**
 * Fetch profile for user. If missing, create from metadata (or empty) and return.
 */
export async function getOrEnsureProfile(
  userId: string,
  metadata?: { first_name?: string | null; last_name?: string | null } | null
): Promise<Profile> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("profiles")
    .select("first_name, last_name, avatar_url, birth_date, country, theme, language")
    .eq("id", userId)
    .single();

  if (existing) {
    return {
      first_name: existing.first_name ?? null,
      last_name: existing.last_name ?? null,
      avatar_url: existing.avatar_url ?? null,
      birth_date: existing.birth_date ?? null,
      country: existing.country ?? null,
      theme: (existing.theme as ThemeMode) ?? "system",
      language: (existing.language as LanguageCode) ?? "en",
    };
  }

  const first_name = (metadata?.first_name ?? "")?.trim() || null;
  const last_name = (metadata?.last_name ?? "")?.trim() || null;
  await supabase.from("profiles").insert({ id: userId, first_name, last_name });

  return {
    first_name,
    last_name,
    avatar_url: null,
    birth_date: null,
    country: null,
    theme: "system",
    language: "en",
  };
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE_MB = 2;

/**
 * Update profile (first_name, last_name) and optionally upload a new avatar.
 * Returns { error } on failure.
 */
export async function updateProfile(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const first_name = (formData.get("first_name") as string)?.trim() || null;
  const last_name = (formData.get("last_name") as string)?.trim() || null;
  const birth_date = (formData.get("birth_date") as string)?.trim() || null;
  const country = (formData.get("country") as string)?.trim() || null;
  const photo = formData.get("photo") as File | null;

  let avatar_url: string | null = null;

  if (photo && photo.size > 0) {
    if (!ALLOWED_TYPES.includes(photo.type)) {
      return { error: "Invalid image type. Use JPEG, PNG, WebP or GIF." };
    }
    if (photo.size > MAX_SIZE_MB * 1024 * 1024) {
      return { error: `Image must be under ${MAX_SIZE_MB} MB.` };
    }
    const ext = photo.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/avatar.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("avatars")
      .upload(path, photo, { upsert: true });
    if (uploadErr) return { error: uploadErr.message };
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    avatar_url = urlData.publicUrl;
  }

  const updates: Record<string, string | null> = {
    first_name,
    last_name,
    birth_date: birth_date || null,
    country: country || null,
  };
  if (avatar_url !== null) updates.avatar_url = avatar_url;

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id);
  if (error) return { error: error.message };

  return {};
}

/**
 * Save the user's theme preference (light / dark / system).
 */
export async function saveTheme(theme: ThemeMode): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("profiles")
    .update({ theme })
    .eq("id", user.id);
  if (error) return { error: error.message };
  return {};
}

/**
 * Save the user's language preference.
 */
export async function saveLanguage(language: LanguageCode): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("profiles")
    .update({ language })
    .eq("id", user.id);
  if (error) return { error: error.message };
  return {};
}
