-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 006_relocate_legacy_reject.sql
--
-- Move legacy REJECT stock:
-- UNASSIGNED -> REJ-01
-- ============================================================

do $$
declare
  v_reject_area_id uuid;
  v_reject_location_id uuid;
  v_row record;
begin

  -- Find REJECT area
  select id
  into v_reject_area_id
  from public.stock_areas
  where upper(code) = 'REJECT'
  limit 1;

  if v_reject_area_id is null then
    raise exception 'Stock area REJECT tidak ditemukan';
  end if;


  -- Find REJ-01
  select id
  into v_reject_location_id
  from public.locations
  where
    area_id = v_reject_area_id
    and upper(code) = 'REJ-01'
  limit 1;

  if v_reject_location_id is null then
    raise exception 'Location REJ-01 tidak ditemukan';
  end if;


  -- Move every remaining legacy REJECT stock
  for v_row in

    select
      i.variant_id,
      i.location_id as old_location_id,
      i.qty_on_hand

    from public.inventory i

    join public.locations l
      on l.id = i.location_id

    where
      l.area_id = v_reject_area_id
      and upper(l.code) = 'UNASSIGNED'
      and i.qty_on_hand > 0

  loop

    -- Add to REJ-01
    insert into public.inventory (
      variant_id,
      location_id,
      qty_on_hand,
      updated_at
    )
    values (
      v_row.variant_id,
      v_reject_location_id,
      v_row.qty_on_hand,
      now()
    )

    on conflict (variant_id, location_id)

    do update set
      qty_on_hand =
        public.inventory.qty_on_hand
        + excluded.qty_on_hand,
      updated_at = now();


    -- Empty legacy location
    update public.inventory
    set
      qty_on_hand = 0,
      updated_at = now()
    where
      variant_id = v_row.variant_id
      and location_id = v_row.old_location_id;


    -- Audit trail
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
      v_reject_location_id,
      v_row.qty_on_hand,
      'Relokasi stok reject',
      'MIGRATION-006',
      'Relokasi stok lama dari UNASSIGNED ke REJ-01',
      null,
      now()
    );

  end loop;

end;
$$;

-- ============================================================
-- END OF MIGRATION
-- ============================================================