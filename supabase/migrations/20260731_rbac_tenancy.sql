-- =============================================================
-- RBAC + Multi-Tenancy + Knowledge Base Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================

-- ── 1. TENANTS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. ALTER PROFILES ─────────────────────────────────────────
-- Add tenant_id and role columns if they don't exist yet.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id),
  ADD COLUMN IF NOT EXISTS role      text NOT NULL DEFAULT 'admin';

-- Add role constraint (safe to run multiple times)
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'user'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. BACKFILL ───────────────────────────────────────────────
-- Create a tenant for every existing user that doesn't have one.

DO $$
DECLARE
  p RECORD;
  new_tenant_id uuid;
BEGIN
  FOR p IN
    SELECT id, email FROM public.profiles WHERE tenant_id IS NULL
  LOOP
    INSERT INTO public.tenants (name)
    VALUES (COALESCE(p.email, 'Default Tenant'))
    RETURNING id INTO new_tenant_id;

    UPDATE public.profiles
    SET tenant_id = new_tenant_id, role = 'admin'
    WHERE id = p.id;
  END LOOP;
END $$;

-- Now make tenant_id NOT NULL
ALTER TABLE public.profiles
  ALTER COLUMN tenant_id SET NOT NULL;

-- ── 4. DOCUMENTS ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.documents (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  filename           text        NOT NULL,
  uploaded_by        uuid        NOT NULL REFERENCES public.profiles(id),
  upload_date        timestamptz NOT NULL DEFAULT now(),
  processing_status  text        NOT NULL DEFAULT 'pending'
                     CHECK (processing_status IN ('pending', 'processing', 'done', 'error')),
  chunk_count        int         NOT NULL DEFAULT 0,
  file_size_bytes    bigint,
  -- Stored for re-processing without re-upload (max ~50 KB text)
  extracted_text     text,
  error_message      text
);

-- ── 5. DOCUMENT CHUNKS ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_chunks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized tenant_id for fast RLS scoping without join
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id  uuid        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index  int         NOT NULL,
  chunk_text   text        NOT NULL,
  -- Extensible metadata: page_number, section, embedding_id go here later
  metadata     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Full-text search index (replace with pgvector index later)
CREATE INDEX IF NOT EXISTS document_chunks_fts_idx
  ON public.document_chunks USING GIN (to_tsvector('english', chunk_text));

-- Regular index for tenant scoping (fast filtering)
CREATE INDEX IF NOT EXISTS document_chunks_tenant_idx
  ON public.document_chunks (tenant_id);

-- ── 6. ROW LEVEL SECURITY ─────────────────────────────────────

-- TENANTS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own tenant" ON public.tenants;
CREATE POLICY "Users can view own tenant"
  ON public.tenants FOR SELECT
  USING (id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow trigger / service role to insert profiles
DROP POLICY IF EXISTS "Service can insert profiles" ON public.profiles;
CREATE POLICY "Service can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (true);

-- DOCUMENTS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view documents" ON public.documents;
CREATE POLICY "Tenant members can view documents"
  ON public.documents FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Tenant members can insert documents" ON public.documents;
CREATE POLICY "Tenant members can insert documents"
  ON public.documents FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Tenant members can update documents" ON public.documents;
CREATE POLICY "Tenant members can update documents"
  ON public.documents FOR UPDATE
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Tenant members can delete documents" ON public.documents;
CREATE POLICY "Tenant members can delete documents"
  ON public.documents FOR DELETE
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- DOCUMENT CHUNKS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view chunks" ON public.document_chunks;
CREATE POLICY "Tenant members can view chunks"
  ON public.document_chunks FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Tenant members can insert chunks" ON public.document_chunks;
CREATE POLICY "Tenant members can insert chunks"
  ON public.document_chunks FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Tenant members can delete chunks" ON public.document_chunks;
CREATE POLICY "Tenant members can delete chunks"
  ON public.document_chunks FOR DELETE
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- ── 7. AUTO-TENANT TRIGGER ────────────────────────────────────
-- Creates a tenant + profile row for every new Supabase Auth signup.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_tenant_id uuid;
BEGIN
  -- Create a personal tenant for this new user
  INSERT INTO public.tenants (name)
  VALUES (COALESCE(NEW.email, 'My Organization'))
  RETURNING id INTO new_tenant_id;

  -- Upsert profile (handles race conditions / duplicate triggers)
  INSERT INTO public.profiles (id, email, tenant_id, role)
  VALUES (NEW.id, COALESCE(NEW.email, ''), new_tenant_id, 'admin')
  ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        role      = COALESCE(profiles.role, 'admin');

  RETURN NEW;
END;
$$;

-- Replace any existing trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();
