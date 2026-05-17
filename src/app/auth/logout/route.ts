import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sign the user out and bounce them home. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

// Allow `<a href="/auth/logout">` and direct browser nav to log out too.
export async function GET(request: NextRequest) {
  return POST(request);
}
