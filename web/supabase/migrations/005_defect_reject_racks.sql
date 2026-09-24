-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 005_defect_reject_racks.sql
--
-- Create dedicated DEFECT and REJECT racks
-- Move legacy DEFECT stock from UNASSIGNED to DEF-01
-- Disable legacy UNASSIGNED locations
-- ============================================================


do $$
declare
  v_defect_area_id uuid;
  v_reject_area_id uuid;

  v_defect_location_id uuid;
  v_reject_location_id uuid;

  v_row record;
begin

  -- ==========================================================
  -- 1. FIND STOCK AREAS
  -- ==========================================================

  select id
  into v_defect_area_id
  from public.stock_areas
  where upper(code) = 'DEFECT'
  limit 1;


  select id
  into v_reject_area_id
  from public.stock_areas
  where upper(code) = 'REJECT'
  limit 1;


  if v_defect_area_id is null then
    raise exception 'Stock area DEFECT tidak ditemukan';
  end if;


  if v_reject_area_id is null then
    raise exception 'Stock area REJECT tidak ditemukan';
  end if;


  -- ==========================================================
  -- 2. CREATE DEFECT RACK
  -- ==========================================================

  insert into public.locations (
    area_id,
    code,
    name,
    is_active
  )
  select
    v_defect_area_id,
    'DEF-01',
    'Rack Defect',
    true
  where not exists (
    select 1
    from public.locations
    where
      area_id = v_defect_area_id
      and upper(code) = 'DEF-01'
  );


  select id
  into v_defect_location_id
  from public.locations
  where
    area_id = v_defect_area_id
    and upper(code) = 'DEF-01'
  limit 1;


  -- ==========================================================
  -- 3. CREATE REJECT RACK
  -- ==========================================================

  insert into public.locations (
    area_id,
    code,
    name,
    is_active
  )
  select
    v_reject_area_id,
    'REJ-01',
    'Rack Reject',
    true
  where not exists (
    select 1
    from public.locations
    where
      area_id = v_reject_area_id
      and upper(code) = 'REJ-01'
  );


  select id
  into v_reject_location_id
  from public.locations
  where
    area_id = v_reject_area_id
    and upper(code) = 'REJ-01'
  limit 1;


  -- ==========================================================
  -- 4. MOVE LEGACY DEFECT STOCK
  -- FROM DEFECT / UNASSIGNED -> DEF-01
  --
  -- Each movement is also written to stock_movements
  -- so the audit trail remains complete.
  -- ==========================================================

  for v_row in

    select
      i.variant_id,
      i.location_id as old_location_id,
      i.qty_on_hand

    from public.inventory i

    join public.locations l
      on l.id = i.location_id

    where
      l.area_id = v_defect_area_id
      and upper(l.code) = 'UNASSIGNED'
      and i.qty_on_hand > 0

  loop

    -- Add stock to DEF-01
    insert into public.inventory (
      variant_id,
      location_id,
      qty_on_hand,
      updated_at
    )
    values (
      v_row.variant_id,
      v_defect_location_id,
      v_row.qty_on_hand,
      now()
    )

    on conflict (variant_id, location_id)

    do update set
      qty_on_hand =
        public.inventory.qty_on_hand
        + excluded.qty_on_hand,

      updated_at = now();


    -- Remove stock from legacy UNASSIGNED row
    update public.inventory
    set
      qty_on_hand = 0,
      updated_at = now()
    where
      variant_id = v_row.variant_id
      and location_id = v_row.old_location_id;


    -- Record migration movement
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
      v_row.variant_id,
      v_row.old_location_id,
      v_defect_location_id,
      v_row.qty_on_hand,
      'Relokasi stok defect',
      'MIGRATION-005',
      'Relokasi stok lama dari UNASSIGNED ke DEF-01',
      null,
      now()
    );

  end loop;


  -- ==========================================================
  -- 5. DISABLE LEGACY UNASSIGNED LOCATIONS
  --
  -- Do not delete them because old movement history may still
  -- reference these location IDs.
  -- ==========================================================

  update public.locations
  set
    is_active = false,
    updated_at = now()
  where
    upper(code) = 'UNASSIGNED'
    and area_id in (
      v_defect_area_id,
      v_reject_area_id
    );


  -- Ensure new racks are active
  update public.locations
  set
    is_active = true,
    updated_at = now()
  where
    id in (
      v_defect_location_id,
      v_reject_location_id
    );

end;
$$;


-- ============================================================
-- END OF MIGRATION
-- ============================================================