-- Just enough of a Supabase database for the migrations and pgTAP tests to run
-- on a plain PostgreSQL server when Docker (and so `supabase db start`) is not
-- available. CI runs the same tests against the real Supabase stack.
--
-- Mirrors: the API roles, auth.users, auth.uid()/auth.role() reading the
-- request JWT claims, the storage schema, and Supabase's default grants on the
-- public schema (which the migrations deliberately revoke where needed).

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  "public" boolean default false,
  created_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid default auth.uid(),
  metadata jsonb,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare
  parts text[] := string_to_array(name, '/');
begin
  return parts[1:array_length(parts, 1) - 1];
end
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

create schema extensions;
create extension pgtap with schema extensions;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Supabase puts extensions on the search path and lets the API roles use them.
grant usage on schema extensions to anon, authenticated, service_role;
alter database postgres set search_path = "$user", public, extensions;
