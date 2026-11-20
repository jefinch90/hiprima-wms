-- Hi.PRIMA WMS | Production Orders V3.2
-- Atomic, unique PO number for NEW purchase orders; bulk review import to DRAFT.
-- IMPORTANT: Run once in Supabase SQL Editor BEFORE installing frontend.
-- No stock changes, no FINAL PO creation, no edits to historical PO 20261027.
BEGIN;

CREATE OR REPLACE FUNCTION public.wms_po_create_auto(
  p_vendor_id uuid,
  p_order_date date,
  p_eta_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_prefix text;
  v_seq bigint;
  v_id uuid;
BEGIN
  PERFORM public.wms_po_require_role(false);
  IF p_order_date IS NULL THEN
    RAISE EXCEPTION 'Tanggal PO wajib diisi.';
  END IF;
  IF p_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Vendor PO wajib dipilih.';
  END IF;

  -- Serialize automatic number allocation for the same business date.
  -- This avoids identical auto numbers when users create Drafts concurrently.
  PERFORM pg_advisory_xact_lock(24071101, p_order_date - date '2000-01-01');
  v_prefix := 'PO-' || to_char(p_order_date, 'YYYYMMDD') || '-';

  SELECT COALESCE(MAX(substring(o.po_number FROM length(v_prefix) + 1)::bigint), 0) + 1
    INTO v_seq
  FROM public.wms_po_orders o
  WHERE o.po_number ~ ('^' || v_prefix || '[0-9]+$');

  IF v_seq > 999999999 THEN
    RAISE EXCEPTION 'Nomor urut PO pada tanggal ini sudah terlalu besar.';
  END IF;

  -- Reuse existing secured Draft creation RPC and its vendor / role checks.
  v_id := public.wms_po_create(
    v_prefix || lpad(v_seq::text,3,'0'),
    p_vendor_id,
    p_order_date,
    p_eta_date,
    p_notes
  );
  RETURN v_id;
END $$;

-- One transactional call for multiple USER-REVIEWED vendor/date groups.
-- Each selected group MUST be one real PO (confirmed by the user).
-- Existing wms_po_import_group creates DRAFT only and maps exact SKU matches.
-- Any failure rolls back ALL groups in the batch; no partial batch import.
CREATE OR REPLACE FUNCTION public.wms_po_import_bulk(p_groups jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_g jsonb;
  v_vendor_raw text;
  v_source_date date;
  v_vendor_id uuid;
  v_po_number text;
  v_key text;
  v_seen text[] := ARRAY[]::text[];
  v_total integer;
  v_pending integer;
  v_out jsonb;
  v_created integer := 0;
  v_lines integer := 0;
  v_unmapped integer := 0;
BEGIN
  PERFORM public.wms_po_require_role(false);
  IF p_groups IS NULL OR jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Daftar grup harus berupa array.';
  END IF;
  IF jsonb_array_length(p_groups) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Pilih minimal 1 dan maksimal 30 grup.';
  END IF;

  FOR v_g IN SELECT value FROM jsonb_array_elements(p_groups) AS t(value)
  LOOP
    IF jsonb_typeof(v_g) IS DISTINCT FROM 'object'
       OR v_g->>'confirmed' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Setiap grup wajib dikonfirmasi sebagai tepat satu PO historis.';
    END IF;

    v_vendor_raw := NULLIF(btrim(v_g->>'vendor_raw'), '');
    v_po_number := NULLIF(btrim(v_g->>'po_number'), '');
    IF v_vendor_raw IS NULL OR v_po_number IS NULL
       OR length(v_po_number) NOT BETWEEN 3 AND 80 THEN
      RAISE EXCEPTION 'Vendor sumber atau nomor PO historis tidak valid.';
    END IF;
    IF COALESCE(v_g->>'source_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Tanggal sumber grup tidak valid.';
    END IF;
    v_source_date := (v_g->>'source_date')::date;
    v_vendor_id := NULLIF(v_g->>'vendor_id','')::uuid;
    IF v_vendor_id IS NULL THEN
      RAISE EXCEPTION 'Vendor terverifikasi wajib dipilih untuk %.', v_vendor_raw;
    END IF;

    v_key := v_vendor_raw || '|' || to_char(v_source_date, 'YYYY-MM-DD');
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'Grup ganda: %.', v_key;
    END IF;
    v_seen := array_append(v_seen, v_key);

    -- Prevent splitting a partly imported group into a second unintended PO.
    SELECT COUNT(*), COUNT(*) FILTER (WHERE imported_po_id IS NULL)
      INTO v_total,v_pending
    FROM public.wms_po_excel_initial
    WHERE source_key='HIPRIMA-PO-20261030'
      AND vendor_raw=v_vendor_raw AND source_date=v_source_date;
    IF v_total=0 OR v_pending<>v_total THEN
      RAISE EXCEPTION 'Grup % sudah pernah dipindahkan/sebagian dipindahkan atau tidak ditemukan.', v_key;
    END IF;

    v_out := public.wms_po_import_group(
      v_vendor_raw,v_source_date,v_vendor_id,v_po_number
    );
    v_created := v_created + 1;
    v_lines := v_lines + (v_out->>'lines')::integer;
    v_unmapped := v_unmapped + (v_out->>'unmapped')::integer;
  END LOOP;

  RETURN jsonb_build_object('created_po',v_created,
    'created_lines',v_lines,'unmapped_lines',v_unmapped,
    'status','DRAFT_ONLY');
END $$;

REVOKE ALL ON FUNCTION public.wms_po_create_auto(uuid,date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wms_po_create_auto(uuid,date,date,text) TO authenticated;
REVOKE ALL ON FUNCTION public.wms_po_import_bulk(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wms_po_import_bulk(jsonb) TO authenticated;
COMMIT;

-- Read-only verification of RPC installation:
SELECT p.proname AS nama_fungsi,
       pg_get_function_identity_arguments(p.oid) AS parameter
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('wms_po_create_auto','wms_po_import_bulk')
ORDER BY p.proname;
