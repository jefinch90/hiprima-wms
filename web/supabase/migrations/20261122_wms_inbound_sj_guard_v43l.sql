-- Hi.PRIMA WMS V4.3L - Surat Jalan Anti-Duplikasi
-- PERSIAPAN: jangan jalankan di database live tanpa review.
-- Satu SKU + satu nomor Surat Jalan hanya satu Inbound Gabungan.
BEGIN;

DO $check$
BEGIN
  IF to_regclass('public.wms_inbound_qc_batches') IS NULL THEN
    RAISE EXCEPTION 'V4.3K belum terpasang';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wms_inbound_qc_batches
    WHERE btrim(coalesce(reference_no, '')) <> ''
    GROUP BY
      variant_id,
      upper(regexp_replace(btrim(reference_no), '\s+', ' ', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'STOP: Duplikat SKU dan Surat Jalan sudah ada';
  END IF;
END;
$check$;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.wms_inbound_qc_batches'::regclass
      AND conname = 'wms_inbound_qc_sj_required_v43l'
  ) THEN
    ALTER TABLE public.wms_inbound_qc_batches
      ADD CONSTRAINT wms_inbound_qc_sj_required_v43l
      CHECK (btrim(coalesce(reference_no, '')) <> '')
      NOT VALID;
  END IF;
END;
$constraint$;

CREATE UNIQUE INDEX IF NOT EXISTS
  wms_inbound_qc_sku_sj_unique_v43l
ON public.wms_inbound_qc_batches (
  variant_id,
  upper(regexp_replace(btrim(reference_no), '\s+', ' ', 'g'))
)
WHERE btrim(coalesce(reference_no, '')) <> '';

-- V43L_LEGACY_RPC_LOCK
-- Pastikan fungsi QC Gabungan dan legacy mempunyai owner sama.
-- SECURITY DEFINER QC Gabungan tetap dapat memakai fungsi lama secara internal.
DO $v43l_guard$
DECLARE
  v_old oid;
  v_batch oid;
BEGIN
  v_old := to_regprocedure(
    'public.receive_inbound_stock(uuid,uuid,integer,text,text)'
  );
  v_batch := to_regprocedure(
    'public.wms_receive_inbound_qc_batch(uuid,uuid,integer,jsonb,text,text)'
  );

  IF v_old IS NULL OR v_batch IS NULL THEN
    RAISE EXCEPTION 'STOP: Fungsi Inbound V4.3K tidak lengkap';
  END IF;

  IF (SELECT proowner FROM pg_proc WHERE oid = v_old)
     IS DISTINCT FROM
     (SELECT proowner FROM pg_proc WHERE oid = v_batch) THEN
    RAISE EXCEPTION
      'STOP: Owner fungsi lama dan QC Gabungan berbeda. Perlu audit';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_batch)
     IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'STOP: Fungsi QC Gabungan bukan SECURITY DEFINER';
  END IF;
END;
$v43l_guard$;

-- Tutup jalur langsung dari browser/JWT authenticated.
-- Pemanggilan internal oleh fungsi QC Gabungan tetap menggunakan owner.
REVOKE EXECUTE ON FUNCTION
  public.receive_inbound_stock(uuid,uuid,integer,text,text)
FROM PUBLIC, anon, authenticated;

DO $v43l_verify$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.receive_inbound_stock(uuid,uuid,integer,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.receive_inbound_stock(uuid,uuid,integer,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'STOP: Fungsi legacy masih bisa dipanggil langsung';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.wms_receive_inbound_qc_batch(uuid,uuid,integer,jsonb,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'STOP: Fungsi QC Gabungan tidak dapat dipanggil staf';
  END IF;
END;
$v43l_verify$;
COMMIT;