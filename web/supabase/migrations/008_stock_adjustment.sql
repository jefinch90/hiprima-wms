-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 008_stock_adjustment.sql
--
-- Stock Adjustment Module
--
-- Flow:
-- 1. Search SKU
-- 2. Select warehouse location
-- 3. Enter actual physical stock
-- 4. System calculates stock difference automatically
-- 5. Adjustment In / Adjustment Out is created automatically
-- ============================================================


-- ============================================================
-- 1. SEARCH SKU
-- ============================================================

create or replace function public.search_adjustment_skus(
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
-- 2. GET SELECTED SKU DETAIL
-- ============================================================

create or replace function public.get_adjustment_variant(
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
-- 3. GET ACTIVE LOCATIONS
--
-- All active warehouse locations can be counted.
-- Current stock is returned even when it is zero.
-- ============================================================

create or replace function public.get_adjustment_locations(
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
    case upper(sa.code)
      when 'NORMAL' then 1
      when 'DEFECT' then 2
      when 'REJECT' then 3
      else 4
    end,
    sa.code,
    l.code;
$$;


-- ============================================================
-- 4. ADJUST STOCK TO PHYSICAL COUNT
--
-- User enters ACTUAL physical quantity.
--
-- Example:
-- System = 20
-- Physical = 18
-- Difference = -2
-- => Adjustment Out 2
--
-- System = 18
-- Physical = 20
-- Difference = +2
-- => Adjustment In 2
--
-- Only:
-- owner
-- admin
-- warehouse_manager
--
-- can execute the actual adjustment.
-- ============================================================

create or replace function public.adjust_stock_to_physical(
  p_variant_id uuid,
  p_location_id uuid,
  p_physical_qty integer,
  p_reference_no text,
  p_reason text,
  p_notes text default null
)
returns table (
  new_movement_no bigint,
  adjustment_type text,
  system_qty_before integer,
  physical_qty_after integer,
  adjustment_qty integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_qty integer;
  v_difference integer;
  v_movement_no bigint;
begin

  -- ==========================================================
  -- AUTHENTICATION
  -- ==========================================================

  if auth.uid() is null then
    raise exception 'User belum login';
  end if;


  -- ==========================================================
  -- ROLE PERMISSION
  -- ==========================================================

  if not exists (
    select 1
    from public.profiles
    where
      id = auth.uid()
      and is_active = true
      and role::text in (
        'owner',
        'admin',
        'warehouse_manager'
      )
  ) then
    raise exception
      'Anda tidak memiliki izin melakukan stock adjustment';
  end if;


  -- ==========================================================
  -- VALIDATE PHYSICAL QTY
  -- ==========================================================

  if p_physical_qty is null
     or p_physical_qty < 0 then
    raise exception
      'Stok fisik tidak boleh kurang dari 0';
  end if;


  -- ==========================================================
  -- REFERENCE REQUIRED
  -- ==========================================================

  if coalesce(trim(p_reference_no), '') = '' then
    raise exception
      'Reference wajib diisi';
  end if;


  -- ==========================================================
  -- REASON REQUIRED
  -- ==========================================================

  if coalesce(trim(p_reason), '') = '' then
    raise exception
      'Alasan adjustment wajib diisi';
  end if;


  -- ==========================================================
  -- VALIDATE SKU
  -- ==========================================================

  if not exists (
    select 1
    from public.product_variants
    where id = p_variant_id
  ) then
    raise exception
      'Variant / SKU tidak ditemukan';
  end if;


  -- ==========================================================
  -- VALIDATE LOCATION
  -- ==========================================================

  if not exists (
    select 1
    from public.locations
    where
      id = p_location_id
      and is_active = true
  ) then
    raise exception
      'Lokasi tidak ditemukan / tidak aktif';
  end if;


  -- ==========================================================
  -- ENSURE INVENTORY ROW EXISTS
  --
  -- Important for cases where:
  -- system stock = 0
  -- physical stock > 0
  -- ==========================================================

  insert into public.inventory (
    variant_id,
    location_id,
    qty_on_hand,
    updated_at
  )
  values (
    p_variant_id,
    p_location_id,
    0,
    now()
  )

  on conflict (variant_id, location_id)
  do nothing;


  -- ==========================================================
  -- LOCK INVENTORY
  -- ==========================================================

  select
    qty_on_hand
  into
    v_current_qty

  from public.inventory

  where
    variant_id = p_variant_id
    and location_id = p_location_id

  for update;


  if v_current_qty is null then
    raise exception
      'Inventory tidak ditemukan';
  end if;


  -- ==========================================================
  -- CALCULATE DIFFERENCE
  -- ==========================================================

  v_difference =
    p_physical_qty - v_current_qty;


  if v_difference = 0 then
    raise exception
      'Tidak ada selisih stok. Stok sistem dan stok fisik sama';
  end if;


  -- ==========================================================
  -- UPDATE INVENTORY TO ACTUAL PHYSICAL STOCK
  -- ==========================================================

  update public.inventory
  set
    qty_on_hand = p_physical_qty,
    updated_at = now()
  where
    variant_id = p_variant_id
    and location_id = p_location_id;


  -- ==========================================================
  -- ADJUSTMENT IN
  -- ==========================================================

  if v_difference > 0 then

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
      'adjustment_in',
      p_variant_id,
      null,
      p_location_id,
      v_difference,
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
      'adjustment_in'::text,
      v_current_qty,
      p_physical_qty,
      v_difference;


  -- ==========================================================
  -- ADJUSTMENT OUT
  -- ==========================================================

  else

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
      'adjustment_out',
      p_variant_id,
      p_location_id,
      null,
      abs(v_difference),
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
      'adjustment_out'::text,
      v_current_qty,
      p_physical_qty,
      abs(v_difference);

  end if;

end;
$$;


-- ============================================================
-- 5. SECURITY / PERMISSIONS
-- ============================================================

revoke all on function public.search_adjustment_skus(
  text,
  integer
) from public;


revoke all on function public.get_adjustment_variant(
  uuid
) from public;


revoke all on function public.get_adjustment_locations(
  uuid
) from public;


revoke all on function public.adjust_stock_to_physical(
  uuid,
  uuid,
  integer,
  text,
  text,
  text
) from public;



grant execute on function public.search_adjustment_skus(
  text,
  integer
) to authenticated;


grant execute on function public.get_adjustment_variant(
  uuid
) to authenticated;


grant execute on function public.get_adjustment_locations(
  uuid
) to authenticated;


grant execute on function public.adjust_stock_to_physical(
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