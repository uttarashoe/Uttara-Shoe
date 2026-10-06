-- Managing Director (manager) always has full access to all app records.
-- Staff/SR permissions remain unchanged.
-- Run this once in Supabase SQL Editor on the live database.

create or replace function public.uttara_member_manager()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active = true
      and m.role = 'manager'
  );
$$;

create or replace function public.uttara_can_write(p_collection text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_members m
    where m.user_id = (select auth.uid())
      and m.active = true
      and (
        m.role = 'manager'
        or (
          p_collection not in (
            'sales','products','materials','batches','materialUsages',
            'purchaseOrders','supplierPurchases','employees','employeePayments',
            'staffTargets','expenses','activityLogs','doOrders'
          )
          and (
            case p_collection
              when 'workTasks' then 'tasks'
              when 'srVisits' then 'srDuties'
              else p_collection
            end
          ) = any(m.permissions)
        )
      )
  );
$$;

revoke all on function public.uttara_member_manager() from public, anon;
revoke all on function public.uttara_can_write(text) from public, anon;
grant execute on function public.uttara_member_manager() to authenticated;
grant execute on function public.uttara_can_write(text) to authenticated;

alter table public.app_records enable row level security;

drop policy if exists "permitted members add own records" on public.app_records;
create policy "permitted members add own records" on public.app_records
  for insert to authenticated
  with check (
    public.uttara_member_manager()
    or (
      public.uttara_can_write(collection)
      and owner_id = (select auth.uid())
    )
  );

drop policy if exists "permitted members update own records" on public.app_records;
create policy "permitted members update own records" on public.app_records
  for update to authenticated
  using (
    public.uttara_member_manager()
    or (
      public.uttara_can_write(collection)
      and owner_id = (select auth.uid())
    )
  )
  with check (
    public.uttara_member_manager()
    or (
      public.uttara_can_write(collection)
      and owner_id = (select auth.uid())
    )
  );

drop policy if exists "manager removes app records" on public.app_records;
create policy "manager removes app records" on public.app_records
  for delete to authenticated
  using (public.uttara_member_manager());

-- Ensure the MD can read every module as well.
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
