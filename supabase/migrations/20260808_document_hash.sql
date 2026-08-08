-- Add content_hash column to documents table for duplicate detection
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_hash text;

-- Add a unique constraint so duplicate documents cannot be uploaded to the same tenant
ALTER TABLE public.documents
  ADD CONSTRAINT documents_tenant_id_content_hash_key UNIQUE (tenant_id, content_hash);
