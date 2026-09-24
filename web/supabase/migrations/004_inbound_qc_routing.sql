-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 004_inbound_qc_routing.sql
--
-- Inbound QC Routing
-- NORMAL / DEFECT / REJECT
-- ============================================================


-- ============================================================
-- 1. REMOVE OLD DESTINATION FUNCTION
-- ============================================================

drop function if exists public.get_inbound_destination_locations(
  uuid
);


-- ============================================================
-- 2. GET DESTINATION LOCATIONS BY QC RESULT
-- ============================================================

create or replace function public.get_inbound_destination_locations(
  p_variant_id uuid,
  p_area_code text
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
  v_area_code text;
begin

  v_area_code := upper(trim(coalesce(p_area_code, '')));

  if v_area_code not in (
    'NORMAL',
    'DEFECT',
    'REJECT'
  ) then
    raise exception
      'QC Result harus NORMAL, DEFECT, atau REJECT';
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
    and upper(sa.code) = v_area_code

  order by
    l.code;

end;
$$;


-- ============================================================
-- 3. RECEIVE INBOUND STOCK
--
-- Destination area determines QC result:
-- NORMAL -> QC Pass
-- DEFECT -> QC Defect
-- REJECT -> QC Reject
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

  v_area_code text;
  v_reason text;
begin

  -- User must be authenticated
  if auth.uid() is null then
    raise exception 'User belum login';
  end if;


  -- Quantity validation
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity harus lebih dari 0';
  end if;


  -- Validate SKU
  if not exists (
    select 1
    from public.product_variants
    where id = p_variant_id
  ) then
    raise exception 'Variant / SKU tidak ditemukan';
  end if;


  -- Get destination stock area
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


  -- Only official QC areas may receive inbound
  if v_area_code not in (
    'NORMAL',
    'DEFECT',
    'REJECT'
  ) then
    raise exception
      'Lokasi tujuan bukan area inbound yang valid';
  end if;


  -- Set movement reason based on QC result
  v_reason :=
    case v_area_code
      when 'NORMAL'
        then 'Barang masuk - QC Normal'
      when 'DEFECT'
        then 'Barang masuk - QC Defect'
      when 'REJECT'
        then 'Barang masuk - QC Reject'
    end;


  -- Add stock to destination rack
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


  -- Record movement
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
    v_reason,
    nullif(trim(p_reference_no), ''),
    nullif(trim(p_notes), ''),
    auth.uid(),
    now()
  )

  returning movement_no
  into v_movement_no;


  return query

  select
    v_movement_no,
    v_destination_after;

end;
$$;


-- ============================================================
-- 4. SECURITY
-- ============================================================

revoke all on function public.get_inbound_destination_locations(
  uuid,
  text
) from public;


revoke all on function public.receive_inbound_stock(
  uuid,
  uuid,
  integer,
  text,
  text
) from public;


grant execute on function public.get_inbound_destination_locations(
  uuid,
  text
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