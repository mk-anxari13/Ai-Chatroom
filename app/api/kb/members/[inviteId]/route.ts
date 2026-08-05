import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

    // RLS + belt-and-suspenders tenant check
    const { error } = await supabase
      .from("tenant_invites")
      .delete()
      .eq("id", inviteId)
      .eq("tenant_id", ctx.tenantId)
      .is("accepted_at", null); // only cancel pending invites

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/kb/members/[inviteId] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
