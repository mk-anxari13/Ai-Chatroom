import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Auth Callback Route
 *
 * Supabase invite emails redirect here with ?token_hash=XXX&type=invite
 * after the user clicks the link. This route exchanges the OTP token,
 * establishing the user's session.
 *
 * Tenant assignment happens automatically in the handle_new_user DB trigger
 * (which fires when inviteUserByEmail creates the auth.users record).
 * By the time the user clicks the invite link, they are already in the correct tenant.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = url.searchParams.get("next") ?? "/";

  const redirectBase = new URL(request.url).origin;

  // If there's no token this isn't an invite callback — just redirect home
  if (!tokenHash || type !== "invite") {
    return NextResponse.redirect(new URL(next, redirectBase));
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Cookie API can throw in some environments
          }
        },
      },
    }
  );

  // Exchange the OTP token — this logs the user in and sets the session cookie
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "invite",
  });

  if (error) {
    console.error("Auth callback OTP exchange error:", error.message);
    // Redirect to login with an error hint
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent("Invite link expired or already used.")}`, redirectBase)
    );
  }

  // Success — user is now logged in and already in the correct tenant (set by the DB trigger)
  return NextResponse.redirect(new URL(next, redirectBase));
}
