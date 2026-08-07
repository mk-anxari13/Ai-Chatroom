import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext, checkRole } from "@/lib/rbac";

// ── GET /api/kb/members ───────────────────────────────────────
// Returns current members + pending invites for the tenant.
// Admin-only.

export async function GET() {
  try {
    const supabase = await createClient();
    const ctx = await getTenantContext(supabase);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deny = checkRole(ctx, "admin");
    if (deny) return deny;

    // Current members
    const { data: members, error: membersError } = await supabase
      .from("profiles")
      .select("id, email, role")
      .eq("tenant_id", ctx.tenantId)
      .order("role", { ascending: true })
      .order("email", { ascending: true });

    if (membersError) throw membersError;

    // Pending invites (not yet accepted)
    const { data: invites, error: invitesError } = await supabase
      .from("tenant_invites")
      .select("id, email, role, created_at")
      .eq("tenant_id", ctx.tenantId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });

    if (invitesError) throw invitesError;

    return NextResponse.json({
      members: members ?? [],
      pendingInvites: invites ?? [],
    });
  } catch (err) {
    console.error("GET /api/kb/members error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST /api/kb/members ─────────────────────────────────────
// Admin-only: invite a new member to the tenant.
// Body: { email: string, role?: 'user' | 'tenant_admin' }
// NOTE: 'shared_admin' cannot be assigned via invite — manual DB assignment only.

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const ctx = await getTenantContext(supabase);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deny = checkRole(ctx, "admin");
    if (deny) return deny;

    const body = (await request.json()) as { email?: string; role?: string };
    const email = body.email?.toLowerCase().trim();
    // Clamp to the two roles that can be assigned via invite
    const role = body.role === "tenant_admin" ? "tenant_admin" : "user";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    // Check if already a member of this tenant
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "This user is already a member of your organization" },
        { status: 409 }
      );
    }

    // Insert pending invite record FIRST (the DB trigger reads this on signup)
    const { error: inviteInsertError } = await supabase
      .from("tenant_invites")
      .upsert(
        {
          tenant_id: ctx.tenantId,
          email,
          role,
          invited_by: ctx.userId,
          accepted_at: null,
        },
        { onConflict: "email,tenant_id" }
      );

    if (inviteInsertError) {
      // Unique constraint = already invited
      if (inviteInsertError.code === "23505") {
        return NextResponse.json(
          { error: "An invite has already been sent to this email" },
          { status: 409 }
        );
      }
      throw inviteInsertError;
    }

    // Send the Supabase Auth invite email using the service-role key
    try {
      const adminClient = createAdminClient();
      const { error: authInviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      });

      if (authInviteError) {
        throw authInviteError;
      }
    } catch (inviteErr) {
      // Roll back the invite record if the email send failed or if client creation failed
      await supabase
        .from("tenant_invites")
        .delete()
        .eq("tenant_id", ctx.tenantId)
        .eq("email", email);

      throw inviteErr;
    }

    return NextResponse.json({ success: true, email, role });
  } catch (err) {
    console.error("POST /api/kb/members error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
