-- Fix the Recount RPC ambiguity discovered during UI E2E after migration 015.
-- RETURNS TABLE output names are PL/pgSQL variables; qualify source columns
-- so system_qty/recount_qty refer to the stock_opname_lines row.
-- No existing rows, inventory, movements, permissions, or business rules change.
-- Apply the complete migration in one transaction; do not edit migration 015.
set local lock_timeout = '10s';

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
  v_type text;
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
    status,
    opname_type
  into
    v_status,
    v_type
  from public.stock_opname_sessions
  where
    id = p_session_id
  for update;


  if v_status is null then
    raise exception
      'Session Stock Opname tidak ditemukan';
  end if;

  if v_type = 'full' then
    perform public.assert_wms_role(array[
      'owner', 'admin', 'warehouse_manager'
    ]::public.app_user_role[]);
  end if;


  if v_status not in (
    'counting',
    'review'
  ) then
    raise exception
      'Recount hanya dapat dilakukan saat Counting atau Review';
  end if;


  update public.stock_opname_lines as l
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
    l.session_id =
      p_session_id

    and l.variant_id =
      p_variant_id

    and l.location_id =
      p_location_id

    and l.counted_qty
      is not null

    and (
      v_type <> 'cycle_count'
      or l.counted_qty <> l.system_qty
      or l.recount_qty is not null
    )

  returning
    l.system_qty,
    l.counted_qty
  into
    v_system_qty,
    v_first_count;


  if not found then
    raise exception
      'First count belum dilakukan atau tidak ada selisih untuk SKU / rack ini';
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
