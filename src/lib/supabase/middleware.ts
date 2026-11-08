import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Verified user, handed from middleware to the rest of the request so server code
 * doesn't ask Supabase Auth again. Always overwritten here, so clients can't spoof it.
 */
export const AUTH_USER_HEADER = "x-jwallet-auth-user";

export async function updateSession(request: NextRequest) {
  request.headers.delete(AUTH_USER_HEADER);
  const refreshedCookies: { name: string; value: string; options?: object }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          refreshedCookies.push(...cookiesToSet);
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Refreshed tokens must reach the browser too, or every request refreshes again (and sessions get revoked).
  const withCookies = (res: NextResponse) => {
    refreshedCookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
    return res;
  };

  const isAuthPage =
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/signup";
  const isRoot = request.nextUrl.pathname === "/";

  if (user && (isAuthPage || isRoot)) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return withCookies(NextResponse.redirect(url));
  }

  const isProtected =
    request.nextUrl.pathname.startsWith("/home") ||
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/portfolio") ||
    request.nextUrl.pathname.startsWith("/transactions") ||
    request.nextUrl.pathname.startsWith("/statements") ||
    request.nextUrl.pathname.startsWith("/reports") ||
    request.nextUrl.pathname.startsWith("/recurring") ||
    request.nextUrl.pathname.startsWith("/accounts") ||
    request.nextUrl.pathname.startsWith("/users") ||
    request.nextUrl.pathname.startsWith("/categories") ||
    request.nextUrl.pathname.startsWith("/wallets") ||
    request.nextUrl.pathname.startsWith("/activity") ||
    request.nextUrl.pathname.startsWith("/profile");

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return withCookies(NextResponse.redirect(url));
  }

  if (user) request.headers.set(AUTH_USER_HEADER, encodeURIComponent(JSON.stringify(user)));
  return withCookies(NextResponse.next({ request }));
}
