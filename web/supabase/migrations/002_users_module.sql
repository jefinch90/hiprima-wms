-- ============================================================
-- Hi.PRIMA WMS
-- Migration: 002_users_module.sql
--
-- USERS MANAGEMENT MODULE
--
-- Source-controlled database functions for:
-- 1. Reading WMS users
-- 2. Updating user profile / role / status
--
-- IMPORTANT:
-- - public.profiles and its role enum already exist
--   in the base Hi.PRIMA WMS database.
-- - Owner assignment is intentionally NOT hardcoded
--   to a personal email in GitHub.
-- - This migration is safe to keep as the database blueprint.
-- ============================================================


begin;


-- ============================================================
-- 1. GET USERS LIST
--
-- Access:
-- OWNER / ADMIN only
--
-- Used by:
-- /users
-- ============================================================

create or replace function public.get_users_list(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  is_active boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_current_role text;
begin

  -- User harus login
  if auth.uid() is null then
    raise exception 'User belum login';
  end if;


  -- Ambil role user yang sedang login
  select
    p.role::text
  into
    v_current_role
  from public.profiles p
  where
    p.id = auth.uid()
    and p.is_active = true;


  if v_current_role is null then
    raise exception
      'Profile user tidak ditemukan / tidak aktif';
  end if;


  -- Hanya Owner dan Admin
  if v_current_role not in (
    'owner',
    'admin'
  ) then
    raise exception
      'Anda tidak memiliki akses ke Users Management';
  end if;


  return query

  select
    u.id as user_id,

    coalesce(
      u.email,
      ''
    )::text as email,

    coalesce(
      p.full_name,
      ''
    )::text as full_name,

    p.role::text as role,

    p.is_active,

    u.created_at,

    u.last_sign_in_at,

    count(*) over()::bigint
      as total_count

  from auth.users u

  join public.profiles p
    on p.id = u.id

  where
    coalesce(
      trim(p_search),
      ''
    ) = ''

    or coalesce(
      u.email,
      ''
    ) ilike
      '%' || trim(p_search) || '%'

    or coalesce(
      p.full_name,
      ''
    ) ilike
      '%' || trim(p_search) || '%'

    or p.role::text ilike
      '%' || trim(p_search) || '%'

  order by
    case
      when p.role::text = 'owner'
        then 1

      when p.role::text = 'admin'
        then 2

      when p.role::text = 'warehouse_manager'
        then 3

      when p.role::text = 'warehouse_staff'
        then 4

      else 5
    end,

    coalesce(
      p.full_name,
      u.email
    )

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

end;
$$;



-- ============================================================
-- 2. UPDATE WMS USER
--
-- Can update:
-- - Full Name
-- - Role
-- - Active / Inactive
--
-- Access:
-- OWNER / ADMIN only
--
-- Protection:
-- - Admin cannot modify Owner
-- - Admin cannot create Owner
-- - User cannot deactivate own account
-- ============================================================

create or replace function public.update_wms_user(
  p_user_id uuid,
  p_full_name text,
  p_role text,
  p_is_active boolean
)
returns table (
  user_id uuid,
  full_name text,
  role text,
  is_active boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_current_role text;
  v_target_role text;

  v_role_schema text;
  v_role_type text;

  v_name text;
  v_result_role text;
  v_result_active boolean;
begin

  -- User harus login
  if auth.uid() is null then
    raise exception 'User belum login';
  end if;


  -- Role user yang sedang login
  select
    p.role::text
  into
    v_current_role
  from public.profiles p
  where
    p.id = auth.uid()
    and p.is_active = true;


  if v_current_role is null then
    raise exception
      'Profile user tidak ditemukan / tidak aktif';
  end if;


  if v_current_role not in (
    'owner',
    'admin'
  ) then
    raise exception
      'Anda tidak memiliki akses mengelola user';
  end if;


  -- Ambil role target user
  select
    p.role::text
  into
    v_target_role
  from public.profiles p
  where
    p.id = p_user_id;


  if v_target_role is null then
    raise exception
      'User tidak ditemukan';
  end if;


  -- Validasi role baru
  if p_role not in (
    'owner',
    'admin',
    'warehouse_manager',
    'warehouse_staff',
    'viewer'
  ) then
    raise exception
      'Role tidak valid';
  end if;


  -- Admin tidak boleh mengubah Owner
  if
    v_current_role = 'admin'
    and v_target_role = 'owner'
  then
    raise exception
      'Admin tidak dapat mengubah account Owner';
  end if;


  -- Admin tidak boleh membuat Owner baru
  if
    v_current_role = 'admin'
    and p_role = 'owner'
  then
    raise exception
      'Hanya Owner yang dapat menetapkan role Owner';
  end if;


  -- User tidak boleh menonaktifkan dirinya sendiri
  if
    p_user_id = auth.uid()
    and p_is_active = false
  then
    raise exception
      'Anda tidak dapat menonaktifkan account sendiri';
  end if;


  -- Cari nama enum role dari database existing
  select
    tn.nspname,
    t.typname
  into
    v_role_schema,
    v_role_type

  from pg_attribute a

  join pg_class c
    on c.oid = a.attrelid

  join pg_namespace cn
    on cn.oid = c.relnamespace

  join pg_type t
    on t.oid = a.atttypid

  join pg_namespace tn
    on tn.oid = t.typnamespace

  where
    cn.nspname = 'public'
    and c.relname = 'profiles'
    and a.attname = 'role'
    and a.attnum > 0
    and not a.attisdropped

  limit 1;


  if
    v_role_schema is null
    or v_role_type is null
  then
    raise exception
      'Role enum tidak ditemukan';
  end if;


  -- Nama kosong disimpan sebagai NULL
  v_name = nullif(
    trim(
      coalesce(
        p_full_name,
        ''
      )
    ),
    ''
  );


  -- Update profile dengan dynamic enum cast
  execute format(
    '
      update public.profiles

      set
        full_name = $1,
        role = $2::%I.%I,
        is_active = $3,
        updated_at = now()

      where id = $4

      returning
        full_name,
        role::text,
        is_active
    ',
    v_role_schema,
    v_role_type
  )

  into
    v_name,
    v_result_role,
    v_result_active

  using
    v_name,
    p_role,
    p_is_active,
    p_user_id;


  return query

  select
    p_user_id,
    v_name,
    v_result_role,
    v_result_active;

end;
$$;



-- ============================================================
-- 3. FUNCTION PERMISSIONS
-- ============================================================

revoke all on function public.get_users_list(
  text,
  integer,
  integer
) from public;


revoke all on function public.update_wms_user(
  uuid,
  text,
  text,
  boolean
) from public;


grant execute on function public.get_users_list(
  text,
  integer,
  integer
) to authenticated;


grant execute on function public.update_wms_user(
  uuid,
  text,
  text,
  boolean
) to authenticated;



commit;


-- ============================================================
-- END OF MIGRATION
-- ============================================================