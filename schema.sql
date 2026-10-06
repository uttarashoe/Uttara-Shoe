-- Uttara Shoes shared backend schema.
-- Review before applying; this file does not alter the live project by itself.

create table if not exists public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null default '',
  role text not null default 'staff' check (role in ('manager', 'staff', 'sr')),
  permissions text[] not null default '{}',
  max_discount numeric not null default 0 check (max_discount >= 0 and max_discount <= 100),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists app_members_display_name_unique
  on public.app_members (lower(display_name));

-- Every Auth account gets a disabled staff profile. A manager must activate it.
create or replace function public.uttara_provision_member()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.app_members m
    where lower(m.display_name) = lower(coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(coalesce(new.email,''),'@',1), 'Member'))
  ) then
    insert into public.app_members(user_id, display_name, email, role, permissions, active)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(coalesce(new.email,''),'@',1), 'Member') || ' (' || left(new.id::text,6) || ')',
      coalesce(new.email,''), 'staff', '{}', false
    )
    on conflict (user_id) do nothing;
  else
  insert into public.app_members(user_id, display_name, email, role, permissions, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(coalesce(new.email,''),'@',1), 'Member'),
    coalesce(new.email,''), 'staff', '{}', false
  )
  on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists uttara_auth_user_created on auth.users;
create trigger uttara_auth_user_created
  after insert on auth.users
  for each row execute function public.uttara_provision_member();

create table if not exists public.app_records (
  collection text not null check (collection in (
    'materials', 'products', 'dealers', 'batches', 'sales', 'expenses',
    'supplierPurchases', 'purchaseOrders', 'employees', 'employeePayments', 'activityLogs',
    'attendance', 'staffTargets', 'workTasks', 'materialUsages', 'srVisits', 'doOrders'
  )),
  record_id text not null,
  payload jsonb not null,
  owner_id uuid references auth.users(id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, record_id)
);

create index if not exists app_records_owner_idx on public.app_records(owner_id);
create index if not exists app_records_collection_idx on public.app_records(collection);

-- Existing app_records tables also allow members to append their own activity logs.
alter table public.app_records drop constraint if exists app_records_collection_check;
alter table public.app_records add constraint app_records_collection_check check (collection in (
  'materials', 'products', 'dealers', 'batches', 'sales', 'expenses',
  'supplierPurchases', 'purchaseOrders', 'employees', 'employeePayments',
  'attendance', 'staffTargets', 'workTasks', 'materialUsages', 'srVisits',
  'doOrders', 'activityLogs', 'capitalTransactions', 'fixedAssets'
));

create or replace function public.uttara_member_active()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid()) and m.active
  );
$$;

create or replace function public.uttara_member_manager()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid()) and m.active and m.role = 'manager'
  );
$$;

create or replace function public.uttara_can_read(p_collection text)
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
          when 'sales' then false
          when 'products' then false
          when 'dealers' then ('sales' = any(m.permissions) or 'dealers' = any(m.permissions))
          when 'materials' then ('production' = any(m.permissions) or 'materials' = any(m.permissions) or 'materialUsage' = any(m.permissions))
          when 'batches' then ('production' = any(m.permissions) or 'products' = any(m.permissions))
          when 'attendance' then 'attendance' = any(m.permissions)
          when 'workTasks' then 'tasks' = any(m.permissions)
          when 'srVisits' then ('srDuties' = any(m.permissions) or 'reports' = any(m.permissions))
          when 'activityLogs' then 'logs' = any(m.permissions)
          else false
        end
      )
  );
$$;

create or replace function public.uttara_staff_sale_view(p_sale jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_set(
    p_sale - 'costTotal' - 'profit',
    '{lines}',
    coalesce((select jsonb_agg(entries.line - 'unitCost') from jsonb_array_elements(coalesce(p_sale->'lines','[]'::jsonb)) as entries(line)), '[]'::jsonb)
  );
$$;

create or replace function public.uttara_list_sales_for_member()
returns table(record_id text, owner_id uuid, payload jsonb)
language plpgsql stable security definer
set search_path = ''
as $$
declare v_member public.app_members%rowtype;
begin
  select * into v_member from public.app_members where user_id = (select auth.uid()) and active;
  if not found or (v_member.role <> 'manager' and not ('sales' = any(v_member.permissions) or 'reports' = any(v_member.permissions))) then
    raise exception 'Not permitted to read sales';
  end if;
  return query select r.record_id, r.owner_id, public.uttara_staff_sale_view(r.payload)
    from public.app_records r where r.collection = 'sales' order by r.created_at;
end;
$$;

create or replace function public.uttara_list_products_for_sale()
returns setof jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_member public.app_members%rowtype;
begin
  select * into v_member from public.app_members where user_id = (select auth.uid()) and active;
  if not found or (v_member.role <> 'manager' and not ('sales' = any(v_member.permissions) or 'products' = any(v_member.permissions))) then
    raise exception 'Not permitted to read products';
  end if;
  return query
    select jsonb_strip_nulls(jsonb_build_object(
      'id', r.payload->>'id', 'model', r.payload->>'model', 'color', r.payload->>'color',
      'sizes', r.payload->>'sizes', 'qty', r.payload->'qty', 'unit', r.payload->>'unit',
      'price', r.payload->'price', 'dealerPrice', coalesce(r.payload->'dealerPrice',r.payload->'price'),
      'wholesalePrice', coalesce(r.payload->'wholesalePrice',r.payload->'dealerPrice',r.payload->'price'),
      'retailPrice', coalesce(r.payload->'retailPrice',r.payload->'price')
    )) from public.app_records r where r.collection = 'products' order by r.created_at;
end;
$$;

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
        or (
          p_collection not in ('sales', 'products', 'materials', 'batches', 'materialUsages', 'purchaseOrders', 'supplierPurchases', 'employees', 'employeePayments', 'staffTargets', 'expenses', 'activityLogs', 'doOrders')
          and (case p_collection
            when 'workTasks' then 'tasks'
            when 'srVisits' then 'srDuties'
            else p_collection
          end) = any(m.permissions)
        )
      )
  );
$$;

revoke all on function public.uttara_member_active() from public, anon;
revoke all on function public.uttara_member_manager() from public, anon;
revoke all on function public.uttara_can_read(text) from public, anon;
revoke all on function public.uttara_staff_sale_view(jsonb) from public, anon, authenticated;
revoke all on function public.uttara_list_sales_for_member() from public, anon;
revoke all on function public.uttara_list_products_for_sale() from public, anon;
revoke all on function public.uttara_can_write(text) from public, anon;
revoke all on function public.uttara_provision_member() from public, anon, authenticated;
grant execute on function public.uttara_member_active() to authenticated;
grant execute on function public.uttara_member_manager() to authenticated;
grant execute on function public.uttara_can_read(text) to authenticated;
grant execute on function public.uttara_list_sales_for_member() to authenticated;
grant execute on function public.uttara_list_products_for_sale() to authenticated;
grant execute on function public.uttara_can_write(text) to authenticated;

-- A sales member must submit invoices through this transaction. The RPC locks
-- and decrements stock, enforces the manager-set price, and inserts the invoice
-- as one database transaction; staff cannot write the sales/products rows directly.
create or replace function public.uttara_create_sale(p_sale jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_member public.app_members%rowtype;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_sale jsonb;
  v_product public.app_records%rowtype;
  v_dealer_type text;
  v_price numeric;
  v_qty numeric;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_stock numeric;
  v_cost numeric;
  v_cost_total numeric := 0;
  v_cost_known boolean := true;
  v_owner_name text;
  v_sale_id text;
  v_method text;
  v_reference text;
begin
  select * into v_member from public.app_members
    where user_id = (select auth.uid()) and active;
  if not found or (v_member.role <> 'manager' and not ('sales' = any(v_member.permissions))) then
    raise exception 'Not permitted to create sales';
  end if;
  if coalesce(jsonb_typeof(p_sale->'lines'), '') <> 'array' then
    raise exception 'Sale lines must be an array';
  end if;
  if jsonb_array_length(p_sale->'lines') = 0 then
    raise exception 'Sale must contain at least one line';
  end if;
  v_sale_id := p_sale->>'id';
  if v_sale_id is null or length(v_sale_id) > 80 then raise exception 'Invalid sale id'; end if;
  v_discount := greatest(coalesce((p_sale->>'discount')::numeric, 0), 0);
  v_paid := greatest(coalesce((p_sale->>'paid')::numeric, 0), 0);
  v_method := coalesce(p_sale->>'paymentMethod', '');
  v_reference := coalesce(p_sale#>>'{payments,0,reference}', '');
  select display_name into v_owner_name from public.app_members where user_id = (select auth.uid());

  select r.payload->>'type' into v_dealer_type
    from public.app_records r
    where r.collection = 'dealers' and r.payload->>'name' = p_sale->>'customer'
    order by case when r.owner_id = (select auth.uid()) then 0 else 1 end, r.created_at limit 1;

  for v_line in select value from jsonb_array_elements(p_sale->'lines') loop
    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 or v_qty <> trunc(v_qty) then raise exception 'Invalid sale quantity'; end if;
    select * into v_product from public.app_records
      where collection = 'products' and record_id = v_line->>'pid' for update;
    if not found then raise exception 'Product not found'; end if;
    v_stock := coalesce((v_product.payload->>'qty')::numeric, 0);
    if v_stock < v_qty then raise exception 'Insufficient stock'; end if;
    if p_sale->>'kind' = 'নিজস্ব দোকান' then
      v_price := coalesce(nullif(v_product.payload->>'retailPrice','')::numeric, nullif(v_product.payload->>'price','')::numeric, 0);
    elsif v_dealer_type = 'পাইকার' then
      v_price := coalesce(nullif(v_product.payload->>'wholesalePrice','')::numeric, nullif(v_product.payload->>'dealerPrice','')::numeric, nullif(v_product.payload->>'price','')::numeric, 0);
    else
      v_price := coalesce(nullif(v_product.payload->>'dealerPrice','')::numeric, nullif(v_product.payload->>'price','')::numeric, 0);
    end if;
    if (v_line->>'price')::numeric <> v_price then raise exception 'Price differs from manager-set price'; end if;
    v_subtotal := v_subtotal + v_qty * v_price;
    v_cost := nullif(v_product.payload->>'unitCost','')::numeric;
    if v_cost is null then v_cost_known := false; else v_cost_total := v_cost_total + v_qty * v_cost; end if;
    v_lines := v_lines || jsonb_build_array(v_line || jsonb_build_object('price', v_price, 'unitCost', v_cost));
    update public.app_records set payload = jsonb_set(payload, '{qty}', to_jsonb(v_stock - v_qty)), updated_at = now()
      where collection = 'products' and record_id = v_line->>'pid';
  end loop;

  if v_discount > v_subtotal then raise exception 'Discount exceeds subtotal'; end if;
  if v_member.role <> 'manager' and v_subtotal > 0 and (v_discount / v_subtotal * 100) > v_member.max_discount then
    raise exception 'Discount exceeds member allowance';
  end if;
  v_total := v_subtotal - v_discount;
  if v_paid > v_total then raise exception 'Payment exceeds sale total'; end if;
  v_sale := p_sale || jsonb_build_object(
    'lines', v_lines,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total', v_total,
    'paid', v_paid,
    'due', v_total - v_paid,
    'by', v_owner_name,
    'costTotal', case when v_cost_known then to_jsonb(v_cost_total) else 'null'::jsonb end,
    'profit', case when v_cost_known then to_jsonb(v_total - v_cost_total) else 'null'::jsonb end,
    'payments', case when v_paid > 0 then jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'date', coalesce(p_sale->>'date', current_date::text),
      'amount', v_paid,
      'method', v_method,
      'reference', v_reference,
      'by', v_owner_name
    )) else '[]'::jsonb end
  );
  insert into public.app_records(collection, record_id, payload, owner_id)
    values ('sales', v_sale_id, v_sale, (select auth.uid()));
  if v_member.role = 'manager' then return v_sale; end if;
  return public.uttara_staff_sale_view(v_sale);
end;
$$;

create or replace function public.uttara_receive_sale_payment(
  p_sale_id text, p_amount numeric, p_method text, p_reference text default ''
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sale public.app_records%rowtype;
  v_member public.app_members%rowtype;
  v_due numeric;
  v_paid numeric;
  v_owner_name text;
  v_payment jsonb;
  v_updated jsonb;
begin
  select * into v_member from public.app_members
    where user_id = (select auth.uid()) and active;
  if not found or (v_member.role <> 'manager' and not ('sales' = any(v_member.permissions))) then
    raise exception 'Not permitted to receive payments';
  end if;
  select * into v_sale from public.app_records
    where collection = 'sales' and record_id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_member.role <> 'manager' and v_sale.owner_id <> (select auth.uid()) then
    raise exception 'Members may collect payment only for their own sales';
  end if;
  v_due := coalesce((v_sale.payload->>'due')::numeric, 0);
  if p_amount is null or p_amount <= 0 or p_amount > v_due or round(p_amount,2) <> p_amount then
    raise exception 'Invalid payment amount';
  end if;
  select display_name into v_owner_name from public.app_members where user_id = (select auth.uid());
  v_paid := coalesce((v_sale.payload->>'paid')::numeric, 0) + p_amount;
  v_payment := jsonb_build_object('id', gen_random_uuid()::text, 'date', current_date::text,
    'amount', p_amount, 'method', p_method, 'reference', coalesce(p_reference,''), 'by', v_owner_name);
  v_updated := jsonb_set(v_sale.payload, '{payments}', coalesce(v_sale.payload->'payments','[]'::jsonb) || jsonb_build_array(v_payment));
  v_updated := jsonb_set(v_updated, '{paid}', to_jsonb(v_paid));
  v_updated := jsonb_set(v_updated, '{due}', to_jsonb(v_due - p_amount));
  update public.app_records set payload = v_updated, updated_at = now()
    where collection = 'sales' and record_id = p_sale_id;
  if v_member.role = 'manager' then return v_updated; end if;
  return public.uttara_staff_sale_view(v_updated);
end;
$$;

revoke all on function public.uttara_create_sale(jsonb) from public, anon;
revoke all on function public.uttara_receive_sale_payment(text, numeric, text, text) from public, anon;
grant execute on function public.uttara_create_sale(jsonb) to authenticated;
grant execute on function public.uttara_receive_sale_payment(text, numeric, text, text) to authenticated;

alter table public.app_members enable row level security;
alter table public.app_records enable row level security;

revoke all on public.app_members from anon, authenticated;
revoke all on public.app_records from anon, authenticated;
grant select, insert, update, delete on public.app_members to authenticated;
grant select, insert, update, delete on public.app_records to authenticated;

drop policy if exists "members read self or manager" on public.app_members;
create policy "members read self or manager" on public.app_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.uttara_member_manager());

drop policy if exists "manager creates members" on public.app_members;
create policy "manager creates members" on public.app_members
  for insert to authenticated
  with check (public.uttara_member_manager());

drop policy if exists "manager updates members" on public.app_members;
create policy "manager updates members" on public.app_members
  for update to authenticated
  using (public.uttara_member_manager())
  with check (public.uttara_member_manager());

drop policy if exists "manager removes members" on public.app_members;
create policy "manager removes members" on public.app_members
  for delete to authenticated
  using (public.uttara_member_manager());

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

drop policy if exists "members append own activity logs" on public.app_records;
create policy "members append own activity logs" on public.app_records
  for insert to authenticated
  with check (collection = 'activityLogs' and public.uttara_member_active() and owner_id = (select auth.uid()));

drop policy if exists "permitted members add own records" on public.app_records;
create policy "permitted members add own records" on public.app_records
  for insert to authenticated
  with check (
    public.uttara_member_manager()
    or (public.uttara_can_write(collection) and owner_id = (select auth.uid()))
  );

drop policy if exists "permitted members update own records" on public.app_records;
create policy "permitted members update own records" on public.app_records
  for update to authenticated
  using (
    public.uttara_member_manager()
    or (public.uttara_can_write(collection) and owner_id = (select auth.uid()))
  )
  with check (
    public.uttara_member_manager()
    or (public.uttara_can_write(collection) and owner_id = (select auth.uid()))
  );

drop policy if exists "manager removes app records" on public.app_records;
create policy "manager removes app records" on public.app_records
  for delete to authenticated
  using (public.uttara_member_manager());


