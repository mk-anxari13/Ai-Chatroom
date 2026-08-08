import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext, checkRole } from "@/lib/rbac";

// ── DELETE /api/kb/members/[inviteId] ────────────────────────
// Admin-only: cancel a pending invite.

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  try {
    const { inviteId } = await params;
    const supabase = await createClient();
    const ctx = await getTenantContext(supabase);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deny = checkRole(ctx, "admin");
    if (deny) return deny;

    const adminClient = createAdminClient();

    // 1. Fetch the invite first to get the email
    const { data: invite } = await adminClient
      .from("tenant_invites")
      .select("email")
      .eq("id", inviteId)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    // 2. Check if a profile was already created by the DB trigger
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", invite.email)
      .eq("tenant_id", ctx.tenantId)
      .single();

    // 3. Delete the invite (use adminClient since it was created by trigger)
    const { error } = await adminClient
      .from("tenant_invites")
      .delete()
      .eq("id", inviteId)
      .eq("tenant_id", ctx.tenantId);

    if (error) throw error;

    // 4. If a profile exists, check if they've ever signed in
    if (profile) {
      const { data: { user } } = await adminClient.auth.admin.getUserById(profile.id);
      
      // If they never signed in, they were just an invited ghost user. Delete them completely.
      if (user && !user.last_sign_in_at) {
        await adminClient.auth.admin.deleteUser(profile.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/kb/members/[inviteId] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
