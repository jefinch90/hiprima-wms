-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 001_stock_transfer.sql
--
-- Stock Transfer Module
-- ============================================================


-- ============================================================
-- 1. SEARCH SKU FOR STOCK TRANSFER
-- ============================================================

create or replace function public.search_transfer_skus(
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
    sum(i.qty_on_hand)::bigint as total_qty

  from public.product_variants pv

  join public.products p
    on p.id = pv.product_id

  join public.inventory i
    on i.variant_id = pv.id
    and i.qty_on_hand > 0

  join public.locations l
    on l.id = i.location_id
    and l.is_active = true

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

create or replace function public.get_transfer_variant(
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

  left join public.locations l
    on l.id = i.location_id
    and l.is_active = true

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
-- 3. GET SOURCE LOCATIONS
-- ONLY LOCATIONS WITH AVAILABLE STOCK
-- ============================================================

create or replace function public.get_transfer_source_locations(
  p_variant_id uuid
)
returns table (
  location_id uuid,
  location_code text,
  location_name text,
  area_code text,
  area_name text,
  qty_on_hand integer
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
    i.qty_on_hand

  from public.inventory i

  join public.locations l
    on l.id = i.location_id

  join public.stock_areas sa
    on sa.id = l.area_id

  where
    i.variant_id = p_variant_id
    and i.qty_on_hand > 0
    and l.is_active = true

  order by
    sa.code,
    l.code;
$$;


-- ============================================================
-- 4. GET DESTINATION LOCATIONS
-- ONLY LOCATIONS IN SAME STOCK AREA
-- ============================================================

create or replace function public.get_transfer_destination_locations(
  p_variant_id uuid,
  p_from_location_id uuid
)
returns table (
  location_id uuid,
  location_code text,
  location_name text,
  area_code text,
  area_name text,
  current_qty integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_area_id uuid;
begin

  select l.area_id
  into v_area_id
  from public.locations l
  where
    l.id = p_from_location_id
    and l.is_active = true;

  if v_area_id is null then
    raise exception 'Lokasi asal tidak ditemukan / tidak aktif';
  end if;

  return query

  select
    l.id,
    l.code,
    l.name,
    sa.code,
    sa.name,
    coalesce(i.qty_on_hand, 0)::integer

  from public.locations l

  join public.stock_areas sa
    on sa.id = l.area_id

  left join public.inventory i
    on i.location_id = l.id
    and i.variant_id = p_variant_id

  where
    l.area_id = v_area_id
    and l.is_active = true
    and l.id <> p_from_location_id

  order by l.code;

end;
$$;


-- ============================================================
-- 5. TRANSFER STOCK
--
-- Transaction flow:
-- 1. Validate user
-- 2. Validate SKU
-- 3. Validate locations
-- 4. Validate same stock area
-- 5. Lock source stock
-- 6. Deduct source
-- 7. Add destination
-- 8. Record stock movement
--
-- If any step fails, the whole transaction is rolled back.
-- ============================================================

create or replace function public.transfer_stock(
  p_variant_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity integer,
  p_reference_no text default null,
  p_notes text default null
)
returns table (
  new_movement_no bigint,
  source_qty_after integer,
  destination_qty_after integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_qty integer;
  v_source_after integer;
  v_destination_after integer;
  v_movement_no bigint;

  v_from_area_id uuid;
  v_to_area_id uuid;
begin

  -- User must be authenticated
  if auth.uid() is null then
    raise exception 'User belum login';
  end if;


  -- Quantity must be valid
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity harus lebih dari 0';
  end if;


  -- Source and destination cannot be the same
  if p_from_location_id = p_to_location_id then
    raise exception 'Lokasi asal dan tujuan tidak boleh sama';
  end if;


  -- Validate variant
  if not exists (
    select 1
    from public.product_variants
    where id = p_variant_id
  ) then
    raise exception 'Variant / SKU tidak ditemukan';
  end if;


  -- Get source stock area
  select area_id
  into v_from_area_id
  from public.locations
  where
    id = p_from_location_id
    and is_active = true;

  if v_from_area_id is null then
    raise exception 'Lokasi asal tidak ditemukan / tidak aktif';
  end if;


  -- Get destination stock area
  select area_id
  into v_to_area_id
  from public.locations
  where
    id = p_to_location_id
    and is_active = true;

  if v_to_area_id is null then
    raise exception 'Lokasi tujuan tidak ditemukan / tidak aktif';
  end if;


  -- Transfer only within the same stock area
  if v_from_area_id <> v_to_area_id then
    raise exception
      'Transfer hanya diperbolehkan antar lokasi dalam area stok yang sama';
  end if;


  -- Lock source inventory row
  select qty_on_hand
  into v_source_qty
  from public.inventory
  where
    variant_id = p_variant_id
    and location_id = p_from_location_id
  for update;


  -- Source inventory must exist
  if v_source_qty is null then
    raise exception 'SKU tidak memiliki stok di lokasi asal';
  end if;


  -- Prevent negative inventory
  if v_source_qty < p_quantity then
    raise exception
      'Stok tidak cukup. Tersedia: %, diminta: %',
      v_source_qty,
      p_quantity;
  end if;


  -- Deduct stock from source
  update public.inventory
  set
    qty_on_hand = qty_on_hand - p_quantity,
    updated_at = now()
  where
    variant_id = p_variant_id
    and location_id = p_from_location_id
  returning qty_on_hand
  into v_source_after;


  -- Add stock to destination
  --
  -- If inventory row already exists:
  -- increase qty_on_hand
  --
  -- If row does not exist:
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
    'transfer',
    p_variant_id,
    p_from_location_id,
    p_to_location_id,
    p_quantity,
    'Transfer antar lokasi',
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
    v_source_after,
    v_destination_after;

end;
$$;


-- ============================================================
-- 6. SECURITY / PERMISSIONS
-- ============================================================

revoke all on function public.search_transfer_skus(
  text,
  integer
) from public;


revoke all on function public.get_transfer_variant(
  uuid
) from public;


revoke all on function public.get_transfer_source_locations(
  uuid
) from public;


revoke all on function public.get_transfer_destination_locations(
  uuid,
  uuid
) from public;


revoke all on function public.transfer_stock(
  uuid,
  uuid,
  uuid,
  integer,
  text,
  text
) from public;



grant execute on function public.search_transfer_skus(
  text,
  integer
) to authenticated;


grant execute on function public.get_transfer_variant(
  uuid
) to authenticated;


grant execute on function public.get_transfer_source_locations(
  uuid
) to authenticated;


grant execute on function public.get_transfer_destination_locations(
  uuid,
  uuid
) to authenticated;


grant execute on function public.transfer_stock(
  uuid,
  uuid,
  uuid,
  integer,
  text,
  text
) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================