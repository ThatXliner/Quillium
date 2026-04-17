-- Migration: 20260416000002_create_users.sql
-- Purpose: User profiles extending auth.users (DATA-01)
-- Source: RESEARCH.md Pattern 1, CONTEXT.md D-01 (display names only, no avatars)

create table public.users (
  id uuid not null references auth.users on delete cascade,
  display_name text,
  subscription_status text default 'free' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (id)
);

-- RLS skipped entirely for prototype (user preference over D-09 default)
-- MUST add RLS before production use

-- Auto-update timestamps via moddatetime (requires extension from previous migration)
create trigger handle_updated_at before update on public.users
  for each row execute procedure extensions.moddatetime (updated_at);

-- Auto-create profile on signup
-- Per RESEARCH.md: "security definer set search_path = ''" prevents search_path injection
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Anonymous'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

comment on table public.users is 'User profiles extending auth.users - DATA-01';
comment on column public.users.display_name is 'User display name (D-01: no avatars stored)';
comment on column public.users.subscription_status is 'Subscription tier: free, pro, etc.';
