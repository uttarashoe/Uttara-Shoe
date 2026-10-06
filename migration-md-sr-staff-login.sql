-- Uttara Shoe: MD / SR / Staff login roles
-- Run this once in the Supabase SQL Editor for the live database.
-- This migration is safe to run after the existing schema.sql.

alter table public.app_members
  drop constraint if exists app_members_role_check;

alter table public.app_members
  add constraint app_members_role_check
  check (role in ('manager', 'staff', 'sr'));

drop policy if exists "active members read app records" on public.app_records;

create policy "active members read app records" on public.app_records
  for select to authenticated
  using (
    public.uttara_can_read(collection)
    and (
      collection <> 'srVisits'
      or public.uttara_member_manager()
      or owner_id = (select auth.uid())
    )
  );
