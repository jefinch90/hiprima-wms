-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 009_return_stock.sql
--
-- Return Stock Module
--
-- RETURN IN
-- Customer -> Warehouse
-- QC result:
-- NORMAL / DEFECT / REJECT
--
-- RETURN OUT
-- Warehouse -> Supplier / Vendor
-- ============================================================


-- ============================================================
-- 1. SEARCH SKU FOR RETURN
-- ============================================================

create or replace function public.search_return_skus(
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

    coalesce(
      sum(
        case
          when l.is_active = true
          then coalesce(i.qty_on_hand, 0)
          else 0
        end
      ),
      0
    )::bigint as total_qty

  from public.product_variants pv

  join public.products p
    on p.id = pv.product_id

  left join public.inventory i
    on i.variant_id = pv.id

  left join public.locations l
    on l.id = i.location_id

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
-- 2. GET SELECTED VARIANT
-- ============================================================

create or replace function public.get_return_variant(
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

    coalesce(
      sum(
        case
          when l.is_active = true
          then coalesce(i.qty_on_hand, 0)
          else 0
        end
      ),
      0
    )::bigint as total_qty

  from public.product_variants pv

  join public.products p
    on p.id = pv.product_id

  left join public.inventory i
    on i.variant_id = pv.id

  left join public.locations l
    on l.id = i.location_id

  where
    pv.id = p_variant_id

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
-- 3. RETURN IN DESTINATION LOCATIONS
--
-- QC Result:
-- NORMAL -> rack NORMAL
-- DEFECT -> rack DEFECT
-- REJECT -> rack REJECT
-- ============================================================

create or replace function public.get_return_in_destination_locations(
  p_variant_id uuid,
  p_qc_result text
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
  v_qc_result text;
begin

  v_qc_result := upper(trim(p_qc_result));

  if v_qc_result not in (
    'NORMAL',
    'DEFECT',
    'REJECT'
  ) then
    raise exception
      'QC result harus NORMAL, DEFECT, atau REJECT';
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
    l.is_active = true
    and upper(sa.code) = v_qc_result

  order by
    l.code;

end;
$$;


-- ============================================================
-- 4. RETURN OUT SOURCE LOCATIONS
--
-- Only racks that currently have stock.
-- NORMAL / DEFECT / REJECT are all allowed.
-- ============================================================

create or replace function public.get_return_out_source_locations(
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
    case upper(sa.code)
      when 'DEFECT' then 1
      when 'REJECT' then 2
      when 'NORMAL' then 3
      else 4
    end,
    sa.code,
    l.code;
$$;


-- ============================================================
-- 5. RECEIVE RETURN STOCK
--
-- Customer -> Warehouse
--
-- Adds stock to destination rack.
-- Destination rack determines QC status.
-- ============================================================

create or replace function public.receive_return_stock(
  p_variant_id uuid,
  p_to_location_id uuid,
  p_quantity integer,
  p_reference_no text,
  p_reason text,
  p_notes text default null
)
returns table (
  new_movement_no bigint,
  destination_qty_after integer,
  destination_area text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_area_code text;
  v_destination_after integer;
  v_movement_no bigint;
begin

  -- Authentication
  if auth.uid() is null then
    raise exception 'User belum login';
  end if;


  -- Quantity
  if p_quantity is null
     or p_quantity <= 0 then
    raise exception
      'Quantity harus lebih dari 0';
  end if;


  -- Reference
  if coalesce(trim(p_reference_no), '') = '' then
    raise exception
      'Reference wajib diisi';
  end if;


  -- Reason
  if coalesce(trim(p_reason), '') = '' then
    raise exception
      'Alasan return wajib diisi';
  end if;


  -- Variant
  if not exists (
    select 1
    from public.product_variants
    where id = p_variant_id
  ) then
    raise exception
      'Variant / SKU tidak ditemukan';
  end if;


  -- Destination location + area
  select
    upper(sa.code)

  into
    v_area_code

  from public.locations l

  join public.stock_areas sa
    on sa.id = l.area_id

  where
    l.id = p_to_location_id
    and l.is_active = true;


  if v_area_code is null then
    raise exception
      'Lokasi tujuan tidak ditemukan / tidak aktif';
  end if;


  if v_area_code not in (
    'NORMAL',
    'DEFECT',
    'REJECT'
  ) then
    raise exception
      'Return In hanya boleh masuk area NORMAL, DEFECT, atau REJECT';
  end if;


  -- Add inventory
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


  -- Movement history
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
    'return_in',
    p_variant_id,
    null,
    p_to_location_id,
    p_quantity,
    trim(p_reason),
    trim(p_reference_no),
    nullif(trim(p_notes), ''),
    auth.uid(),
    now()
  )

  returning movement_no
  into v_movement_no;


  return query
  select
    v_movement_no,
    v_destination_after,
    v_area_code;

end;
$$;


-- ============================================================
-- 6. RETURN STOCK TO SUPPLIER / VENDOR
--
-- Warehouse -> Supplier
--
-- Stock is deducted from selected rack.
-- Negative inventory is not allowed.
-- ============================================================

create or replace function public.return_stock_to_supplier(
  p_variant_id uuid,
  p_from_location_id uuid,
  p_quantity integer,
  p_reference_no text,
  p_reason text,
  p_notes text default null
)
returns table (
  new_movement_no bigint,
  source_qty_after integer,
  source_area text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_qty integer;
  v_source_after integer;
  v_area_code text;
  v_movement_no bigint;
begin

  -- Authentication
  if auth.uid() is null then
    raise exception 'User belum login';
  end if;


  -- Quantity
  if p_quantity is null
     or p_quantity <= 0 then
    raise exception
      'Quantity harus lebih dari 0';
  end if;


  -- Reference
  if coalesce(trim(p_reference_no), '') = '' then
    raise exception
      'Reference wajib diisi';
  end if;


  -- Reason
  if coalesce(trim(p_reason), '') = '' then
    raise exception
      'Alasan return wajib diisi';
  end if;


  -- Variant
  if not exists (
    select 1
    from public.product_variants
    where id = p_variant_id
  ) then
    raise exception
      'Variant / SKU tidak ditemukan';
  end if;


  -- Validate source location
  select
    upper(sa.code)

  into
    v_area_code

  from public.locations l

  join public.stock_areas sa
    on sa.id = l.area_id

  where
    l.id = p_from_location_id
    and l.is_active = true;


  if v_area_code is null then
    raise exception
      'Lokasi asal tidak ditemukan / tidak aktif';
  end if;


  -- Lock inventory
  select
    qty_on_hand

  into
    v_source_qty

  from public.inventory

  where
    variant_id = p_variant_id
    and location_id = p_from_location_id

  for update;


  if v_source_qty is null then
    raise exception
      'SKU tidak memiliki stok di lokasi asal';
  end if;


  if v_source_qty < p_quantity then
    raise exception
      'Stok tidak cukup. Tersedia: %, diminta: %',
      v_source_qty,
      p_quantity;
  end if;


  -- Deduct inventory
  update public.inventory

  set
    qty_on_hand =
      qty_on_hand - p_quantity,

    updated_at = now()

  where
    variant_id = p_variant_id
    and location_id = p_from_location_id

  returning qty_on_hand
  into v_source_after;


  -- Movement history
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
    'return_out',
    p_variant_id,
    p_from_location_id,
    null,
    p_quantity,
    trim(p_reason),
    trim(p_reference_no),
    nullif(trim(p_notes), ''),
    auth.uid(),
    now()
  )

  returning movement_no
  into v_movement_no;


  return query
  select
    v_movement_no,
    v_source_after,
    v_area_code;

end;
$$;


-- ============================================================
-- 7. SECURITY
-- ============================================================

revoke all on function public.search_return_skus(
  text,
  integer
) from public;


revoke all on function public.get_return_variant(
  uuid
) from public;


revoke all on function public.get_return_in_destination_locations(
  uuid,
  text
) from public;


revoke all on function public.get_return_out_source_locations(
  uuid
) from public;


revoke all on function public.receive_return_stock(
  uuid,
  uuid,
  integer,
  text,
  text,
  text
) from public;


revoke all on function public.return_stock_to_supplier(
  uuid,
  uuid,
  integer,
  text,
  text,
  text
) from public;



grant execute on function public.search_return_skus(
  text,
  integer
) to authenticated;


grant execute on function public.get_return_variant(
  uuid
) to authenticated;


grant execute on function public.get_return_in_destination_locations(
  uuid,
  text
) to authenticated;


grant execute on function public.get_return_out_source_locations(
  uuid
) to authenticated;


grant execute on function public.receive_return_stock(
  uuid,
  uuid,
  integer,
  text,
  text,
  text
) to authenticated;


grant execute on function public.return_stock_to_supplier(
  uuid,
  uuid,
  integer,
  text,
  text,
  text
) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================