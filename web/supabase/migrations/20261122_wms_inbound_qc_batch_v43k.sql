-- Hi.PRIMA WMS V4.3K - Inbound QC Gabungan
-- PERSIAPAN SAJA: jangan jalankan pada Supabase live tanpa persetujuan Owner.
-- Fungsi lama tetap utuh. Semua penambahan stok terjadi di SATU transaksi PostgreSQL.
-- Perlu audit hak akses fungsi inbound legacy sebelum Go Live seluruh staf.

begin;

create table if not exists public.wms_inbound_qc_batches (
  request_id uuid primary key,
  receipt_no text not null unique,
  variant_id uuid not null references public.product_variants(id),
  expected_qty integer not null check (expected_qty > 0),
  items_request jsonb not null,
  reference_no text,
  notes text,
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

alter table public.wms_inbound_qc_batches enable row level security;
revoke all on table public.wms_inbound_qc_batches from public, anon, authenticated;

create or replace function public.wms_inbound_qc_version()
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$ select 'V4.3K'::text; $$;

revoke all on function public.wms_inbound_qc_version() from public, anon;
grant execute on function public.wms_inbound_qc_version() to authenticated;

create or replace function public.wms_receive_inbound_qc_batch(
  p_request_id uuid,
  p_variant_id uuid,
  p_expected_qty integer,
  p_items jsonb,
  p_reference_no text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_original record;
  v_qc text;
  v_location_id uuid;
  v_qty integer;
  v_area text;
  v_total bigint := 0;
  v_seen text[] := array[]::text[];
  v_entry jsonb;
  v_items jsonb := '[]'::jsonb;
  v_receipt text;
  v_move bigint;
  v_after integer;
  v_result jsonb;
  v_reference text := nullif(btrim(p_reference_no), '');
  v_notes text := nullif(btrim(p_notes), '');
begin
  if v_user is null then
    raise exception 'Akses ditolak: login diperlukan';
  end if;

  select p.role::text into v_role
  from public.profiles p
  where p.id = v_user and p.is_active = true;
  if coalesce(v_role, '') not in ('owner','admin','warehouse_manager','warehouse_staff') then
    raise exception 'Akses ditolak: role tidak berhak menerima stok';
  end if;

  if p_request_id is null or p_variant_id is null or p_expected_qty is null or p_expected_qty <= 0 then
    raise exception 'ID transaksi, SKU, atau jumlah penerimaan tidak valid';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 3 then
    raise exception 'Hasil QC wajib berisi 1 sampai 3 kategori';
  end if;

  -- Serialisasi per request ID: retry/double-click tidak menggandakan stok.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_original
  from public.wms_inbound_qc_batches
  where request_id = p_request_id;
  if found then
    if v_original.created_by <> v_user
       or v_original.variant_id <> p_variant_id
       or v_original.expected_qty <> p_expected_qty
       or v_original.items_request <> p_items
       or v_original.reference_no is distinct from v_reference
       or v_original.notes is distinct from v_notes then
      raise exception 'ID transaksi pernah digunakan untuk data berbeda';
    end if;
    return v_original.result;
  end if;

  if not exists (select 1 from public.product_variants where id = p_variant_id) then
    raise exception 'SKU tidak ditemukan';
  end if;

  -- Validasi SEMUA kategori sebelum satu pun stok ditambahkan.
  for v_entry in select value from jsonb_array_elements(p_items) loop
    v_qc := upper(coalesce(v_entry->>'qc', ''));
    if v_qc not in ('NORMAL','DEFECT','REJECT') or v_qc = any(v_seen) then
      raise exception 'Kategori QC tidak valid atau duplikat';
    end if;
    v_seen := array_append(v_seen, v_qc);

    if jsonb_typeof(v_entry->'qty') <> 'number'
       or coalesce(v_entry->>'qty','') !~ '^[0-9]{1,9}$' then
      raise exception 'Jumlah QC harus bilangan bulat positif';
    end if;
    v_qty := (v_entry->>'qty')::integer;
    if v_qty <= 0 then raise exception 'Jumlah QC harus lebih dari nol'; end if;
    v_total := v_total + v_qty;

    begin
      v_location_id := (v_entry->>'location_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'ID rak QC tidak valid';
    end;
    if v_location_id is null then raise exception 'Lokasi QC belum dipilih'; end if;

    select upper(sa.code) into v_area
    from public.locations l
    join public.stock_areas sa on sa.id = l.area_id
    where l.id = v_location_id and l.is_active = true;
    if v_area is distinct from v_qc then
      raise exception 'Rak tujuan tidak sesuai area QC %', v_qc;
    end if;
  end loop;

  if v_total <> p_expected_qty then
    raise exception 'Total QC (%) tidak sama dengan jumlah diterima (%)', v_total, p_expected_qty;
  end if;

  v_receipt := 'IQC-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYYMMDD')
      || '-' || upper(left(replace(p_request_id::text, '-', ''), 12));

  -- Seluruh pemanggilan fungsi legacy di bawah adalah satu statement/transaction.
  -- Jika satu pemanggilan gagal, semua perubahan inventory dan movement rollback.
  for v_entry in select value from jsonb_array_elements(p_items) loop
    v_qc := upper(v_entry->>'qc');
    v_qty := (v_entry->>'qty')::integer;
    v_location_id := (v_entry->>'location_id')::uuid;

    select s.new_movement_no, s.destination_qty_after
      into v_move, v_after
    from public.receive_inbound_stock(
      p_variant_id,
      v_location_id,
      v_qty,
      v_reference,
      concat_ws(' | ', v_notes, 'Batch QC ' || v_receipt)
    ) s;

    if v_move is null then raise exception 'Pergerakan stok untuk % gagal tercatat', v_qc; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'qc', v_qc, 'qty', v_qty, 'location_id', v_location_id,
      'movement_no', v_move, 'destination_qty_after', v_after
    ));
  end loop;

  v_result := jsonb_build_object(
    'receipt_no', v_receipt,
    'request_id', p_request_id,
    'total_qty', p_expected_qty,
    'items', v_items
  );

  insert into public.wms_inbound_qc_batches (
    request_id, receipt_no, variant_id, expected_qty, items_request,
    reference_no, notes, result, created_by
  ) values (
    p_request_id, v_receipt, p_variant_id, p_expected_qty, p_items,
    v_reference, v_notes, v_result, v_user
  );

  return v_result;
end;
$$;

revoke all on function public.wms_receive_inbound_qc_batch(uuid,uuid,integer,jsonb,text,text)
from public, anon;
grant execute on function public.wms_receive_inbound_qc_batch(uuid,uuid,integer,jsonb,text,text)
to authenticated;

commit;