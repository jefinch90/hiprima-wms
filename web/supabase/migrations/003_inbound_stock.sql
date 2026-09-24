-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 003_inbound_stock.sql
--
-- Inbound Stock Module
-- ============================================================


-- ============================================================
-- 1. SEARCH SKU FOR INBOUND
--
-- Unlike stock transfer, inbound must also be able to find
-- SKUs that currently have zero inventory.
-- ============================================================

create or replace function public.search_inbound_skus(
  p_search text,
  p_limit integer default 20
)
returns table (
  variant_id uuid,
  sku text,
  product_code text,
  product_name text,
  brand text,
  color text,
  size text,
  total_qty bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    pv.id as variant_id,
    pv.sku,
    p.product_code,
    p.name as product_name,
    p.brand,
    pv.color,
    pv.size,
    coalesce(sum(i.qty_on_hand), 0)::bigint as total_qty

  from public.product_variants pv

  join public.products p
    on p.id = pv.product_id

  left join public.inventory i
    on i.variant_id = pv.id

  where
    coalesce(trim(p_search), '') <> ''

    and (
      pv.sku ilike '%' || trim(p_search) || '%'
      or p.product_code ilike '%' || trim(p_search) || '%'
      or p.name ilike '%' || trim(p_search) || '%'
      or coalesce(pv.color, '') ilike '%' || trim(p_search) || '%'
    )

  group by
    pv.id,
    pv.sku,
    p.product_code,
    p.name,
    p.brand,
    pv.color,
    pv.size

  order by
    case
      when lower(pv.sku) = lower(trim(p_search))
      then 0
      else 1
    end,
    pv.sku

  limit least(
    greatest(coalesce(p_limit, 20), 1),
    50
  );
$$;


-- ============================================================
-- 2. GET SELECTED VARIANT DETAIL
-- ============================================================

create or replace function public.get_inbound_variant(
  p_variant_id uuid
)
returns table (
  variant_id uuid,
  sku text,
  product_code text,
  product_name text,
  brand text,
  color text,
  size text,
  total_qty bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    pv.id as variant_id,
    pv.sku,
    p.product_code,
    p.name as product_name,
    p.brand,
    pv.color,
    pv.size,
    coalesce(sum(i.qty_on_hand), 0)::bigint as total_qty

  from public.product_variants pv

  join public.products p
    on p.id = pv.product_id

  left join public.inventory i
    on i.variant_id = pv.id

  where pv.id = p_variant_id

  group by
    pv.id,
    pv.sku,
    p.product_code,
    p.name,
    p.brand,
    pv.color,
    pv.size;
$$;


-- ============================================================
-- 3. GET INBOUND DESTINATION LOCATIONS
--
-- Shows all active WMS locations.
-- Also shows current stock of the selected SKU in each location.
-- ============================================================

create or replace function public.get_inbound_destination_locations(
  p_variant_id uuid
)
returns table (
  location_id uuid,
  location_code text,
  location_name text,
  area_code text,
  area_name text,
  current_qty integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.id as location_id,
    l.code as location_code,
    l.name as location_name,
    sa.code as area_code,
    sa.name as area_name,
    coalesce(i.qty_on_hand, 0)::integer as current_qty

  from public.locations l

  join public.stock_areas sa
    on sa.id = l.area_id

  left join public.inventory i
    on i.location_id = l.id
    and i.variant_id = p_variant_id

  where
    l.is_active = true

  order by
    sa.code,
    l.code;
$$;


-- ============================================================
-- 4. RECEIVE INBOUND STOCK
--
-- Transaction flow:
-- 1. Validate authenticated user
-- 2. Validate quantity
-- 3. Validate SKU
-- 4. Validate destination location
-- 5. Add stock to inventory
-- 6. Record inbound stock movement
--
-- If any step fails, the whole transaction is rolled back.
-- ============================================================

create or replace function public.receive_inbound_stock(
  p_variant_id uuid,
  p_to_location_id uuid,
  p_quantity integer,
  p_reference_no text default null,
  p_notes text default null
)
returns table (
  new_movement_no bigint,
  destination_qty_after integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_destination_after integer;
  v_movement_no bigint;
begin

  -- User must be authenticated
  if auth.uid() is null then
    raise exception 'User belum login';
  end if;


  -- Quantity must be valid
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity harus lebih dari 0';
  end if;


  -- Validate variant / SKU
  if not exists (
    select 1
    from public.product_variants
    where id = p_variant_id
  ) then
    raise exception 'Variant / SKU tidak ditemukan';
  end if;


  -- Validate destination location
  if not exists (
    select 1
    from public.locations
    where
      id = p_to_location_id
      and is_active = true
  ) then
    raise exception 'Lokasi tujuan tidak ditemukan / tidak aktif';
  end if;


  -- Add stock to destination
  --
  -- If inventory row already exists:
  -- increase qty_on_hand
  --
  -- If inventory row does not exist:
  -- create new inventory row
  insert into public.inventory (
    variant_id,
    location_id,
    qty_on_hand,
    updated_at
  )
  values (
    p_variant_id,
    p_to_location_id,
    p_quantity,
    now()
  )

  on conflict (variant_id, location_id)

  do update set
    qty_on_hand =
      public.inventory.qty_on_hand
      + excluded.qty_on_hand,

    updated_at = now()

  returning qty_on_hand
  into v_destination_after;


  -- Record movement history
  insert into public.stock_movements (
    movement_type,
    variant_id,
    from_location_id,
    to_location_id,
    quantity,
    reason,
    reference_no,
    notes,
    created_by,
    created_at
  )
  values (
    'inbound',
    p_variant_id,
    null,
    p_to_location_id,
    p_quantity,
    'Barang masuk',
    nullif(trim(p_reference_no), ''),
    nullif(trim(p_notes), ''),
    auth.uid(),
    now()
  )
  returning movement_no
  into v_movement_no;


  -- Return result to WMS
  return query
  select
    v_movement_no,
    v_destination_after;

end;
$$;


-- ============================================================
-- 5. SECURITY / PERMISSIONS
-- ============================================================

revoke all on function public.search_inbound_skus(
  text,
  integer
) from public;


revoke all on function public.get_inbound_variant(
  uuid
) from public;


revoke all on function public.get_inbound_destination_locations(
  uuid
) from public;


revoke all on function public.receive_inbound_stock(
  uuid,
  uuid,
  integer,
  text,
  text
) from public;



grant execute on function public.search_inbound_skus(
  text,
  integer
) to authenticated;


grant execute on function public.get_inbound_variant(
  uuid
) to authenticated;


grant execute on function public.get_inbound_destination_locations(
  uuid
) to authenticated;


grant execute on function public.receive_inbound_stock(
  uuid,
  uuid,
  integer,
  text,
  text
) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================