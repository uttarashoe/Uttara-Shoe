-- Fixed assets module
-- Run this once in Supabase SQL Editor after deploying this feature.

alter table public.app_records drop constraint if exists app_records_collection_check;

alter table public.app_records add constraint app_records_collection_check check (collection in (
  'materials', 'products', 'dealers', 'batches', 'sales', 'expenses',
  'supplierPurchases', 'purchaseOrders', 'employees', 'employeePayments',
  'attendance', 'staffTargets', 'workTasks', 'materialUsages', 'srVisits',
  'doOrders', 'activityLogs', 'capitalTransactions', 'fixedAssets'
));
