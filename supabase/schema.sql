create table if not exists profiles (
  id uuid primary key,
  email text not null,
  created_at timestamptz default now()
);

create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  role text not null,
  content text not null,
  model text,
  created_at timestamptz default now()
);
