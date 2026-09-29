-- ============================================================
-- Hi.PRIMA WMS
-- Migration 012
-- Stock Opname Counting Workflow
--
-- Purpose:
-- - Session detail
-- - Rack-by-rack progress
-- - SKU list per selected rack
--
-- No inventory is changed by this migration.
-- ============================================================


-- ============================================================
-- 1. GET STOCK OPNAME SESSION DETAIL
-- ============================================================

create or replace function public.get_stock_opname_session_detail(
  p_session_id uuid
)
returns table (
  session_id uuid,
  session_code text,
  opname_type text,
  status text,
  notes text,

  total_locations bigint,
  completed_locations bigint,

  total_lines bigint,
  counted_lines bigint,
  variance_lines bigint,

  progress_percent numeric,

  created_by uuid,
  created_by_name text,

  created_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,

  finalized_by uuid,
  finalized_at timestamptz,

  adjustment_lines integer,
  qty_adjustment_in integer,
  qty_adjustment_out integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager',
      'warehouse_staff',
      'viewer'
    ]::public.app_user_role[]
  );


  return query

  with session_stats as (
    select
      s.id,

      (
        select count(*)
        from public.stock_opname_locations sl
        where sl.session_id = s.id
      ) as total_locations,

      (
        select count(*)
        from public.stock_opname_lines l
        where l.session_id = s.id
      ) as total_lines,

      (
        select count(*)
        from public.stock_opname_lines l
        where
          l.session_id = s.id
          and l.counted_qty is not null
      ) as counted_lines,

      (
        select count(*)
        from public.stock_opname_lines l
        where
          l.session_id = s.id
          and l.counted_qty is not null
          and
          coalesce(
            l.recount_qty,
            l.counted_qty
          ) <> l.system_qty
      ) as variance_lines

    from public.stock_opname_sessions s
    where s.id = p_session_id
  ),

  rack_stats as (
    select
      count(*) filter (
        where
          x.total_lines > 0
          and
          x.counted_lines =
          x.total_lines
      ) as completed_locations

    from (
      select
        sl.location_id,

        count(sol.id)
          as total_lines,

        count(sol.id) filter (
          where
            sol.counted_qty
            is not null
        ) as counted_lines

      from public.stock_opname_locations sl

      left join public.stock_opname_lines sol
        on sol.session_id =
           sl.session_id
        and sol.location_id =
            sl.location_id

      where
        sl.session_id =
          p_session_id

      group by
        sl.location_id
    ) x
  )

  select
    s.id,
    s.session_code,
    s.opname_type,
    s.status,
    s.notes,

    ss.total_locations,

    coalesce(
      rs.completed_locations,
      0
    ),

    ss.total_lines,
    ss.counted_lines,
    ss.variance_lines,

    case
      when ss.total_lines = 0
        then 0
      else
        round(
          (
            ss.counted_lines::numeric
            /
            ss.total_lines::numeric
          ) * 100,
          1
        )
    end,

    s.created_by,
    p.full_name,

    s.created_at,
    s.started_at,
    s.submitted_at,

    s.finalized_by,
    s.finalized_at,

    s.adjustment_lines,
    s.qty_adjustment_in,
    s.qty_adjustment_out

  from public.stock_opname_sessions s

  join session_stats ss
    on ss.id = s.id

  cross join rack_stats rs

  left join public.profiles p
    on p.id = s.created_by

  where
    s.id =
      p_session_id;

end;
$$;



-- ============================================================
-- 2. GET RACK PROGRESS FOR A SESSION
-- ============================================================

create or replace function public.get_stock_opname_racks(
  p_session_id uuid
)
returns table (
  location_id uuid,
  location_code text,
  location_name text,

  area_code text,
  area_name text,

  total_lines bigint,
  counted_lines bigint,
  variance_lines bigint,

  progress_percent numeric,
  is_complete boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager',
      'warehouse_staff',
      'viewer'
    ]::public.app_user_role[]
  );


  return query

  select
    l.id,
    l.code,
    l.name,

    sa.code,
    sa.name,

    count(sol.id)
      as total_lines,

    count(sol.id) filter (
      where
        sol.counted_qty
        is not null
    ) as counted_lines,

    count(sol.id) filter (
      where
        sol.counted_qty
        is not null
        and
        coalesce(
          sol.recount_qty,
          sol.counted_qty
        ) <> sol.system_qty
    ) as variance_lines,

    case
      when count(sol.id) = 0
        then 0
      else
        round(
          (
            count(sol.id) filter (
              where
                sol.counted_qty
                is not null
            )
          )::numeric
          /
          count(sol.id)::numeric
          * 100,
          1
        )
    end as progress_percent,

    (
      count(sol.id) > 0
      and
      count(sol.id) filter (
        where
          sol.counted_qty
          is not null
      ) = count(sol.id)
    ) as is_complete

  from public.stock_opname_locations osl

  join public.locations l
    on l.id =
       osl.location_id

  join public.stock_areas sa
    on sa.id =
       l.area_id

  left join public.stock_opname_lines sol
    on sol.session_id =
       osl.session_id

    and sol.location_id =
        osl.location_id

  where
    osl.session_id =
      p_session_id

  group by
    l.id,
    l.code,
    l.name,
    sa.code,
    sa.name

  order by
    case
      when upper(sa.code) =
        'NORMAL'
      then 1

      when upper(sa.code) =
        'DEFECT'
      then 2

      when upper(sa.code) =
        'REJECT'
      then 3

      else 4
    end,

    l.code;

end;
$$;



-- ============================================================
-- 3. GET SKU LINES FOR ONE RACK
--
-- This prevents staff from loading thousands of lines
-- during Full Stock Opname.
-- ============================================================

create or replace function public.get_stock_opname_lines_by_rack(
  p_session_id uuid,
  p_location_id uuid,
  p_search text default null,
  p_limit integer default 500,
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

  counted_by uuid,
  counted_by_name text,
  counted_at timestamptz,

  recounted_by uuid,
  recounted_by_name text,
  recounted_at timestamptz,

  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager',
      'warehouse_staff',
      'viewer'
    ]::public.app_user_role[]
  );


  if not exists (
    select 1
    from public.stock_opname_locations osl
    where
      osl.session_id =
        p_session_id

      and osl.location_id =
        p_location_id
  ) then
    raise exception
      'Rack tidak termasuk dalam session Stock Opname';
  end if;


  return query

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
        when
          sol.counted_qty
          is null
        then null

        else
          coalesce(
            sol.recount_qty,
            sol.counted_qty
          )
      end as final_count_qty,

      case
        when
          sol.counted_qty
          is null
        then null

        else
          coalesce(
            sol.recount_qty,
            sol.counted_qty
          )
          - sol.system_qty
      end as variance,

      sol.counted_by,
      cp.full_name
        as counted_by_name,
      sol.counted_at,

      sol.recounted_by,
      rp.full_name
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

    left join public.profiles cp
      on cp.id =
         sol.counted_by

    left join public.profiles rp
      on rp.id =
         sol.recounted_by

    where
      sol.session_id =
        p_session_id

      and sol.location_id =
        p_location_id

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

        or coalesce(
          pv.color,
          ''
        )
          ilike
          '%' ||
          trim(p_search) ||
          '%'

        or coalesce(
          pv.size,
          ''
        )
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

    b.counted_by,
    b.counted_by_name,
    b.counted_at,

    b.recounted_by,
    b.recounted_by_name,
    b.recounted_at,

    count(*) over()
      as total_count

  from base b

  order by
    b.sku

  limit least(
    greatest(
      coalesce(
        p_limit,
        500
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

end;
$$;



-- ============================================================
-- 4. SECURITY
-- ============================================================

revoke all
on function public.get_stock_opname_session_detail(
  uuid
)
from public, anon;


revoke all
on function public.get_stock_opname_racks(
  uuid
)
from public, anon;


revoke all
on function public.get_stock_opname_lines_by_rack(
  uuid,
  uuid,
  text,
  integer,
  integer
)
from public, anon;



grant execute
on function public.get_stock_opname_session_detail(
  uuid
)
to authenticated;


grant execute
on function public.get_stock_opname_racks(
  uuid
)
to authenticated;


grant execute
on function public.get_stock_opname_lines_by_rack(
  uuid,
  uuid,
  text,
  integer,
  integer
)
to authenticated;



-- ============================================================
-- END OF MIGRATION 012
-- ============================================================