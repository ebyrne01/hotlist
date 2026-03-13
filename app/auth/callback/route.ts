import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  // Read return URL from cookie (set by AuthProvider before OAuth redirect)
  const returnCookie = request.cookies.get("auth_return_url")?.value;
  const returnUrl = returnCookie ? decodeURIComponent(returnCookie) : "/";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const response = NextResponse.redirect(`${origin}${returnUrl}`);
      // Clear the cookie
      response.cookies.set("auth_return_url", "", { path: "/", maxAge: 0 });
      return response;
    }
  }

  // If code exchange fails, redirect home
  return NextResponse.redirect(`${origin}/`);
}
