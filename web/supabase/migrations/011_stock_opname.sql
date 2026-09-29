-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 011_stock_opname.sql
--
-- STOCK OPNAME
--
-- Modes:
-- 1. cycle_count
--    Daily / routine count for selected racks
--
-- 2. full
--    Full warehouse physical inventory
--
-- Permission:
--
-- OWNER
-- ADMIN
-- WAREHOUSE_MANAGER
--   Create / Count / Recount / Submit / Finalize / Cancel
--
-- WAREHOUSE_STAFF
--   Count / Recount / Submit
--   NO Finalize
--
-- VIEWER
--   Read only
--
-- IMPORTANT:
-- Inventory is NOT changed while counting.
-- Inventory changes only during FINALIZE.
-- ============================================================


-- ============================================================
-- 1. STOCK OPNAME SESSIONS
-- ============================================================

create table if not exists public.stock_opname_sessions (
  id uuid primary key default gen_random_uuid(),

  opname_no bigint
    generated always as identity,

  session_code text unique,

  opname_type text not null
    check (
      opname_type in (
        'cycle_count',
        'full'
      )
    ),

  status text not null default 'draft'
    check (
      status in (
        'draft',
        'counting',
        'review',
        'finalized',
        'cancelled'
      )
    ),

  notes text,

  adjustment_lines integer
    not null default 0,

  qty_adjustment_in integer
    not null default 0,

  qty_adjustment_out integer
    not null default 0,

  created_by uuid
    references auth.users(id)
    on delete set null,

  created_at timestamptz
    not null default now(),

  started_at timestamptz,

  submitted_at timestamptz,

  finalized_by uuid
    references auth.users(id)
    on delete set null,

  finalized_at timestamptz,

  cancelled_by uuid
    references auth.users(id)
    on delete set null,

  cancelled_at timestamptz,

  updated_at timestamptz
    not null default now()
);


create index if not exists
stock_opname_sessions_type_idx
on public.stock_opname_sessions (
  opname_type
);


create index if not exists
stock_opname_sessions_status_idx
on public.stock_opname_sessions (
  status
);


create index if not exists
stock_opname_sessions_created_at_idx
on public.stock_opname_sessions (
  created_at desc
);



-- ============================================================
-- 2. SESSION LOCATION SCOPE
--
-- Cycle Count:
-- only selected racks
--
-- Full:
-- all active racks
-- ============================================================

create table if not exists public.stock_opname_locations (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.stock_opname_sessions(id)
    on delete cascade,

  location_id uuid not null
    references public.locations(id),

  created_at timestamptz
    not null default now(),

  unique (
    session_id,
    location_id
  )
);


create index if not exists
stock_opname_locations_session_idx
on public.stock_opname_locations (
  session_id
);



-- ============================================================
-- 3. STOCK OPNAME LINES
--
-- system_qty   = stock snapshot when session created
-- counted_qty  = first physical count
-- recount_qty  = optional second count
--
-- Final quantity:
-- recount_qty when available,
-- otherwise counted_qty.
-- ============================================================

create table if not exists public.stock_opname_lines (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.stock_opname_sessions(id)
    on delete cascade,

  variant_id uuid not null
    references public.product_variants(id),

  location_id uuid not null
    references public.locations(id),

  system_qty integer not null
    check (system_qty >= 0),

  counted_qty integer
    check (
      counted_qty is null
      or counted_qty >= 0
    ),

  counted_by uuid
    references auth.users(id)
    on delete set null,

  counted_at timestamptz,

  recount_qty integer
    check (
      recount_qty is null
      or recount_qty >= 0
    ),

  recounted_by uuid
    references auth.users(id)
    on delete set null,

  recounted_at timestamptz,

  created_at timestamptz
    not null default now(),

  updated_at timestamptz
    not null default now(),

  unique (
    session_id,
    variant_id,
    location_id
  )
);


create index if not exists
stock_opname_lines_session_idx
on public.stock_opname_lines (
  session_id
);


create index if not exists
stock_opname_lines_variant_idx
on public.stock_opname_lines (
  variant_id
);


create index if not exists
stock_opname_lines_location_idx
on public.stock_opname_lines (
  location_id
);



-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.stock_opname_sessions
enable row level security;


alter table public.stock_opname_locations
enable row level security;


alter table public.stock_opname_lines
enable row level security;



drop policy if exists
"Authenticated can read stock opname sessions"
on public.stock_opname_sessions;


create policy
"Authenticated can read stock opname sessions"
on public.stock_opname_sessions
for select
to authenticated
using (true);



drop policy if exists
"Authenticated can read stock opname locations"
on public.stock_opname_locations;


create policy
"Authenticated can read stock opname locations"
on public.stock_opname_locations
for select
to authenticated
using (true);



drop policy if exists
"Authenticated can read stock opname lines"
on public.stock_opname_lines;


create policy
"Authenticated can read stock opname lines"
on public.stock_opname_lines
for select
to authenticated
using (true);



-- Direct writes are forbidden.
-- All writes go through RPC.

revoke insert, update, delete
on public.stock_opname_sessions
from anon, authenticated;


revoke insert, update, delete
on public.stock_opname_locations
from anon, authenticated;


revoke insert, update, delete
on public.stock_opname_lines
from anon, authenticated;


grant select
on public.stock_opname_sessions
to authenticated;


grant select
on public.stock_opname_locations
to authenticated;


grant select
on public.stock_opname_lines
to authenticated;



-- ============================================================
-- 5. CREATE STOCK OPNAME SESSION
--
-- p_opname_type:
-- cycle_count / full
--
-- Cycle count requires selected location IDs.
-- Full automatically includes all active locations.
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
      or cardinality(
        p_location_ids
      ) = 0
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
    id,
    opname_no
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


  update public.stock_opname_sessions
  set
    session_code =
      v_session_code,
    updated_at = now()
  where
    id = v_session_id;


  -- ----------------------------------------------------------
  -- Cycle Count:
  -- selected active locations only
  -- ----------------------------------------------------------

  if v_type = 'cycle_count' then

    select
      count(distinct x.location_id)
    into
      v_requested_locations
    from
      unnest(
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
      v_inserted_locations
      <> v_requested_locations
    then
      raise exception
        'Ada rack yang tidak ditemukan atau tidak aktif';
    end if;


  -- ----------------------------------------------------------
  -- Full Opname:
  -- every active location
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Snapshot inventory
  -- ----------------------------------------------------------

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
-- 6. ADD UNEXPECTED SKU TO SESSION
--
-- Used when physical stock exists but system inventory row
-- does not exist in the rack.
--
-- Staff is allowed to add count lines.
-- ============================================================

create or replace function public.add_stock_opname_line(
  p_session_id uuid,
  p_variant_id uuid,
  p_location_id uuid
)
returns table (
  line_id uuid,
  system_qty integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_system_qty integer;
  v_line_id uuid;
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
    status
  into
    v_status
  from public.stock_opname_sessions
  where
    id = p_session_id;


  if v_status is null then
    raise exception
      'Session Stock Opname tidak ditemukan';
  end if;


  if v_status not in (
    'draft',
    'counting'
  ) then
    raise exception
      'SKU hanya dapat ditambahkan saat session masih Draft atau Counting';
  end if;


  if not exists (
    select 1
    from public.stock_opname_locations
    where
      session_id =
        p_session_id
      and location_id =
        p_location_id
  ) then
    raise exception
      'Rack tidak termasuk scope Stock Opname';
  end if;


  if not exists (
    select 1
    from public.product_variants
    where
      id = p_variant_id
  ) then
    raise exception
      'SKU tidak ditemukan';
  end if;


  select
    qty_on_hand
  into
    v_system_qty
  from public.inventory
  where
    variant_id =
      p_variant_id
    and location_id =
      p_location_id;


  v_system_qty :=
    coalesce(
      v_system_qty,
      0
    );


  insert into public.stock_opname_lines (
    session_id,
    variant_id,
    location_id,
    system_qty,
    created_at,
    updated_at
  )
  values (
    p_session_id,
    p_variant_id,
    p_location_id,
    v_system_qty,
    now(),
    now()
  )

  on conflict (
    session_id,
    variant_id,
    location_id
  )

  do update set
    updated_at = now()

  returning
    id,
    stock_opname_lines.system_qty
  into
    v_line_id,
    v_system_qty;


  return query
  select
    v_line_id,
    v_system_qty;

end;
$$;



-- ============================================================
-- 7. SAVE FIRST PHYSICAL COUNT
-- ============================================================

create or replace function public.save_stock_opname_count(
  p_session_id uuid,
  p_variant_id uuid,
  p_location_id uuid,
  p_counted_qty integer
)
returns table (
  system_qty integer,
  counted_qty integer,
  variance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_system_qty integer;
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager',
      'warehouse_staff'
    ]::public.app_user_role[]
  );


  if
    p_counted_qty is null
    or p_counted_qty < 0
  then
    raise exception
      'Stok fisik harus 0 atau lebih';
  end if;


  select
    status
  into
    v_status
  from public.stock_opname_sessions
  where
    id = p_session_id
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
      'Count hanya dapat dilakukan saat session Draft atau Counting';
  end if;


  update public.stock_opname_lines
  set
    counted_qty =
      p_counted_qty,

    counted_by =
      auth.uid(),

    counted_at =
      now(),

    recount_qty =
      null,

    recounted_by =
      null,

    recounted_at =
      null,

    updated_at =
      now()

  where
    session_id =
      p_session_id

    and variant_id =
      p_variant_id

    and location_id =
      p_location_id

  returning
    stock_opname_lines.system_qty
  into
    v_system_qty;


  if not found then
    raise exception
      'SKU / rack tidak ditemukan dalam session Stock Opname';
  end if;


  update public.stock_opname_sessions
  set
    status = 'counting',

    started_at =
      coalesce(
        started_at,
        now()
      ),

    updated_at =
      now()

  where
    id = p_session_id;


  return query
  select
    v_system_qty,
    p_counted_qty,
    p_counted_qty -
      v_system_qty;

end;
$$;



-- ============================================================
-- 8. SAVE RECOUNT
--
-- Used when a variance needs a second physical check.
-- ============================================================

create or replace function public.save_stock_opname_recount(
  p_session_id uuid,
  p_variant_id uuid,
  p_location_id uuid,
  p_recount_qty integer
)
returns table (
  system_qty integer,
  first_count_qty integer,
  recount_qty integer,
  final_variance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_system_qty integer;
  v_first_count integer;
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager',
      'warehouse_staff'
    ]::public.app_user_role[]
  );


  if
    p_recount_qty is null
    or p_recount_qty < 0
  then
    raise exception
      'Recount harus 0 atau lebih';
  end if;


  select
    status
  into
    v_status
  from public.stock_opname_sessions
  where
    id = p_session_id;


  if v_status is null then
    raise exception
      'Session Stock Opname tidak ditemukan';
  end if;


  if v_status not in (
    'counting',
    'review'
  ) then
    raise exception
      'Recount hanya dapat dilakukan saat Counting atau Review';
  end if;


  update public.stock_opname_lines
  set
    recount_qty =
      p_recount_qty,

    recounted_by =
      auth.uid(),

    recounted_at =
      now(),

    updated_at =
      now()

  where
    session_id =
      p_session_id

    and variant_id =
      p_variant_id

    and location_id =
      p_location_id

    and counted_qty
      is not null

  returning
    stock_opname_lines.system_qty,
    stock_opname_lines.counted_qty
  into
    v_system_qty,
    v_first_count;


  if not found then
    raise exception
      'First count belum dilakukan untuk SKU / rack ini';
  end if;


  return query
  select
    v_system_qty,
    v_first_count,
    p_recount_qty,
    p_recount_qty -
      v_system_qty;

end;
$$;



-- ============================================================
-- 9. SUBMIT SESSION FOR REVIEW
--
-- Staff may submit,
-- but may NOT finalize.
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
    status,
    session_code
  into
    v_status,
    v_code
  from public.stock_opname_sessions
  where
    id = p_session_id
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
      where counted_qty
        is not null
    ),

    count(*) filter (
      where
        counted_qty is not null
        and
        coalesce(
          recount_qty,
          counted_qty
        ) <> system_qty
    )

  into
    v_total,
    v_counted,
    v_variance

  from public.stock_opname_lines
  where
    session_id =
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


  update public.stock_opname_sessions
  set
    status =
      'review',

    submitted_at =
      now(),

    updated_at =
      now()

  where
    id =
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
-- 10. FINALIZE STOCK OPNAME
--
-- ONLY:
-- Owner / Admin / Warehouse Manager
--
-- Safety:
-- If live inventory has changed since snapshot,
-- FINALIZE IS BLOCKED.
--
-- This prevents old physical counts from overwriting
-- newer warehouse transactions.
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
    *
  into
    v_session
  from public.stock_opname_sessions
  where
    id = p_session_id
  for update;


  if not found then
    raise exception
      'Session Stock Opname tidak ditemukan';
  end if;


  if
    v_session.status
    <> 'review'
  then
    raise exception
      'Stock Opname hanya dapat difinalize dari status Review';
  end if;


  if exists (
    select 1
    from public.stock_opname_lines
    where
      session_id =
        p_session_id
      and counted_qty
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
      l.code as location_code

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

    -- --------------------------------------------------------
    -- Lock current inventory row
    -- --------------------------------------------------------

    select
      qty_on_hand
    into
      v_current_qty
    from public.inventory
    where
      variant_id =
        r.variant_id

      and location_id =
        r.location_id
    for update;


    if not found then
      v_current_qty := 0;
    end if;


    -- --------------------------------------------------------
    -- Safety check:
    -- inventory must still equal snapshot
    -- --------------------------------------------------------

    if
      v_current_qty
      <> r.system_qty
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


    -- No variance
    if v_difference = 0 then
      continue;
    end if;


    -- --------------------------------------------------------
    -- Set inventory to physical quantity
    -- --------------------------------------------------------

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


    -- --------------------------------------------------------
    -- Adjustment IN
    -- --------------------------------------------------------

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


    -- --------------------------------------------------------
    -- Adjustment OUT
    -- --------------------------------------------------------

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
      v_adjustment_lines +
      1;

  end loop;


  update public.stock_opname_sessions
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
    id =
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
-- 11. CANCEL STOCK OPNAME
-- ============================================================

create or replace function public.cancel_stock_opname(
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager'
    ]::public.app_user_role[]
  );


  select
    status
  into
    v_status
  from public.stock_opname_sessions
  where
    id = p_session_id
  for update;


  if v_status is null then
    raise exception
      'Session Stock Opname tidak ditemukan';
  end if;


  if v_status in (
    'finalized',
    'cancelled'
  ) then
    raise exception
      'Session dengan status % tidak dapat dibatalkan',
      v_status;
  end if;


  update public.stock_opname_sessions
  set
    status =
      'cancelled',

    cancelled_by =
      auth.uid(),

    cancelled_at =
      now(),

    updated_at =
      now()

  where
    id =
      p_session_id;

end;
$$;



-- ============================================================
-- 12. GET STOCK OPNAME SESSIONS
-- ============================================================

create or replace function public.get_stock_opname_sessions(
  p_search text default null,
  p_type text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  session_id uuid,
  session_code text,
  opname_type text,
  status text,
  notes text,

  total_locations bigint,
  total_lines bigint,
  counted_lines bigint,
  variance_lines bigint,

  progress_percent numeric,

  adjustment_lines integer,
  qty_adjustment_in integer,
  qty_adjustment_out integer,

  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  submitted_at timestamptz,
  finalized_at timestamptz,

  total_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      s.id as session_id,
      s.session_code,
      s.opname_type,
      s.status,
      s.notes,

      (
        select count(*)
        from public.stock_opname_locations sl
        where
          sl.session_id = s.id
      ) as total_locations,

      (
        select count(*)
        from public.stock_opname_lines l
        where
          l.session_id = s.id
      ) as total_lines,

      (
        select count(*)
        from public.stock_opname_lines l
        where
          l.session_id = s.id
          and l.counted_qty
            is not null
      ) as counted_lines,

      (
        select count(*)
        from public.stock_opname_lines l
        where
          l.session_id = s.id
          and l.counted_qty
            is not null
          and
            coalesce(
              l.recount_qty,
              l.counted_qty
            ) <> l.system_qty
      ) as variance_lines,

      s.adjustment_lines,
      s.qty_adjustment_in,
      s.qty_adjustment_out,

      s.created_by,
      p.full_name as created_by_name,

      s.created_at,
      s.submitted_at,
      s.finalized_at

    from public.stock_opname_sessions s

    left join public.profiles p
      on p.id = s.created_by

    where
      (
        coalesce(
          trim(p_search),
          ''
        ) = ''

        or s.session_code
          ilike
          '%' ||
          trim(p_search) ||
          '%'

        or coalesce(
          s.notes,
          ''
        )
          ilike
          '%' ||
          trim(p_search) ||
          '%'
      )

      and (
        coalesce(
          trim(p_type),
          ''
        ) = ''

        or s.opname_type =
          trim(p_type)
      )

      and (
        coalesce(
          trim(p_status),
          ''
        ) = ''

        or s.status =
          trim(p_status)
      )
  )

  select
    b.session_id,
    b.session_code,
    b.opname_type,
    b.status,
    b.notes,

    b.total_locations,
    b.total_lines,
    b.counted_lines,
    b.variance_lines,

    case
      when b.total_lines = 0
        then 0
      else
        round(
          (
            b.counted_lines::numeric
            /
            b.total_lines::numeric
          ) * 100,
          1
        )
    end as progress_percent,

    b.adjustment_lines,
    b.qty_adjustment_in,
    b.qty_adjustment_out,

    b.created_by,
    b.created_by_name,
    b.created_at,
    b.submitted_at,
    b.finalized_at,

    count(*) over()
      as total_count

  from base b

  order by
    b.created_at desc

  limit least(
    greatest(
      coalesce(
        p_limit,
        50
      ),
      1
    ),
    100
  )

  offset greatest(
    coalesce(
      p_offset,
      0
    ),
    0
  );
$$;



-- ============================================================
-- 13. GET SESSION LINES
-- ============================================================

create or replace function public.get_stock_opname_lines(
  p_session_id uuid,
  p_search text default null,
  p_only_variance boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  line_id uuid,

  variant_id uuid,
  sku text,
  product_code text,
  product_name text,
  color text,
  size text,

  location_id uuid,
  location_code text,
  location_name text,
  area_code text,
  area_name text,

  system_qty integer,
  counted_qty integer,
  recount_qty integer,

  final_count_qty integer,
  variance integer,

  counted_by_name text,
  counted_at timestamptz,

  recounted_by_name text,
  recounted_at timestamptz,

  total_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      sol.id as line_id,

      sol.variant_id,
      pv.sku,
      p.product_code,
      p.name as product_name,
      pv.color,
      pv.size,

      sol.location_id,
      l.code as location_code,
      l.name as location_name,
      sa.code as area_code,
      sa.name as area_name,

      sol.system_qty,
      sol.counted_qty,
      sol.recount_qty,

      case
        when sol.counted_qty
          is null
        then null
        else
          coalesce(
            sol.recount_qty,
            sol.counted_qty
          )
      end as final_count_qty,

      case
        when sol.counted_qty
          is null
        then null
        else
          coalesce(
            sol.recount_qty,
            sol.counted_qty
          )
          - sol.system_qty
      end as variance,

      counted_profile.full_name
        as counted_by_name,

      sol.counted_at,

      recount_profile.full_name
        as recounted_by_name,

      sol.recounted_at

    from public.stock_opname_lines sol

    join public.product_variants pv
      on pv.id =
         sol.variant_id

    join public.products p
      on p.id =
         pv.product_id

    join public.locations l
      on l.id =
         sol.location_id

    join public.stock_areas sa
      on sa.id =
         l.area_id

    left join public.profiles counted_profile
      on counted_profile.id =
         sol.counted_by

    left join public.profiles recount_profile
      on recount_profile.id =
         sol.recounted_by

    where
      sol.session_id =
        p_session_id

      and (
        coalesce(
          trim(p_search),
          ''
        ) = ''

        or pv.sku
          ilike
          '%' ||
          trim(p_search) ||
          '%'

        or p.product_code
          ilike
          '%' ||
          trim(p_search) ||
          '%'

        or p.name
          ilike
          '%' ||
          trim(p_search) ||
          '%'

        or l.code
          ilike
          '%' ||
          trim(p_search) ||
          '%'
      )
  )

  select
    b.line_id,

    b.variant_id,
    b.sku,
    b.product_code,
    b.product_name,
    b.color,
    b.size,

    b.location_id,
    b.location_code,
    b.location_name,
    b.area_code,
    b.area_name,

    b.system_qty,
    b.counted_qty,
    b.recount_qty,

    b.final_count_qty,
    b.variance,

    b.counted_by_name,
    b.counted_at,

    b.recounted_by_name,
    b.recounted_at,

    count(*) over()
      as total_count

  from base b

  where
    (
      p_only_variance = false

      or (
        b.variance is not null
        and b.variance <> 0
      )
    )

  order by
    b.location_code,
    b.sku

  limit least(
    greatest(
      coalesce(
        p_limit,
        100
      ),
      1
    ),
    500
  )

  offset greatest(
    coalesce(
      p_offset,
      0
    ),
    0
  );
$$;



-- ============================================================
-- 14. GET ACTIVE LOCATIONS FOR CYCLE COUNT
-- ============================================================

create or replace function public.get_stock_opname_locations()
returns table (
  location_id uuid,
  location_code text,
  location_name text,
  area_code text,
  area_name text,
  total_sku bigint,
  total_qty bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.id,
    l.code,
    l.name,
    sa.code,
    sa.name,

    count(
      distinct
      case
        when
          coalesce(
            i.qty_on_hand,
            0
          ) > 0
        then
          i.variant_id
      end
    ) as total_sku,

    coalesce(
      sum(
        i.qty_on_hand
      ),
      0
    )::bigint
      as total_qty

  from public.locations l

  join public.stock_areas sa
    on sa.id =
       l.area_id

  left join public.inventory i
    on i.location_id =
       l.id

  where
    l.is_active = true

  group by
    l.id,
    l.code,
    l.name,
    sa.code,
    sa.name

  order by
    case
      when
        upper(sa.code) =
          'NORMAL'
      then 1

      when
        upper(sa.code) =
          'DEFECT'
      then 2

      when
        upper(sa.code) =
          'REJECT'
      then 3

      else 4
    end,

    l.code;
$$;



-- ============================================================
-- 15. SECURITY / EXECUTE PERMISSIONS
-- ============================================================

revoke all
on function public.create_stock_opname_session(
  text,
  uuid[],
  text
)
from public, anon;


revoke all
on function public.add_stock_opname_line(
  uuid,
  uuid,
  uuid
)
from public, anon;


revoke all
on function public.save_stock_opname_count(
  uuid,
  uuid,
  uuid,
  integer
)
from public, anon;


revoke all
on function public.save_stock_opname_recount(
  uuid,
  uuid,
  uuid,
  integer
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


revoke all
on function public.cancel_stock_opname(
  uuid
)
from public, anon;


revoke all
on function public.get_stock_opname_sessions(
  text,
  text,
  text,
  integer,
  integer
)
from public, anon;


revoke all
on function public.get_stock_opname_lines(
  uuid,
  text,
  boolean,
  integer,
  integer
)
from public, anon;


revoke all
on function public.get_stock_opname_locations()
from public, anon;



grant execute
on function public.create_stock_opname_session(
  text,
  uuid[],
  text
)
to authenticated;


grant execute
on function public.add_stock_opname_line(
  uuid,
  uuid,
  uuid
)
to authenticated;


grant execute
on function public.save_stock_opname_count(
  uuid,
  uuid,
  uuid,
  integer
)
to authenticated;


grant execute
on function public.save_stock_opname_recount(
  uuid,
  uuid,
  uuid,
  integer
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


grant execute
on function public.cancel_stock_opname(
  uuid
)
to authenticated;


grant execute
on function public.get_stock_opname_sessions(
  text,
  text,
  text,
  integer,
  integer
)
to authenticated;


grant execute
on function public.get_stock_opname_lines(
  uuid,
  text,
  boolean,
  integer,
  integer
)
to authenticated;


grant execute
on function public.get_stock_opname_locations()
to authenticated;



-- ============================================================
-- END OF MIGRATION 011
-- ============================================================