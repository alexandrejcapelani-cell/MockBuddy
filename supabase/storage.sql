-- Supabase Storage for uploaded files: one private bucket. Each user's files live under a
-- folder named after their user id ("<user id>/materials/…", "<user id>/samples/…"), and
-- signed-in users can only add, read and delete files in their own folder. The app's
-- server works with files using the signed-in user's session, so these policies apply to
-- it too; no secret key is involved.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 52428800, array['application/pdf', 'text/plain', 'text/markdown'])
on conflict (id) do nothing;

create policy "uploads_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "uploads_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "uploads_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
