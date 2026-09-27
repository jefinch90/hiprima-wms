-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 010_security_hardening.sql
--
-- Database-level role hardening
--
-- Permission matrix:
--
-- OWNER
--   Inbound / Outbound / Transfer / Return / Adjustment
--
-- ADMIN
--   Inbound / Outbound / Transfer / Return / Adjustment
--
-- WAREHOUSE_MANAGER
--   Inbound / Outbound / Transfer / Return / Adjustment
--
-- WAREHOUSE_STAFF
--   Inbound / Outbound / Transfer / Return
--   NO Stock Adjustment
--
-- VIEWER
--   Read only
--
-- Existing stock transaction logic is preserved.
-- ============================================================


-- ============================================================
-- 1. CENTRAL ROLE GUARD
-- ============================================================

create or replace function public.assert_wms_role(
  p_allowed public.app_user_role[]
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.app_user_role;
  v_is_active boolean;
begin

  if auth.uid() is null then
    raise exception
      'User belum login'
      using errcode = '42501';
  end if;


  select
    p.role,
    p.is_active
  into
    v_role,
    v_is_active
  from public.profiles p
  where p.id = auth.uid();


  if v_role is null then
    raise exception
      'Profile WMS tidak ditemukan'
      using errcode = '42501';
  end if;


  if coalesce(v_is_active, false) = false then
    raise exception
      'Akun WMS tidak aktif'
      using errcode = '42501';
  end if;


  if not (
    v_role = any(p_allowed)
  ) then
    raise exception
      'Akses ditolak untuk role %',
      v_role::text
      using errcode = '42501';
  end if;

end;
$$;


revoke all
on function public.assert_wms_role(
  public.app_user_role[]
)
from public;

revoke all
on function public.assert_wms_role(
  public.app_user_role[]
)
from anon;

grant execute
on function public.assert_wms_role(
  public.app_user_role[]
)
to authenticated;



-- ============================================================
-- 2. VERIFY REQUIRED MUTATING RPCs EXIST
-- ============================================================

do $$
declare
  v_function_count integer;
begin

  select count(distinct p.proname)
  into v_function_count
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where
    n.nspname = 'public'
    and p.proname in (
      'transfer_stock',
      'receive_inbound_stock',
      'outbound_stock',
      'adjust_stock_to_physical',
      'receive_return_stock',
      'return_stock_to_supplier'
    );


  if v_function_count <> 6 then
    raise exception
      'Security hardening dihentikan. Expected 6 stock RPCs, found %.',
      v_function_count;
  end if;

end;
$$;



-- ============================================================
-- 3. ADD DATABASE ROLE CHECK TO MUTATING RPCs
--
-- This preserves the complete existing function definitions.
-- We only inject assert_wms_role() immediately after the
-- outer BEGIN block.
--
-- Safe to run more than once:
-- functions already hardened will be skipped.
-- ============================================================

do $$
declare
  r record;

  v_definition text;
  v_begin_position integer;
  v_guard text;
begin

  for r in

    select
      p.oid,
      p.proname,
      p.prosrc,
      l.lanname

    from pg_proc p

    join pg_namespace n
      on n.oid = p.pronamespace

    join pg_language l
      on l.oid = p.prolang

    where
      n.nspname = 'public'

      and p.proname in (
        'transfer_stock',
        'receive_inbound_stock',
        'outbound_stock',
        'adjust_stock_to_physical',
        'receive_return_stock',
        'return_stock_to_supplier'
      )

    order by
      p.proname

  loop

    -- All targeted transaction functions must be PL/pgSQL.
    if r.lanname <> 'plpgsql' then
      raise exception
        'Function % is not PL/pgSQL. Hardening stopped.',
        r.proname;
    end if;


    -- Skip if this specific function already contains the guard.
    if position(
      'assert_wms_role'
      in lower(r.prosrc)
    ) > 0 then
      continue;
    end if;


    -- --------------------------------------------------------
    -- Adjustment is restricted:
    -- owner / admin / warehouse_manager only.
    -- --------------------------------------------------------

    if r.proname = 'adjust_stock_to_physical' then

      v_guard :=
        E'\n  perform public.assert_wms_role(\n'
        || E'    ARRAY[\n'
        || E'      ''owner'',\n'
        || E'      ''admin'',\n'
        || E'      ''warehouse_manager''\n'
        || E'    ]::public.app_user_role[]\n'
        || E'  );\n';


    -- --------------------------------------------------------
    -- Normal warehouse transaction functions:
    -- owner / admin / manager / staff.
    -- --------------------------------------------------------

    else

      v_guard :=
        E'\n  perform public.assert_wms_role(\n'
        || E'    ARRAY[\n'
        || E'      ''owner'',\n'
        || E'      ''admin'',\n'
        || E'      ''warehouse_manager'',\n'
        || E'      ''warehouse_staff''\n'
        || E'    ]::public.app_user_role[]\n'
        || E'  );\n';

    end if;


    -- Get the complete original CREATE OR REPLACE FUNCTION.
    v_definition :=
      pg_get_functiondef(r.oid);


    -- Locate the OUTER PL/pgSQL BEGIN.
    v_begin_position :=
      position(
        E'\nbegin'
        in lower(v_definition)
      );


    if v_begin_position = 0 then
      raise exception
        'Could not locate outer BEGIN in function %.',
        r.proname;
    end if;


    -- Insert guard immediately after BEGIN.
    v_definition :=
      overlay(
        v_definition
        placing v_guard
        from
          v_begin_position
          + length(E'\nbegin')
        for 0
      );


    -- Recreate the exact same function with role guard added.
    execute v_definition;

  end loop;

end;
$$;



-- ============================================================
-- 4. REINFORCE EXECUTE PRIVILEGES
--
-- PUBLIC / anon must never execute stock mutation functions.
-- authenticated may call them, but the function-level guard
-- decides whether their app role is actually allowed.
-- ============================================================

do $$
declare
  r record;
begin

  for r in

    select
      p.oid::regprocedure as function_signature

    from pg_proc p

    join pg_namespace n
      on n.oid = p.pronamespace

    where
      n.nspname = 'public'

      and p.proname in (
        'transfer_stock',
        'receive_inbound_stock',
        'outbound_stock',
        'adjust_stock_to_physical',
        'receive_return_stock',
        'return_stock_to_supplier'
      )

  loop

    execute format(
      'revoke all on function %s from public',
      r.function_signature
    );


    execute format(
      'revoke all on function %s from anon',
      r.function_signature
    );


    execute format(
      'grant execute on function %s to authenticated',
      r.function_signature
    );

  end loop;

end;
$$;



-- ============================================================
-- 5. PROTECT BASE TABLES FROM DIRECT STOCK WRITES
--
-- RLS already exists.
-- Reinforce SQL privileges as defense-in-depth.
--
-- Inventory and stock_movements remain readable to logged-in
-- WMS users through existing RLS policies.
--
-- Writes must go through approved RPCs.
-- ============================================================

revoke insert, update, delete
on table public.inventory
from anon;

revoke insert, update, delete
on table public.inventory
from authenticated;


revoke insert, update, delete
on table public.stock_movements
from anon;

revoke insert, update, delete
on table public.stock_movements
from authenticated;



-- ============================================================
-- 6. VERIFICATION
--
-- Stop migration if any mutating RPC failed to receive the
-- database role guard.
-- ============================================================

do $$
declare
  v_unprotected integer;
begin

  select count(*)
  into v_unprotected

  from pg_proc p

  join pg_namespace n
    on n.oid = p.pronamespace

  where
    n.nspname = 'public'

    and p.proname in (
      'transfer_stock',
      'receive_inbound_stock',
      'outbound_stock',
      'adjust_stock_to_physical',
      'receive_return_stock',
      'return_stock_to_supplier'
    )

    and position(
      'assert_wms_role'
      in lower(p.prosrc)
    ) = 0;


  if v_unprotected > 0 then
    raise exception
      'Security hardening incomplete. % mutating RPC(s) remain unprotected.',
      v_unprotected;
  end if;

end;
$$;



-- ============================================================
-- END OF MIGRATION
-- ============================================================