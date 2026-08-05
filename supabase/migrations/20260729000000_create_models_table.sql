-- Create global models table for storing verified OpenRouter free models.
-- This table is NOT user-scoped; it is shared across all authenticated users.

create table if not exists models (
  id text primary key,
  name text not null,
  provider text not null,
  last_verified_at timestamptz not null default now()
);

-- Enable RLS
alter table models enable row level security;

-- Allow any authenticated user to read models
create policy "Authenticated users can read models"
  on models
  for select
  using (auth.role() = 'authenticated');

-- Allow any authenticated user to upsert models
-- (The fetch route runs server-side with the anon key and authenticated session)
create policy "Authenticated users can upsert models"
  on models
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
