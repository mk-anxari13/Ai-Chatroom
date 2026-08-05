import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext, UserRole } from "@/types";

/**
 * Derives tenant context from the authenticated user's session.
 * NEVER trusts tenant_id / role from the client — always reads from the DB.
 */
export async function getTenantContext(
  supabase: SupabaseClient
): Promise<TenantContext | null> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !profile.tenant_id) return null;

  const role = (profile.role as UserRole) ?? "user";

  return {
    userId: user.id,
    tenantId: profile.tenant_id as string,
    role,
    isSharedAdmin: role === "shared_admin",
  };
}

// ── Role checks ───────────────────────────────────────────────

/**
 * Returns true if the user has any kind of admin privilege
 * (tenant_admin or shared_admin).
 */
export function isAdmin(ctx: TenantContext): boolean {
  return ctx.role === "tenant_admin" || ctx.role === "shared_admin";
}

/**
 * Throws a 403-like Error if the context doesn't have admin privilege.
 */
export function requireRole(ctx: TenantContext, required: "admin"): void {
  if (!isAdmin(ctx)) {
    throw new Error("FORBIDDEN: Admin role required");
  }
}

/**
 * Returns a 403 Response when the user lacks admin privilege.
 * Use in Next.js route handlers:
 *   const deny = checkRole(ctx, 'admin');
 *   if (deny) return deny;
 */
export function checkRole(
  ctx: TenantContext,
  required: "admin"
): Response | null {
  if (!isAdmin(ctx)) {
    return new Response(
      JSON.stringify({ error: "Forbidden: Admin role required" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return null;
}

/**
 * Returns a 403 Response when the user is not a shared_admin.
 * Shared KB writes must be gated by this check in addition to checkRole.
 */
export function checkSharedAdmin(ctx: TenantContext): Response | null {
  if (!ctx.isSharedAdmin) {
    return new Response(
      JSON.stringify({
        error: "Forbidden: Only the Shared KB administrator can modify shared documents.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return null;
}

/**
 * Throws if the user is not a shared_admin.
 */
export function requireSharedAdmin(ctx: TenantContext): void {
  if (!ctx.isSharedAdmin) {
    throw new Error("FORBIDDEN: Shared admin role required");
  }
}
