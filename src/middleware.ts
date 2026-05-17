import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase auth session on every request and forwards
 * the (possibly rotated) cookies back to the browser.
 *
 * @supabase/ssr REQUIRES this — without it, sessions silently expire
 * mid-request and server components see `null` users despite a logged-in
 * browser.
 *
 * Static assets and Next.js internals are skipped via the `matcher`.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Touching auth.getUser() triggers session refresh + cookie rotation.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     *  - Next.js internals (_next/*)
     *  - Static files (anything containing a dot, like .png, .css)
     *  - favicon, robots, sitemap
     *  - Cron endpoint (server-to-server, doesn't need cookie refresh)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|api/cron).*)",
  ],
};
