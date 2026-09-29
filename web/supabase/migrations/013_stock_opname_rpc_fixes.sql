-- ============================================================
-- Hi.PRIMA WMS
-- Migration 013
-- Stock Opname RPC Fixes
--
-- Fixes:
-- 1. create_stock_opname_session ambiguous session_id
-- 2. submit_stock_opname ambiguous session_code
-- 3. harden finalize_stock_opname with explicit aliases
--
-- Safe:
-- - Does NOT change inventory
-- - Does NOT create stock movements
-- - Only replaces RPC definitions
-- ============================================================


-- ============================================================
-- 1. CREATE STOCK OPNAME SESSION
-- ============================================================

create or replace function public.create_stock_opname_session(
  p_opname_type text,
  p_location_ids uuid[] default null,
  p_notes text default null
)
returns table (
  session_id uuid,
  session_code text,
  total_locations bigint,
  total_lines bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;

  v_session_id uuid;
  v_opname_no bigint;
  v_session_code text;

  v_location_count bigint;
  v_line_count bigint;

  v_requested_locations bigint;
  v_inserted_locations integer;
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager'
    ]::public.app_user_role[]
  );

  v_type :=
    lower(
      trim(
        coalesce(
          p_opname_type,
          ''
        )
      )
    );

  if v_type not in (
    'cycle_count',
    'full'
  ) then
    raise exception
      'Jenis stock opname harus cycle_count atau full';
  end if;

  if
    v_type = 'cycle_count'
    and (
      p_location_ids is null
      or cardinality(p_location_ids) = 0
    )
  then
    raise exception
      'Cycle Count wajib memilih minimal 1 rack';
  end if;


  insert into public.stock_opname_sessions (
    opname_type,
    status,
    notes,
    created_by,
    created_at,
    updated_at
  )
  values (
    v_type,
    'draft',
    nullif(
      trim(p_notes),
      ''
    ),
    auth.uid(),
    now(),
    now()
  )
  returning
    stock_opname_sessions.id,
    stock_opname_sessions.opname_no
  into
    v_session_id,
    v_opname_no;


  v_session_code :=
    case
      when v_type = 'cycle_count'
        then 'CC'
      else 'FO'
    end
    || '-'
    || to_char(
      now() at time zone 'Asia/Jakarta',
      'YYYYMMDD'
    )
    || '-'
    || lpad(
      v_opname_no::text,
      6,
      '0'
    );


  update public.stock_opname_sessions s
  set
    session_code =
      v_session_code,

    updated_at =
      now()

  where
    s.id =
      v_session_id;


  if v_type = 'cycle_count' then

    select
      count(
        distinct x.location_id
      )
    into
      v_requested_locations

    from unnest(
      p_location_ids
    ) as x(location_id);


    insert into public.stock_opname_locations (
      session_id,
      location_id
    )
    select
      v_session_id,
      l.id

    from public.locations l

    where
      l.is_active = true
      and l.id = any(
        p_location_ids
      )

    on conflict do nothing;


    get diagnostics
      v_inserted_locations =
        row_count;


    if
      v_inserted_locations <>
      v_requested_locations
    then
      raise exception
        'Ada rack yang tidak ditemukan atau tidak aktif';
    end if;

  else

    insert into public.stock_opname_locations (
      session_id,
      location_id
    )
    select
      v_session_id,
      l.id

    from public.locations l

    where
      l.is_active = true

    on conflict do nothing;

  end if;


  select
    count(*)
  into
    v_location_count

  from public.stock_opname_locations sol

  where
    sol.session_id =
      v_session_id;


  if v_location_count = 0 then
    raise exception
      'Tidak ada rack aktif untuk Stock Opname';
  end if;


  insert into public.stock_opname_lines (
    session_id,
    variant_id,
    location_id,
    system_qty,
    created_at,
    updated_at
  )
  select
    v_session_id,
    i.variant_id,
    i.location_id,
    i.qty_on_hand,
    now(),
    now()

  from public.inventory i

  join public.stock_opname_locations sol
    on sol.location_id =
       i.location_id
    and sol.session_id =
        v_session_id

  where
    i.qty_on_hand >= 0

  on conflict do nothing;


  select
    count(*)
  into
    v_line_count

  from public.stock_opname_lines sol

  where
    sol.session_id =
      v_session_id;


  return query
  select
    v_session_id,
    v_session_code,
    v_location_count,
    v_line_count;

end;
$$;



-- ============================================================
-- 2. SUBMIT STOCK OPNAME
-- ============================================================

create or replace function public.submit_stock_opname(
  p_session_id uuid
)
returns table (
  session_code text,
  total_lines bigint,
  counted_lines bigint,
  variance_lines bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_code text;

  v_total bigint;
  v_counted bigint;
  v_variance bigint;
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager',
      'warehouse_staff'
    ]::public.app_user_role[]
  );


  select
    s.status,
    s.session_code

  into
    v_status,
    v_code

  from public.stock_opname_sessions s

  where
    s.id =
      p_session_id

  for update;


  if v_status is null then
    raise exception
      'Session Stock Opname tidak ditemukan';
  end if;


  if v_status not in (
    'draft',
    'counting'
  ) then
    raise exception
      'Session tidak dapat disubmit dari status %',
      v_status;
  end if;


  select
    count(*),

    count(*) filter (
      where
        l.counted_qty
        is not null
    ),

    count(*) filter (
      where
        l.counted_qty
          is not null

        and coalesce(
          l.recount_qty,
          l.counted_qty
        ) <> l.system_qty
    )

  into
    v_total,
    v_counted,
    v_variance

  from public.stock_opname_lines l

  where
    l.session_id =
      p_session_id;


  if v_total = 0 then
    raise exception
      'Session tidak memiliki SKU untuk dihitung';
  end if;


  if v_counted <> v_total then
    raise exception
      'Masih ada % SKU yang belum dihitung',
      v_total - v_counted;
  end if;


  update public.stock_opname_sessions s
  set
    status =
      'review',

    submitted_at =
      now(),

    updated_at =
      now()

  where
    s.id =
      p_session_id;


  return query
  select
    v_code,
    v_total,
    v_counted,
    v_variance;

end;
$$;



-- ============================================================
-- 3. FINALIZE STOCK OPNAME
-- ============================================================

create or replace function public.finalize_stock_opname(
  p_session_id uuid
)
returns table (
  session_code text,
  adjustment_lines integer,
  qty_adjustment_in integer,
  qty_adjustment_out integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session record;
  r record;

  v_current_qty integer;
  v_final_qty integer;
  v_difference integer;

  v_adjustment_lines integer := 0;
  v_qty_in integer := 0;
  v_qty_out integer := 0;
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager'
    ]::public.app_user_role[]
  );


  select
    s.*
  into
    v_session

  from public.stock_opname_sessions s

  where
    s.id =
      p_session_id

  for update;


  if not found then
    raise exception
      'Session Stock Opname tidak ditemukan';
  end if;


  if
    v_session.status <>
    'review'
  then
    raise exception
      'Stock Opname hanya dapat difinalize dari status Review';
  end if;


  if exists (
    select 1

    from public.stock_opname_lines sol

    where
      sol.session_id =
        p_session_id

      and sol.counted_qty
        is null
  ) then
    raise exception
      'Masih ada SKU yang belum dihitung';
  end if;


  for r in

    select
      sol.variant_id,
      sol.location_id,
      sol.system_qty,
      sol.counted_qty,
      sol.recount_qty,

      pv.sku,
      l.code
        as location_code

    from public.stock_opname_lines sol

    join public.product_variants pv
      on pv.id =
         sol.variant_id

    join public.locations l
      on l.id =
         sol.location_id

    where
      sol.session_id =
        p_session_id

    order by
      l.code,
      pv.sku

  loop

    select
      inv.qty_on_hand
    into
      v_current_qty

    from public.inventory inv

    where
      inv.variant_id =
        r.variant_id

      and inv.location_id =
        r.location_id

    for update;


    if not found then
      v_current_qty := 0;
    end if;


    if
      v_current_qty <>
      r.system_qty
    then
      raise exception
        'Finalize dibatalkan. Stok SKU % di rack % berubah sejak Stock Opname dibuat. Snapshot %, stok sekarang %.',
        r.sku,
        r.location_code,
        r.system_qty,
        v_current_qty;
    end if;


    v_final_qty :=
      coalesce(
        r.recount_qty,
        r.counted_qty
      );


    v_difference :=
      v_final_qty -
      v_current_qty;


    if v_difference = 0 then
      continue;
    end if;


    insert into public.inventory (
      variant_id,
      location_id,
      qty_on_hand,
      updated_at
    )
    values (
      r.variant_id,
      r.location_id,
      v_final_qty,
      now()
    )

    on conflict (
      variant_id,
      location_id
    )

    do update set
      qty_on_hand =
        excluded.qty_on_hand,

      updated_at =
        now();


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
        r.variant_id,
        null,
        r.location_id,
        v_difference,

        case
          when
            v_session.opname_type =
              'cycle_count'
          then
            'Cycle Count'
          else
            'Full Stock Opname'
        end,

        v_session.session_code,

        concat(
          'Stock Opname ',
          v_session.session_code,
          ' | System: ',
          v_current_qty,
          ' | Physical: ',
          v_final_qty
        ),

        auth.uid(),
        now()
      );


      v_qty_in :=
        v_qty_in +
        v_difference;

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
        r.variant_id,
        r.location_id,
        null,
        abs(
          v_difference
        ),

        case
          when
            v_session.opname_type =
              'cycle_count'
          then
            'Cycle Count'
          else
            'Full Stock Opname'
        end,

        v_session.session_code,

        concat(
          'Stock Opname ',
          v_session.session_code,
          ' | System: ',
          v_current_qty,
          ' | Physical: ',
          v_final_qty
        ),

        auth.uid(),
        now()
      );


      v_qty_out :=
        v_qty_out +
        abs(
          v_difference
        );

    end if;


    v_adjustment_lines :=
      v_adjustment_lines + 1;

  end loop;


  update public.stock_opname_sessions s
  set
    status =
      'finalized',

    adjustment_lines =
      v_adjustment_lines,

    qty_adjustment_in =
      v_qty_in,

    qty_adjustment_out =
      v_qty_out,

    finalized_by =
      auth.uid(),

    finalized_at =
      now(),

    updated_at =
      now()

  where
    s.id =
      p_session_id;


  return query
  select
    v_session.session_code,
    v_adjustment_lines,
    v_qty_in,
    v_qty_out;

end;
$$;



-- ============================================================
-- SECURITY
-- ============================================================

revoke all
on function public.create_stock_opname_session(
  text,
  uuid[],
  text
)
from public, anon;


revoke all
on function public.submit_stock_opname(
  uuid
)
from public, anon;


revoke all
on function public.finalize_stock_opname(
  uuid
)
from public, anon;


grant execute
on function public.create_stock_opname_session(
  text,
  uuid[],
  text
)
to authenticated;


grant execute
on function public.submit_stock_opname(
  uuid
)
to authenticated;


grant execute
on function public.finalize_stock_opname(
  uuid
)
to authenticated;


-- ============================================================
-- END OF MIGRATION 013
-- ============================================================
