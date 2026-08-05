-- =============================================================
-- Tenant Invites Migration
-- Run this AFTER 20260731_rbac_tenancy.sql
-- Supabase Dashboard → SQL Editor
-- =============================================================

-- ── 1. TENANT INVITES TABLE ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_invites (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  role        text        NOT NULL DEFAULT 'user'
              CHECK (role IN ('admin', 'user')),
  invited_by  uuid        NOT NULL REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  -- One pending invite per email per tenant
  CONSTRAINT tenant_invites_email_tenant_unique UNIQUE (email, tenant_id)
);

-- ── 2. RLS ────────────────────────────────────────────────────

ALTER TABLE public.tenant_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view invites" ON public.tenant_invites;
CREATE POLICY "Tenant members can view invites"
  ON public.tenant_invites FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can create invites" ON public.tenant_invites;
CREATE POLICY "Admins can create invites"
  ON public.tenant_invites FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can delete invites" ON public.tenant_invites;
CREATE POLICY "Admins can delete invites"
  ON public.tenant_invites FOR DELETE
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- ── 3. UPGRADE handle_new_user TRIGGER ───────────────────────
-- When a user accepts an invite (Supabase creates their auth record),
-- the trigger checks tenant_invites first. If a pending invite exists,
-- the user lands directly in that tenant instead of getting a new one.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_tenant_id  uuid;
  assigned_role  text := 'admin';
  invite_id      uuid;
BEGIN
  -- Check for a pending invite for this email
  SELECT id, tenant_id, role
  INTO invite_id, new_tenant_id, assigned_role
  FROM public.tenant_invites
  WHERE email = NEW.email
    AND accepted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF invite_id IS NULL THEN
    -- No invite: create a personal tenant (original behaviour)
    INSERT INTO public.tenants (name)
    VALUES (COALESCE(NEW.email, 'My Organization'))
    RETURNING id INTO new_tenant_id;
  ELSE
    -- Accept the invite: mark it as done
    UPDATE public.tenant_invites
    SET accepted_at = now()
    WHERE id = invite_id;
  END IF;

  -- Upsert profile
  INSERT INTO public.profiles (id, email, tenant_id, role)
  VALUES (NEW.id, COALESCE(NEW.email, ''), new_tenant_id, assigned_role)
  ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        role      = EXCLUDED.role;

  RETURN NEW;
END;
$$;

-- Trigger is already installed from the previous migration —
-- replacing the function is enough. Run these lines anyway to be safe:
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();
