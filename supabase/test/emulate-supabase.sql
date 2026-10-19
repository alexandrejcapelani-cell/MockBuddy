-- Just enough of a Supabase project (roles, auth.users, auth.uid(), Storage tables) for
-- supabase/setup.sql and its policies to run in PGlite as they would on Supabase. Test-only.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email varchar(255), encrypted_password text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner uuid, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
