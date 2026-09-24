-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 007_outbound_stock.sql
--
-- Outbound Stock Module
-- ============================================================


-- ============================================================
-- 1. SEARCH SKU FOR OUTBOUND
--
-- Only SKU with available stock in NORMAL area.
-- ============================================================

create or replace function public.search_outbound_skus(
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

  join public.stock_areas sa
    on sa.id = l.area_id
    and upper(sa.code) = 'NORMAL'

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
-- 2. GET SELECTED SKU DETAIL
--
-- total_qty = NORMAL stock only.
-- ============================================================

create or replace function public.get_outbound_variant(
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
          when upper(coalesce(sa.code, '')) = 'NORMAL'
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

  left join public.stock_areas sa
    on sa.id = l.area_id

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
-- 3. GET SOURCE RACKS
--
-- Only:
-- - active locations
-- - NORMAL area
-- - qty > 0
-- ============================================================

create or replace function public.get_outbound_source_locations(
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
    and upper(sa.code) = 'NORMAL'

  order by
    l.code;
$$;


-- ============================================================
-- 4. OUTBOUND STOCK
--
-- Transaction:
-- 1. Validate authenticated user
-- 2. Validate SKU
-- 3. Validate source rack
-- 4. Source must be NORMAL
-- 5. Lock inventory row
-- 6. Validate available stock
-- 7. Deduct inventory
-- 8. Create OUTBOUND movement
--
-- Entire transaction rolls back if any step fails.
-- ============================================================

create or replace function public.outbound_stock(
  p_variant_id uuid,
  p_from_location_id uuid,
  p_quantity integer,
  p_reference_no text,
  p_notes text default null
)
returns table (
  new_movement_no bigint,
  source_qty_after integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_qty integer;
  v_source_after integer;
  v_movement_no bigint;
  v_area_code text;
begin

  -- User must be authenticated
  if auth.uid() is null then
    raise exception 'User belum login';
  end if;


  -- Quantity validation
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity harus lebih dari 0';
  end if;


  -- Reference is mandatory for audit trail
  if coalesce(trim(p_reference_no), '') = '' then
    raise exception
      'Reference wajib diisi';
  end if;


  -- Validate SKU
  if not exists (
    select 1
    from public.product_variants
    where id = p_variant_id
  ) then
    raise exception
      'Variant / SKU tidak ditemukan';
  end if;


  -- Validate source rack and read area
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


  -- Sales / normal outbound only from NORMAL area
  if v_area_code <> 'NORMAL' then
    raise exception
      'Outbound hanya diperbolehkan dari area NORMAL';
  end if;


  -- Lock source inventory
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


  -- Prevent negative inventory
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


  -- Record stock movement
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
    'outbound',
    p_variant_id,
    p_from_location_id,
    null,
    p_quantity,
    'Barang keluar',
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
    v_source_after;

end;
$$;


-- ============================================================
-- 5. SECURITY / PERMISSIONS
-- ============================================================

revoke all on function public.search_outbound_skus(
  text,
  integer
) from public;


revoke all on function public.get_outbound_variant(
  uuid
) from public;


revoke all on function public.get_outbound_source_locations(
  uuid
) from public;


revoke all on function public.outbound_stock(
  uuid,
  uuid,
  integer,
  text,
  text
) from public;



grant execute on function public.search_outbound_skus(
  text,
  integer
) to authenticated;


grant execute on function public.get_outbound_variant(
  uuid
) to authenticated;


grant execute on function public.get_outbound_source_locations(
  uuid
) to authenticated;


grant execute on function public.outbound_stock(
  uuid,
  uuid,
  integer,
  text,
  text
) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
