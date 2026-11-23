-- Hi.PRIMA WMS V4.3M — Inbound Multi-SKU / satu dokumen per vendor dan Surat Jalan.
-- DRAFT ONLY. JANGAN JALANKAN DI SUPABASE LIVE TANPA REVIEW DAN PERSETUJUAN OWNER.
-- Didesain untuk melindungi stok lama V4.3K/V4.3L dan tidak mengubah stok saat instalasi.
BEGIN;

-- Fail-closed: prasyarat WMS, fungsi legacy, dan pengaman Surat Jalan V4.3L harus ada.
DO $preflight$
DECLARE
  v_legacy oid;
  v_old_batch oid;
BEGIN
  IF to_regclass('public.wms_vendor_master') IS NULL
     OR to_regclass('public.product_variants') IS NULL
     OR to_regclass('public.wms_inbound_qc_batches') IS NULL THEN
    RAISE EXCEPTION 'STOP: Master vendor, SKU atau batch V4.3L belum ditemukan';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public'
    AND indexname='wms_inbound_qc_sku_sj_unique_v43l'
  ) THEN
    RAISE EXCEPTION 'STOP: Index perlindungan V4.3L tidak ditemukan';
  END IF;
  v_legacy := to_regprocedure('public.receive_inbound_stock(uuid,uuid,integer,text,text)');
  v_old_batch := to_regprocedure('public.wms_receive_inbound_qc_batch(uuid,uuid,integer,jsonb,text,text)');
  IF v_legacy IS NULL OR v_old_batch IS NULL THEN
    RAISE EXCEPTION 'STOP: RPC Inbound V4.3L tidak lengkap';
  END IF;
  IF (SELECT proowner FROM pg_proc WHERE oid=v_legacy) IS DISTINCT FROM
     (SELECT proowner FROM pg_proc WHERE oid=v_old_batch) THEN
    RAISE EXCEPTION 'STOP: Owner legacy berbeda dari RPC V4.3L';
  END IF;
  IF has_function_privilege('authenticated',v_legacy,'EXECUTE') THEN
    RAISE EXCEPTION 'STOP: RPC legacy masih bisa dipanggil langsung';
  END IF;
  IF to_regclass('public.wms_inbound_documents') IS NOT NULL OR
     to_regclass('public.wms_inbound_document_lines') IS NOT NULL OR
     to_regprocedure('public.wms_receive_inbound_document(uuid,uuid,text,date,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: Objek V4.3M sudah ada. Audit sebelum menjalankan ulang';
  END IF;
END;
$preflight$;

CREATE TABLE public.wms_inbound_documents (
  request_id uuid PRIMARY KEY,
  receipt_no text NOT NULL UNIQUE,
  vendor_id uuid NOT NULL REFERENCES public.wms_vendor_master(id) ON DELETE RESTRICT,
  sj_number text NOT NULL CHECK (btrim(sj_number) <> ''),
  sj_key text NOT NULL CHECK (btrim(sj_key) <> ''),
  received_date date NOT NULL,
  po_reference text,
  notes text,
  request_lines jsonb NOT NULL,
  result jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wms_inbound_documents_vendor_sj_key_key UNIQUE (vendor_id, sj_key)
);
ALTER TABLE public.wms_inbound_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wms_inbound_documents FROM PUBLIC, anon, authenticated;

CREATE TABLE public.wms_inbound_document_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_request_id uuid NOT NULL REFERENCES public.wms_inbound_documents(request_id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  total_qty integer NOT NULL CHECK(total_qty > 0),
  qc_items jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wms_inbound_doc_lines_unique_variant UNIQUE(document_request_id,variant_id)
);
ALTER TABLE public.wms_inbound_document_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wms_inbound_document_lines FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wms_inbound_multi_version()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$ SELECT 'V4.3M'::text; $$;
REVOKE ALL ON FUNCTION public.wms_inbound_multi_version() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wms_inbound_multi_version() TO authenticated;

CREATE OR REPLACE FUNCTION public.wms_inbound_multi_vendors()
RETURNS TABLE(id uuid, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p
  WHERE p.id=v_user AND p.is_active=true;
  IF coalesce(v_role,'') NOT IN ('owner','admin','warehouse_manager','warehouse_staff') THEN
    RAISE EXCEPTION 'Akses ditolak: role tidak berhak melihat vendor untuk Inbound';
  END IF;
  RETURN QUERY SELECT vm.id,
    COALESCE(
      nullif(btrim(to_jsonb(vm)->>'vendor_name'),''),
      nullif(btrim(to_jsonb(vm)->>'name'),''),
      nullif(btrim(to_jsonb(vm)->>'display_name'),''),
      vm.id::text
    ) AS name
  FROM public.wms_vendor_master vm
  WHERE vm.is_active=true
  ORDER BY 2,1;
END;
$$;
REVOKE ALL ON FUNCTION public.wms_inbound_multi_vendors() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wms_inbound_multi_vendors() TO authenticated;

CREATE OR REPLACE FUNCTION public.wms_receive_inbound_document(
  p_request_id uuid,
  p_vendor_id uuid,
  p_delivery_note text,
  p_received_date date,
  p_po_reference text,
  p_notes text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_sj text := nullif(btrim(p_delivery_note),'');
  v_sj_key text;
  v_po text := nullif(btrim(p_po_reference),'');
  v_notes text := nullif(btrim(p_notes),'');
  v_existing record;
  v_receipt text;
  v_line jsonb;
  v_qc_item jsonb;
  v_variant uuid;
  v_qty integer;
  v_line_expected integer;
  v_line_total bigint;
  v_doc_total bigint := 0;
  v_qc text;
  v_seen_qc text[];
  v_seen_variants uuid[] := ARRAY[]::uuid[];
  v_location uuid;
  v_area text;
  v_result_items jsonb;
  v_result_lines jsonb := '[]'::jsonb;
  v_item_count integer;
  v_move bigint;
  v_after integer;
  v_sku text;
  v_result jsonb;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p
  WHERE p.id=v_user AND p.is_active=true;
  IF coalesce(v_role,'') NOT IN ('owner','admin','warehouse_manager','warehouse_staff') THEN
    RAISE EXCEPTION 'Akses ditolak: pengguna tidak berhak menerima stok';
  END IF;
  IF p_request_id IS NULL OR p_vendor_id IS NULL OR p_received_date IS NULL
     OR v_sj IS NULL OR length(v_sj)>120 OR length(coalesce(v_po,''))>120
     OR length(coalesce(v_notes,''))>500 THEN
    RAISE EXCEPTION 'Dokumen Inbound tidak lengkap atau melebihi batas panjang';
  END IF;
  IF p_lines IS NULL OR coalesce(jsonb_typeof(p_lines),'') <> 'array' THEN
    RAISE EXCEPTION 'Daftar SKU harus array';
  END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Daftar SKU harus terdiri atas 1 sampai 200 SKU';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wms_vendor_master vm
                 WHERE vm.id=p_vendor_id AND vm.is_active=true) THEN
    RAISE EXCEPTION 'Vendor tidak tersedia atau tidak aktif';
  END IF;
  v_sj_key := upper(regexp_replace(v_sj,'\s+',' ','g'));

  -- Retry request yang sama harus menghasilkan balasan identik tanpa movement baru.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  SELECT * INTO v_existing FROM public.wms_inbound_documents
  WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.created_by IS DISTINCT FROM v_user
      OR v_existing.vendor_id IS DISTINCT FROM p_vendor_id
      OR v_existing.sj_key IS DISTINCT FROM v_sj_key
      OR v_existing.received_date IS DISTINCT FROM p_received_date
      OR v_existing.po_reference IS DISTINCT FROM v_po
      OR v_existing.notes IS DISTINCT FROM v_notes
      OR v_existing.request_lines IS DISTINCT FROM p_lines THEN
      RAISE EXCEPTION 'Request ID sudah dipakai untuk data berbeda';
    END IF;
    RETURN v_existing.result;
  END IF;

  -- Validasi seluruh SKU dan QC sebelum perubahan stok.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF coalesce(jsonb_typeof(v_line),'')<>'object' THEN
      RAISE EXCEPTION 'Format baris SKU tidak valid';
    END IF;
    BEGIN
      v_variant:=(v_line->>'variant_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'ID SKU tidak valid';
    END;
    IF v_variant IS NULL OR v_variant=ANY(v_seen_variants) THEN
      RAISE EXCEPTION 'SKU kosong atau muncul dua kali dalam satu Surat Jalan';
    END IF;
    v_seen_variants:=array_append(v_seen_variants,v_variant);
    IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id=v_variant) THEN
      RAISE EXCEPTION 'SKU tidak ditemukan';
    END IF;
    IF coalesce(jsonb_typeof(v_line->'total_qty'),'')<>'number'
       OR coalesce(v_line->>'total_qty','') !~ '^[1-9][0-9]{0,8}$' THEN
      RAISE EXCEPTION 'Jumlah SKU harus bilangan bulat positif';
    END IF;
    v_line_expected:=(v_line->>'total_qty')::integer;
    IF coalesce(jsonb_typeof(v_line->'items'),'')<>'array' THEN
      RAISE EXCEPTION 'QC SKU harus berupa array';
    END IF;
    v_item_count:=jsonb_array_length(v_line->'items');
    IF v_item_count NOT BETWEEN 1 AND 3 THEN
      RAISE EXCEPTION 'Setiap SKU wajib memiliki 1-3 kategori QC';
    END IF;
    v_seen_qc:=ARRAY[]::text[];
    v_line_total:=0;
    FOR v_qc_item IN SELECT value FROM jsonb_array_elements(v_line->'items') LOOP
      v_qc:=upper(coalesce(v_qc_item->>'qc',''));
      IF v_qc NOT IN ('NORMAL','DEFECT','REJECT') OR v_qc=ANY(v_seen_qc) THEN
        RAISE EXCEPTION 'Kategori QC tidak valid atau berulang';
      END IF;
      v_seen_qc:=array_append(v_seen_qc,v_qc);
      IF coalesce(jsonb_typeof(v_qc_item->'qty'),'')<>'number'
         OR coalesce(v_qc_item->>'qty','') !~ '^[1-9][0-9]{0,8}$' THEN
        RAISE EXCEPTION 'Jumlah QC wajib bilangan bulat positif';
      END IF;
      v_qty:=(v_qc_item->>'qty')::integer;
      v_line_total:=v_line_total+v_qty;
      BEGIN
        v_location:=(v_qc_item->>'location_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'ID lokasi QC tidak valid';
      END;
      IF v_location IS NULL THEN RAISE EXCEPTION 'Lokasi QC wajib'; END IF;
      SELECT upper(sa.code) INTO v_area
      FROM public.locations loc JOIN public.stock_areas sa ON sa.id=loc.area_id
      WHERE loc.id=v_location AND loc.is_active=true;
      IF v_area IS DISTINCT FROM v_qc THEN
        RAISE EXCEPTION 'Rak tujuan salah untuk area QC %',v_qc;
      END IF;
    END LOOP;
    IF v_line_total<>v_line_expected THEN
      RAISE EXCEPTION 'Total hasil QC (%) tidak sama dengan jumlah SKU (%)',v_line_total,v_line_expected;
    END IF;
    -- Data V4.3K/L tidak menyimpan vendor. Demi keamanan blokir SKU+SJ lama,
    -- termasuk bila vendor baru berbeda (data historis harus diklarifikasi Admin).
    IF EXISTS (
      SELECT 1 FROM public.wms_inbound_qc_batches b
      WHERE b.variant_id=v_variant
      AND upper(regexp_replace(btrim(coalesce(b.reference_no,'')),'\s+',' ','g'))=v_sj_key
    ) THEN
      RAISE EXCEPTION 'SKU % dan Surat Jalan % sudah tercatat melalui Inbound lama',v_variant,v_sj;
    END IF;
    v_doc_total:=v_doc_total+v_line_expected;
  END LOOP;

  v_receipt:='IND-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD')||'-'||upper(left(replace(p_request_id::text,'-',''),12));
  -- Unique (vendor_id,sj_key) dipasang sebelum movement; dua request bersamaan aman.
  INSERT INTO public.wms_inbound_documents(
    request_id,receipt_no,vendor_id,sj_number,sj_key,received_date,
    po_reference,notes,request_lines,result,created_by
  ) VALUES(
    p_request_id,v_receipt,p_vendor_id,v_sj,v_sj_key,p_received_date,
    v_po,v_notes,p_lines,'{}'::jsonb,v_user
  );

  -- Semua movement dalam transaksi database yang sama; satu error = semuanya rollback.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_variant:=(v_line->>'variant_id')::uuid;
    v_line_expected:=(v_line->>'total_qty')::integer;
    SELECT pv.sku INTO v_sku FROM public.product_variants pv WHERE pv.id=v_variant;
    v_result_items:='[]'::jsonb;
    FOR v_qc_item IN SELECT value FROM jsonb_array_elements(v_line->'items') LOOP
      v_qc:=upper(v_qc_item->>'qc');
      v_qty:=(v_qc_item->>'qty')::integer;
      v_location:=(v_qc_item->>'location_id')::uuid;
      v_move:=NULL;
      SELECT s.new_movement_no,s.destination_qty_after INTO v_move,v_after
      FROM public.receive_inbound_stock(
        v_variant,v_location,v_qty,v_sj,
        concat_ws(' | ',v_notes,'Dokumen Multi-SKU '||v_receipt,'Vendor '||p_vendor_id::text)
      ) s;
      IF v_move IS NULL THEN RAISE EXCEPTION 'Gagal membuat movement untuk SKU %, QC %',v_sku,v_qc; END IF;
      v_result_items:=v_result_items||jsonb_build_array(jsonb_build_object(
        'qc',v_qc,'qty',v_qty,'location_id',v_location,
        'movement_no',v_move,'destination_qty_after',v_after
      ));
    END LOOP;
    INSERT INTO public.wms_inbound_document_lines(
      document_request_id,variant_id,total_qty,qc_items,result
    ) VALUES(p_request_id,v_variant,v_line_expected,v_line->'items',v_result_items);
    v_result_lines:=v_result_lines||jsonb_build_array(jsonb_build_object(
      'variant_id',v_variant,'sku',v_sku,'total_qty',v_line_expected,'items',v_result_items
    ));
  END LOOP;

  v_result:=jsonb_build_object(
    'request_id',p_request_id,'receipt_no',v_receipt,'vendor_id',p_vendor_id,
    'sj_number',v_sj,'line_count',jsonb_array_length(p_lines),
    'total_qty',v_doc_total,'lines',v_result_lines
  );
  UPDATE public.wms_inbound_documents SET result=v_result WHERE request_id=p_request_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.wms_receive_inbound_document(uuid,uuid,text,date,text,text,jsonb)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wms_receive_inbound_document(uuid,uuid,text,date,text,text,jsonb)
  TO authenticated;

-- Titik cut-over: fungsi V4.3K satu-SKU dan legacy tidak boleh bypass dokumen multi.
REVOKE EXECUTE ON FUNCTION public.wms_receive_inbound_qc_batch(uuid,uuid,integer,jsonb,text,text)
  FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.receive_inbound_stock(uuid,uuid,integer,text,text)
  FROM PUBLIC,anon,authenticated;

DO $verify$
DECLARE
  v_legacy oid := to_regprocedure('public.receive_inbound_stock(uuid,uuid,integer,text,text)');
  v_batch oid := to_regprocedure('public.wms_receive_inbound_document(uuid,uuid,text,date,text,text,jsonb)');
BEGIN
  IF (SELECT proowner FROM pg_proc WHERE oid=v_legacy) IS DISTINCT FROM
     (SELECT proowner FROM pg_proc WHERE oid=v_batch) THEN
    RAISE EXCEPTION 'STOP: RPC Multi-SKU tidak memiliki owner sama dengan legacy';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid=v_batch) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STOP: RPC Multi-SKU harus SECURITY DEFINER';
  END IF;
  IF has_function_privilege('authenticated','public.wms_receive_inbound_qc_batch(uuid,uuid,integer,jsonb,text,text)','EXECUTE') OR
     has_function_privilege('authenticated',v_legacy,'EXECUTE') OR
     has_function_privilege('anon',v_batch,'EXECUTE') OR
     NOT has_function_privilege('authenticated',v_batch,'EXECUTE') THEN
    RAISE EXCEPTION 'STOP: Hak akses RPC Inbound tidak aman';
  END IF;
END;
$verify$;
COMMIT;
