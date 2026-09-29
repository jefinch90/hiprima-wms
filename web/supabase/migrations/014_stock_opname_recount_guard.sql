-- ============================================================
-- Hi.PRIMA WMS
-- Migration 014
-- Stock Opname Recount Guard
--
-- Rules:
-- 1. First count berbeda dari system -> Recount WAJIB
-- 2. Finalize ditolak sampai semua initial variance direcount
-- 3. Setelah recount, hasil recount menjadi physical final
--
-- Safe:
-- - Tidak mengubah inventory saat migration dijalankan
-- - Tidak membuat stock movement
-- ============================================================


-- ============================================================
-- 1. REVIEW / RECOUNT STATUS
-- ============================================================

create or replace function public.get_stock_opname_recount_status(
  p_session_id uuid
)
returns table (
  pending_recount_lines bigint,
  recounted_lines bigint,
  confirmed_variance_lines bigint
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

    count(*) filter (
      where
        sol.counted_qty is not null

        and sol.counted_qty
          <> sol.system_qty

        and sol.recount_qty
          is null
    )::bigint
      as pending_recount_lines,


    count(*) filter (
      where
        sol.recount_qty
          is not null
    )::bigint
      as recounted_lines,


    count(*) filter (
      where
        sol.recount_qty
          is not null

        and sol.recount_qty
          <> sol.system_qty
    )::bigint
      as confirmed_variance_lines

  from public.stock_opname_lines sol

  where
    sol.session_id =
      p_session_id;

end;
$$;



-- ============================================================
-- 2. SAFE FINALIZE WRAPPER
--
-- Existing finalize_stock_opname remains core posting logic.
--
-- Authenticated users may only use this checked version.
-- ============================================================

create or replace function public.finalize_stock_opname_checked(
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
  v_pending_recount bigint;
begin

  perform public.assert_wms_role(
    array[
      'owner',
      'admin',
      'warehouse_manager'
    ]::public.app_user_role[]
  );


  select
    count(*)

  into
    v_pending_recount

  from public.stock_opname_lines sol

  where
    sol.session_id =
      p_session_id

    and sol.counted_qty
      is not null

    and sol.counted_qty
      <> sol.system_qty

    and sol.recount_qty
      is null;


  if
    v_pending_recount > 0
  then
    raise exception
      'Finalize ditolak. Masih ada % SKU selisih yang belum dilakukan Recount.',
      v_pending_recount;
  end if;


  return query

  select
    f.session_code,
    f.adjustment_lines,
    f.qty_adjustment_in,
    f.qty_adjustment_out

  from public.finalize_stock_opname(
    p_session_id
  ) f;

end;
$$;



-- ============================================================
-- 3. SECURITY
--
-- Direct finalize lama tidak boleh dipanggil dari client.
-- Client wajib lewat checked wrapper.
-- ============================================================

revoke execute
on function public.finalize_stock_opname(
  uuid
)
from authenticated;


revoke all
on function public.get_stock_opname_recount_status(
  uuid
)
from public, anon;


revoke all
on function public.finalize_stock_opname_checked(
  uuid
)
from public, anon;


grant execute
on function public.get_stock_opname_recount_status(
  uuid
)
to authenticated;


grant execute
on function public.finalize_stock_opname_checked(
  uuid
)
to authenticated;


-- ============================================================
-- END OF MIGRATION 014
-- ============================================================
