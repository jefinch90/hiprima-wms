-- Cycle Count variance investigation. Additive schema; no existing stock is changed.
-- Apply as one transaction through Supabase migration runner, never statement by statement.
-- Lock contention fails this migration instead of holding warehouse writes indefinitely.
set local lock_timeout = '10s';

alter table public.stock_opname_lines
  add column if not exists variance_reason_category text,
  add column if not exists investigation_notes text,
  add column if not exists reason_recorded_by uuid,
  add column if not exists reason_recorded_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_opname_lines'::regclass
      and conname = 'stock_opname_lines_reason_recorded_by_fkey'
  ) then
    alter table public.stock_opname_lines
      add constraint stock_opname_lines_reason_recorded_by_fkey
      foreign key (reason_recorded_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_opname_lines'::regclass
      and conname = 'stock_opname_reason_category_check'
  ) then
    alter table public.stock_opname_lines
      add constraint stock_opname_reason_category_check
      check (variance_reason_category is null or variance_reason_category in (
        'misplaced_stock', 'unrecorded_movement', 'damaged_or_lost',
        'receiving_error', 'picking_packing_error', 'other'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_opname_lines'::regclass
      and conname = 'stock_opname_investigation_notes_check'
  ) then
    alter table public.stock_opname_lines
      add constraint stock_opname_investigation_notes_check
      check (investigation_notes is null or char_length(investigation_notes) <= 1000);
  end if;
end;
$$;

-- A changed physical count makes the prior investigation stale.
create or replace function public.clear_stock_opname_stale_reason()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.counted_qty is distinct from new.counted_qty
     or old.recount_qty is distinct from new.recount_qty then
    new.variance_reason_category := null;
    new.investigation_notes := null;
    new.reason_recorded_by := null;
    new.reason_recorded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_opname_clear_stale_reason on public.stock_opname_lines;
create trigger stock_opname_clear_stale_reason
before update of counted_qty, recount_qty on public.stock_opname_lines
for each row execute function public.clear_stock_opname_stale_reason();

create or replace function public.save_cycle_count_variance_reason(
  p_line_id uuid,
  p_category text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
  v_type text;
  v_status text;
  v_category text := trim(coalesce(p_category, ''));
  v_notes text := trim(coalesce(p_notes, ''));
begin
  perform public.assert_wms_role(array[
    'owner', 'admin', 'warehouse_manager', 'warehouse_staff'
  ]::public.app_user_role[]);

  select s.id, s.opname_type, s.status
    into v_session_id, v_type, v_status
  from public.stock_opname_lines l
  join public.stock_opname_sessions s on s.id = l.session_id
  where l.id = p_line_id
  for update of s;

  if v_session_id is null then
    raise exception 'SKU Cycle Count tidak ditemukan';
  end if;
  if v_type <> 'cycle_count' or v_status not in ('draft', 'counting', 'review') then
    raise exception 'Alasan hanya dapat diubah pada Cycle Count aktif';
  end if;
  if v_category not in (
    'misplaced_stock', 'unrecorded_movement', 'damaged_or_lost',
    'receiving_error', 'picking_packing_error', 'other'
  ) then
    raise exception 'Kategori Alasan Selisih tidak valid';
  end if;
  if v_notes = '' or char_length(v_notes) > 1000 then
    raise exception 'Catatan Investigasi wajib diisi (maksimal 1000 karakter)';
  end if;

  update public.stock_opname_lines l
  set variance_reason_category = v_category,
      investigation_notes = v_notes,
      reason_recorded_by = auth.uid(),
      reason_recorded_at = now(),
      updated_at = now()
  where l.id = p_line_id
    and l.counted_qty is not null
    and l.recount_qty is not null
    and l.recount_qty <> l.system_qty;

  if not found then
    raise exception 'Alasan hanya dapat disimpan setelah Recount masih selisih';
  end if;
end;
$$;

-- Used by both the counting and review screens. The RPC locks no inventory.
create or replace function public.get_cycle_count_variance_status(p_session_id uuid)
returns table (pending_recount_lines bigint, pending_reason_lines bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_wms_role(array[
    'owner', 'admin', 'warehouse_manager', 'warehouse_staff', 'viewer'
  ]::public.app_user_role[]);

  return query
  select
    count(*) filter (where l.counted_qty is not null
      and l.counted_qty <> l.system_qty and l.recount_qty is null)::bigint,
    count(*) filter (where l.recount_qty is not null
      and l.recount_qty <> l.system_qty
      and (nullif(trim(l.variance_reason_category), '') is null
        or nullif(trim(l.investigation_notes), '') is null))::bigint
  from public.stock_opname_lines l
  join public.stock_opname_sessions s on s.id = l.session_id
  where s.id = p_session_id and s.opname_type = 'cycle_count';
end;
$$;

revoke all on function public.save_cycle_count_variance_reason(uuid, text, text) from public, anon;
grant execute on function public.save_cycle_count_variance_reason(uuid, text, text) to authenticated;
revoke all on function public.get_cycle_count_variance_status(uuid) from public, anon;
grant execute on function public.get_cycle_count_variance_status(uuid) to authenticated;

create or replace function public.get_cycle_count_line_reasons(p_line_ids uuid[])
returns table (line_id uuid, variance_reason_category text, investigation_notes text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_wms_role(array[
    'owner', 'admin', 'warehouse_manager', 'warehouse_staff', 'viewer'
  ]::public.app_user_role[]);

  return query
  select l.id, l.variance_reason_category, l.investigation_notes
  from public.stock_opname_lines l
  join public.stock_opname_sessions s on s.id = l.session_id
  where l.id = any(p_line_ids) and s.opname_type = 'cycle_count';
end;
$$;

revoke all on function public.get_cycle_count_line_reasons(uuid[]) from public, anon;
grant execute on function public.get_cycle_count_line_reasons(uuid[]) to authenticated;

create or replace function public.cycle_count_reason_label(p_category text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_category
    when 'misplaced_stock' then 'Stok salah lokasi'
    when 'unrecorded_movement' then 'Perpindahan belum tercatat'
    when 'damaged_or_lost' then 'Rusak atau hilang'
    when 'receiving_error' then 'Kesalahan penerimaan'
    when 'picking_packing_error' then 'Kesalahan picking/packing'
    when 'other' then 'Lainnya'
  end;
$$;

revoke all on function public.cycle_count_reason_label(text) from public, anon, authenticated;


-- STAFF MAY CREATE CYCLE COUNT, NOT FULL OPNAME
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
      'warehouse_manager',
      'warehouse_staff'
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

  if v_type = 'full' then
    perform public.assert_wms_role(array[
      'owner', 'admin', 'warehouse_manager'
    ]::public.app_user_role[]);
  end if;

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


-- COUNT REVALIDATES THE SESSION STATUS UNDER LOCK
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

    and (
      v_type <> 'cycle_count'
      or counted_qty <> system_qty
      or recount_qty is not null
    )

  returning
    stock_opname_lines.system_qty,
    stock_opname_lines.counted_qty
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


-- SUBMIT REQUIRES RECOUNT AND INVESTIGATION
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
  v_type text;
  v_pending_recount bigint;
  v_pending_reason bigint;

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
    s.session_code,
    s.opname_type

  into
    v_status,
    v_code,
    v_type

  from public.stock_opname_sessions s

  where
    s.id =
      p_session_id

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


  if v_type = 'cycle_count' then
    select x.pending_recount_lines, x.pending_reason_lines
      into v_pending_recount, v_pending_reason
    from public.get_cycle_count_variance_status(p_session_id) x;

    if v_pending_recount > 0 then
      raise exception 'Submit ditolak. Masih ada % SKU yang wajib Recount.', v_pending_recount;
    end if;
    if v_pending_reason > 0 then
      raise exception 'Submit ditolak. Masih ada % SKU tanpa Kategori Alasan Selisih atau Catatan Investigasi.', v_pending_reason;
    end if;
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


-- FINALIZE REVALIDATES AND AUDITS THE REASON
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
  v_pending_recount bigint;
  v_pending_reason bigint;

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


  if v_session.opname_type = 'cycle_count' then
    select x.pending_recount_lines, x.pending_reason_lines
      into v_pending_recount, v_pending_reason
    from public.get_cycle_count_variance_status(p_session_id) x;

    if v_pending_recount > 0 then
      raise exception 'Finalize ditolak. Masih ada % SKU yang wajib Recount.', v_pending_recount;
    end if;
    if v_pending_reason > 0 then
      raise exception 'Finalize ditolak. Masih ada % SKU tanpa Kategori Alasan Selisih atau Catatan Investigasi.', v_pending_reason;
    end if;
  end if;

  for r in

    select
      sol.variant_id,
      sol.location_id,
      sol.system_qty,
      sol.counted_qty,
      sol.recount_qty,
      sol.variance_reason_category,
      sol.investigation_notes,

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
          v_final_qty,
          case when v_session.opname_type = 'cycle_count' then
            concat(' | Kategori Alasan Selisih: ', public.cycle_count_reason_label(r.variance_reason_category),
                   ' | Catatan Investigasi: ', r.investigation_notes)
          else '' end
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
          v_final_qty,
          case when v_session.opname_type = 'cycle_count' then
            concat(' | Kategori Alasan Selisih: ', public.cycle_count_reason_label(r.variance_reason_category),
                   ' | Catatan Investigasi: ', r.investigation_notes)
          else '' end
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


-- Serialize adding an unexpected SKU with Submit Review.
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
  v_type text;
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


-- Staff may count Cycle Count, while Full remains manager-owned.
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
  v_type text;
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

-- Reassert the direct Finalize RPC remains inaccessible from clients.
revoke all on function public.finalize_stock_opname(uuid) from public, anon, authenticated;
