import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { AUTH_USER_HEADER } from "@/lib/supabase/middleware";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignore in Server Components
          }
        },
      },
    }
  );
}

/**
 * Current user, verified once per request by middleware (see AUTH_USER_HEADER).
 * Falls back to asking Supabase Auth if the header is missing.
 */
export const getAuthUser = cache(async (): Promise<User | null> => {
  const raw = headers().get(AUTH_USER_HEADER);
  if (raw) return JSON.parse(decodeURIComponent(raw)) as User;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
