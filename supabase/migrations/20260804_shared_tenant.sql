-- =============================================================
-- Shared Tenant + 3-Role RBAC Migration
-- Run AFTER: 20260731_tenant_invites.sql
-- Supabase Dashboard → SQL Editor
-- =============================================================

-- ── 1. UPGRADE ROLE SYSTEM ─────────────────────────────────────
-- Replace the binary admin/user system with explicit 3-role system:
--   user          → read-only member of a tenant
--   tenant_admin  → can manage their own tenant KB + invite members
--   shared_admin  → can manage the shared KB (manually assigned only)

-- Drop old constraint
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Backfill: existing 'admin' rows become 'tenant_admin'
UPDATE public.profiles
  SET role = 'tenant_admin'
  WHERE role = 'admin';

-- Add new 3-value constraint
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('user', 'tenant_admin', 'shared_admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Also update tenant_invites role constraint to match
ALTER TABLE public.tenant_invites
  DROP CONSTRAINT IF EXISTS tenant_invites_role_check;

DO $$ BEGIN
  ALTER TABLE public.tenant_invites
    ADD CONSTRAINT tenant_invites_role_check
    CHECK (role IN ('user', 'tenant_admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill invites too
UPDATE public.tenant_invites
  SET role = 'tenant_admin'
  WHERE role = 'admin';

-- ── 2. SHARED TENANT ───────────────────────────────────────────

-- Add is_shared flag to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

-- Only one shared tenant allowed (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS tenants_one_shared_idx
  ON public.tenants (is_shared)
  WHERE is_shared = true;

-- Insert the singleton Shared Tenant with a stable, known UUID
-- ON CONFLICT DO NOTHING makes this safe to run multiple times
INSERT INTO public.tenants (id, name, is_shared)
VALUES ('00000000-0000-0000-0000-000000000001', 'Shared Knowledge Base', true)
ON CONFLICT (id) DO NOTHING;

-- ── 3. UPDATED RLS — TENANTS ───────────────────────────────────

DROP POLICY IF EXISTS "Users can view own tenant" ON public.tenants;
CREATE POLICY "Users can view own tenant"
  ON public.tenants FOR SELECT
  USING (
    id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    OR is_shared = true
  );


-- ── 4. UPDATED RLS — DOCUMENTS ─────────────────────────────────

-- SELECT: own tenant OR shared tenant (read-only for all)
DROP POLICY IF EXISTS "Tenant members can view documents" ON public.documents;
CREATE POLICY "Tenant members can view documents"
  ON public.documents FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    OR tenant_id = '00000000-0000-0000-0000-000000000001'
  );

-- INSERT: own tenant (tenant_admin+) OR shared tenant (shared_admin only)
DROP POLICY IF EXISTS "Tenant members can insert documents" ON public.documents;
CREATE POLICY "Tenant members can insert documents"
  ON public.documents FOR INSERT
  WITH CHECK (
    (
      tenant_id  = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('tenant_admin', 'shared_admin')
    )
    OR
    (
      tenant_id = '00000000-0000-0000-0000-000000000001'
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'shared_admin'
    )
  );

-- UPDATE: own tenant (tenant_admin+) OR shared tenant (shared_admin only)
DROP POLICY IF EXISTS "Tenant members can update documents" ON public.documents;
CREATE POLICY "Tenant members can update documents"
  ON public.documents FOR UPDATE
  USING (
    (
      tenant_id  = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('tenant_admin', 'shared_admin')
    )
    OR
    (
      tenant_id = '00000000-0000-0000-0000-000000000001'
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'shared_admin'
    )
  );

-- DELETE: same pattern
DROP POLICY IF EXISTS "Tenant members can delete documents" ON public.documents;
CREATE POLICY "Tenant members can delete documents"
  ON public.documents FOR DELETE
  USING (
    (
      tenant_id  = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('tenant_admin', 'shared_admin')
    )
    OR
    (
      tenant_id = '00000000-0000-0000-0000-000000000001'
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'shared_admin'
    )
  );


-- ── 5. UPDATED RLS — DOCUMENT CHUNKS ───────────────────────────

-- SELECT: own tenant OR shared tenant
DROP POLICY IF EXISTS "Tenant members can view chunks" ON public.document_chunks;
CREATE POLICY "Tenant members can view chunks"
  ON public.document_chunks FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    OR tenant_id = '00000000-0000-0000-0000-000000000001'
  );

-- INSERT: own tenant (tenant_admin+) OR shared tenant (shared_admin only)
DROP POLICY IF EXISTS "Tenant members can insert chunks" ON public.document_chunks;
CREATE POLICY "Tenant members can insert chunks"
  ON public.document_chunks FOR INSERT
  WITH CHECK (
    (
      tenant_id  = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('tenant_admin', 'shared_admin')
    )
    OR
    (
      tenant_id = '00000000-0000-0000-0000-000000000001'
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'shared_admin'
    )
  );

-- DELETE: same pattern
DROP POLICY IF EXISTS "Tenant members can delete chunks" ON public.document_chunks;
CREATE POLICY "Tenant members can delete chunks"
  ON public.document_chunks FOR DELETE
  USING (
    (
      tenant_id  = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('tenant_admin', 'shared_admin')
    )
    OR
    (
      tenant_id = '00000000-0000-0000-0000-000000000001'
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'shared_admin'
    )
  );


-- ── 6. UPDATE handle_new_user TRIGGER ──────────────────────────
-- New signups without an invite get role='tenant_admin' (was 'admin').
-- Invited users inherit the role from their invite record,
-- which is constrained to 'user' | 'tenant_admin' only.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_tenant_id  uuid;
  assigned_role  text := 'tenant_admin';
  invite_id      uuid;
BEGIN
  SELECT id, tenant_id, role
  INTO invite_id, new_tenant_id, assigned_role
  FROM public.tenant_invites
  WHERE email = NEW.email
    AND accepted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF invite_id IS NULL THEN
    INSERT INTO public.tenants (name)
    VALUES (COALESCE(NEW.email, 'My Organization'))
    RETURNING id INTO new_tenant_id;

    assigned_role := 'tenant_admin';
  ELSE
    UPDATE public.tenant_invites
    SET accepted_at = now()
    WHERE id = invite_id;
  END IF;

  INSERT INTO public.profiles (id, email, tenant_id, role)
  VALUES (NEW.id, COALESCE(NEW.email, ''), new_tenant_id, assigned_role)
  ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        role      = EXCLUDED.role;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();


-- ── 7. GRANT SHARED ADMIN (MANUAL STEP) ────────────────────────
-- Run this in the SQL Editor to promote a specific user:
--
--   UPDATE public.profiles
--     SET role = 'shared_admin'
--     WHERE email = 'your-admin@example.com';
--
-- To verify:
--   SELECT id, email, role FROM public.profiles WHERE role = 'shared_admin';
