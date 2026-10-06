-- Fix staff write permissions across all app entry modules
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
          when 'products' then ('products' = any(m.permissions) or 'production' = any(m.permissions))
          when 'dealers' then ('dealers' = any(m.permissions) or 'sales' = any(m.permissions))
          when 'batches' then ('production' = any(m.permissions) or 'products' = any(m.permissions))
          when 'sales' then ('sales' = any(m.permissions))
          when 'expenses' then ('expenses' = any(m.permissions))
          when 'supplierPurchases' then ('supplierPurchases' = any(m.permissions) or 'purchases' = any(m.permissions) or 'production' = any(m.permissions))
          when 'purchaseOrders' then ('purchaseOrders' = any(m.permissions) or 'purchases' = any(m.permissions))
          when 'employees' then ('employees' = any(m.permissions) or 'hr' = any(m.permissions))
          when 'employeePayments' then ('employeePayments' = any(m.permissions) or 'hr' = any(m.permissions))
          when 'attendance' then ('attendance' = any(m.permissions))
          when 'staffTargets' then ('staffTargets' = any(m.permissions) or 'targets' = any(m.permissions))
          when 'workTasks' then ('tasks' = any(m.permissions) or 'workTasks' = any(m.permissions))
          when 'materialUsages' then ('materialUsage' = any(m.permissions) or 'production' = any(m.permissions))
          when 'srVisits' then ('srDuties' = any(m.permissions) or 'reports' = any(m.permissions))
          when 'doOrders' then ('doPad' = any(m.permissions) or 'doOrders' = any(m.permissions))
          when 'capitalTransactions' then ('finance' = any(m.permissions) or 'capitalTransactions' = any(m.permissions))
          when 'fixedAssets' then ('fixedAssets' = any(m.permissions) or 'finance' = any(m.permissions))
          when 'activityLogs' then true
          else p_collection = any(m.permissions)
        end
      )
  );
$$;