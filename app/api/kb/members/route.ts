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

    const adminClient = createAdminClient();

    // 1. Fetch current members from profiles
    const { data: profiles, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, email, role")
      .eq("tenant_id", ctx.tenantId);

    if (profilesError) throw profilesError;

    // 2. Fetch all invites for this tenant to get their IDs
    const { data: allInvites, error: invitesError } = await adminClient
      .from("tenant_invites")
      .select("id, email, role, created_at, accepted_at")
      .eq("tenant_id", ctx.tenantId);

    if (invitesError) throw invitesError;

    const activeMembers: any[] = [];
    const pendingInvites: any[] = [];

    // 3. For each profile, check if they have ever signed in
    await Promise.all(
      (profiles ?? []).map(async (profile) => {
        try {
          const { data: { user } } = await adminClient.auth.admin.getUserById(profile.id);
          
          // If the user has never signed in, they are still "pending" verification/acceptance
          if (user && !user.last_sign_in_at) {
            // Find their corresponding invite to use its ID for cancellation
            const invite = allInvites?.find(i => i.email === profile.email);
            
            pendingInvites.push({
              id: invite ? invite.id : profile.id, // Fallback to profile ID if invite not found
              email: profile.email,
              role: profile.role,
              created_at: invite ? invite.created_at : user.created_at,
              _is_auth_user: true,
              _auth_id: profile.id
            });
          } else {
            activeMembers.push(profile);
          }
        } catch (e) {
          // If error fetching auth user, assume active
          activeMembers.push(profile);
        }
      })
    );

    // Also include any invites that never resulted in a profile (edge case)
    const profileEmails = new Set(profiles?.map(p => p.email) || []);
    allInvites?.forEach(invite => {
      if (!profileEmails.has(invite.email) && !invite.accepted_at) {
        pendingInvites.push({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          created_at: invite.created_at,
        });
      }
    });

    // Sort arrays
    activeMembers.sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      return a.email.localeCompare(b.email);
    });
    
    pendingInvites.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({
      members: activeMembers,
      pendingInvites,
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
      .insert({
        tenant_id: ctx.tenantId,
        email,
        role,
        invited_by: ctx.userId,
        accepted_at: null,
      });

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
      const origin = new URL(request.url).origin;
      const adminClient = createAdminClient();
      const { error: authInviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/auth/callback`,
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
  } catch (err: any) {
    console.error("POST /api/kb/members error:", err);
    const errorMessage = err?.message || (typeof err === "string" ? err : JSON.stringify(err));
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
