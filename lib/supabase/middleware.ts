import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the user's auth token on every request so sessions stay alive.
// Admin routes stay protected at the edge; user-facing pages render their own
// signed-out prompts so readers understand what signing in unlocks.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;

  // Skip session refresh on the OAuth callback — getUser() here would
  // consume the auth state cookie before exchangeCodeForSession() can use it,
  // causing "bad_oauth_state" errors.
  if (pathname.startsWith("/auth/callback")) {
    return response;
  }

  // Refresh the session — this keeps the user logged in
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected routes: if not logged in, redirect to home.
  const protectedPaths = ["/dashboard", "/admin"];
  const isProtected =
    protectedPaths.some((path) => pathname.startsWith(path));

  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.searchParams.set("login", "required");
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
