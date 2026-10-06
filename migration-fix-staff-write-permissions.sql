-- Fix staff write permissions for materials/production-related entries
create or replace function public.uttara_can_write(p_collection text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid()) and m.active
      and (
        m.role = 'manager'
        or case p_collection
          when 'materials' then ('materials' = any(m.permissions) or 'production' = any(m.permissions))
          when 'materialUsages' then ('materialUsage' = any(m.permissions) or 'production' = any(m.permissions))
          when 'batches' then ('production' = any(m.permissions))
          when 'workTasks' then ('tasks' = any(m.permissions))
          when 'srVisits' then ('srDuties' = any(m.permissions))
          when 'doOrders' then ('doPad' = any(m.permissions))
          when 'purchaseOrders' then ('purchaseOrders' = any(m.permissions))
          else p_collection = any(m.permissions)
        end
      )
  );
$$;