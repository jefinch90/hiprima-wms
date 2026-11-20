BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE
  v_missing text;
  v_expected record;
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.product_variants') IS NULL
     OR to_regclass('public.wms_vendor_master') IS NULL
     OR to_regclass('public.wms_vendor_product_parameters') IS NULL
     OR to_regclass('public.wms_vendor_product_candidates') IS NULL
     OR to_regclass('public.wms_vendor_variant_quotes') IS NULL
     OR to_regclass('public.wms_vendor_variant_quote_events') IS NULL
     OR to_regprocedure('public.wms_v43c_assert_role(text[])') IS NULL
     OR to_regprocedure('public.wms_v43c_review_vendor_quote(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Bulk quote migration requires the V4.3C vendor quote schema and role guard.';
  END IF;

  FOR v_expected IN
    SELECT * FROM (VALUES
      ('profiles','id'),('profiles','role'),('profiles','is_active'),
      ('products','id'),
      ('product_variants','id'),('product_variants','product_id'),
      ('product_variants','sku'),('product_variants','hpp'),
      ('product_variants','is_active'),
      ('wms_vendor_master','id'),('wms_vendor_master','vendor_name'),
      ('wms_vendor_master','is_active'),
      ('wms_vendor_product_parameters','id'),
      ('wms_vendor_product_parameters','vendor_id'),
      ('wms_vendor_product_candidates','parameter_id'),
      ('wms_vendor_product_candidates','candidate_master_id'),
      ('wms_vendor_product_candidates','vendor_name'),
      ('wms_vendor_product_candidates','review_status'),
      ('wms_vendor_product_candidates','master_match_count'),
      ('wms_vendor_variant_quotes','id'),('wms_vendor_variant_quotes','vendor_id'),
      ('wms_vendor_variant_quotes','variant_id'),('wms_vendor_variant_quotes','unit_price'),
      ('wms_vendor_variant_quotes','currency'),('wms_vendor_variant_quotes','source_type'),
      ('wms_vendor_variant_quotes','evidence_ref'),('wms_vendor_variant_quotes','valid_from'),
      ('wms_vendor_variant_quotes','valid_until'),('wms_vendor_variant_quotes','status'),
      ('wms_vendor_variant_quotes','created_by'),('wms_vendor_variant_quotes','verified_by'),
      ('wms_vendor_variant_quotes','verified_at'),
      ('wms_vendor_variant_quote_events','quote_id'),
      ('wms_vendor_variant_quote_events','action'),
      ('wms_vendor_variant_quote_events','actor_id')
    ) AS expected(table_name,column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public'
        AND c.table_name=v_expected.table_name
        AND c.column_name=v_expected.column_name
    ) THEN
      v_missing:=concat_ws(', ',v_missing,
        format('public.%I.%I',v_expected.table_name,v_expected.column_name));
    END IF;
  END LOOP;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Bulk quote migration preflight failed; missing columns: %.',v_missing;
  END IF;

  IF to_regclass('public.wms_vendor_quote_bulk_batches') IS NOT NULL
     OR to_regclass('public.wms_vendor_quote_bulk_batch_lines') IS NOT NULL
     OR to_regclass('public.wms_vendor_quote_bulk_batch_events') IS NOT NULL
     OR to_regprocedure('public.wms_v43c_initial_vendor_quote_candidates()') IS NOT NULL
     OR to_regprocedure('public.wms_v43c_preview_initial_vendor_quotes(integer,integer)') IS NOT NULL
     OR to_regprocedure('public.wms_v43c_create_initial_vendor_quote_batch(text)') IS NOT NULL
     OR to_regprocedure('public.wms_v43c_review_vendor_quote_batch(uuid,text,text)') IS NOT NULL
     OR to_regprocedure('public.wms_v43c_update_vendor_quote(uuid,uuid,numeric,text,text,timestamptz)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='wms_vendor_variant_quotes'
         AND column_name='bulk_batch_id'
     ) THEN
    RAISE EXCEPTION 'Bulk quote migration preflight failed; migration objects already exist.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.wms_vendor_variant_quotes
    WHERE status='PENDING'
    GROUP BY vendor_id,variant_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Bulk quote migration refuses duplicate pending vendor/SKU quotes; resolve them before applying.';
  END IF;
END;
$preflight$;

CREATE TABLE public.wms_vendor_quote_bulk_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
  evidence_ref text NOT NULL CHECK (
    length(btrim(evidence_ref)) BETWEEN 1 AND 400
    AND btrim(evidence_ref) !~* '^https?://'
  ),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_notes text,
  ready_count integer NOT NULL DEFAULT 0 CHECK (ready_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  ready_sku_count integer NOT NULL DEFAULT 0 CHECK (ready_sku_count >= 0),
  action_required_count integer NOT NULL DEFAULT 0 CHECK (action_required_count >= 0),
  CHECK (
    (status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('VERIFIED','REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE TABLE public.wms_vendor_quote_bulk_batch_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.wms_vendor_quote_bulk_batches(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  vendor_id uuid REFERENCES public.wms_vendor_master(id) ON DELETE RESTRICT,
  parameter_id uuid REFERENCES public.wms_vendor_product_parameters(id) ON DELETE RESTRICT,
  sku_snapshot text NOT NULL,
  vendor_name_snapshot text,
  hpp_master_snapshot numeric,
  proposed_vendor_price numeric(14,2),
  readiness text NOT NULL CHECK (
    readiness IN (
      'READY','ALREADY_ACTIVE','PENDING','NO_MAPPING','AMBIGUOUS_MAPPING',
      'UNVERIFIED_MAPPING','INVALID_MAPPING','INVALID_HPP'
    )
  ),
  outcome text NOT NULL CHECK (outcome IN ('READY','SKIPPED','PENDING','VERIFIED','REJECTED')),
  reason text NOT NULL,
  quote_id uuid UNIQUE REFERENCES public.wms_vendor_variant_quotes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (outcome IN ('READY','SKIPPED') AND quote_id IS NULL)
    OR (outcome IN ('PENDING','VERIFIED','REJECTED') AND quote_id IS NOT NULL)
  )
);
CREATE INDEX wms_vendor_quote_bulk_lines_batch_idx
  ON public.wms_vendor_quote_bulk_batch_lines(batch_id,outcome,sku_snapshot);

CREATE TABLE public.wms_vendor_quote_bulk_batch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.wms_vendor_quote_bulk_batches(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATED','VERIFIED','REJECTED')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wms_vendor_quote_bulk_events_batch_idx
  ON public.wms_vendor_quote_bulk_batch_events(batch_id,created_at);

ALTER TABLE public.wms_vendor_variant_quotes
  ADD COLUMN bulk_batch_id uuid
  REFERENCES public.wms_vendor_quote_bulk_batches(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX wms_v43c_one_pending_quote_per_vendor_sku
  ON public.wms_vendor_variant_quotes(vendor_id,variant_id)
  WHERE status='PENDING';

ALTER TABLE public.wms_vendor_quote_bulk_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_vendor_quote_bulk_batch_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_vendor_quote_bulk_batch_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wms_vendor_quote_bulk_batches,
  public.wms_vendor_quote_bulk_batch_lines,
  public.wms_vendor_quote_bulk_batch_events
FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wms_vendor_quote_bulk_batches,
  public.wms_vendor_quote_bulk_batch_lines,
  public.wms_vendor_quote_bulk_batch_events
TO authenticated;

CREATE POLICY wms_vendor_quote_bulk_batches_v43c_read
  ON public.wms_vendor_quote_bulk_batches FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active AND p.role IN ('owner','admin')
  ));
CREATE POLICY wms_vendor_quote_bulk_lines_v43c_read
  ON public.wms_vendor_quote_bulk_batch_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active AND p.role IN ('owner','admin')
  ));
CREATE POLICY wms_vendor_quote_bulk_events_v43c_read
  ON public.wms_vendor_quote_bulk_batch_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active AND p.role IN ('owner','admin')
  ));

CREATE OR REPLACE FUNCTION public.wms_v43c_initial_vendor_quote_candidates()
RETURNS TABLE(
  variant_id uuid,
  sku text,
  vendor_id uuid,
  vendor_name text,
  parameter_id uuid,
  hpp_master numeric,
  proposed_vendor_price numeric,
  current_verified_price numeric,
  readiness text,
  reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
  WITH active_skus AS (
    SELECT pv.id AS variant_id,pv.sku,pv.product_id,pv.hpp
    FROM public.product_variants pv
    JOIN public.products prod ON prod.id=pv.product_id
    WHERE pv.is_active
  ),
  vendor_names AS (
    SELECT upper(btrim(vm.vendor_name)) AS normalized_name,
      count(*)::integer AS vendor_count,
      (array_agg(vm.id))[1] AS vendor_id,
      (array_agg(vm.vendor_name))[1] AS resolved_name,
      bool_and(vm.is_active) AS is_active
    FROM public.wms_vendor_master vm
    GROUP BY upper(btrim(vm.vendor_name))
  ),
  candidate_maps AS (
    SELECT s.variant_id,s.sku,s.product_id,s.hpp,
      c.parameter_id,c.vendor_name AS mapped_name,c.review_status,
      c.master_match_count,n.vendor_count,n.vendor_id,
      n.resolved_name,n.is_active AS vendor_active,p.vendor_id AS parameter_vendor_id,
      count(*) OVER (
        PARTITION BY s.variant_id,upper(btrim(c.vendor_name))
      ) AS mapping_count
    FROM active_skus s
    JOIN public.wms_vendor_product_candidates c
      ON c.candidate_master_id=s.product_id::text
    LEFT JOIN vendor_names n
      ON n.normalized_name=upper(btrim(c.vendor_name))
    LEFT JOIN public.wms_vendor_product_parameters p
      ON p.id=c.parameter_id
  ),
  mapped_rows AS (
    SELECT c.variant_id,c.sku,
      CASE WHEN c.vendor_count=1 THEN c.vendor_id END AS vendor_id,
      CASE WHEN c.vendor_count=1 THEN c.resolved_name ELSE c.mapped_name END AS vendor_name,
      c.parameter_id,      c.hpp AS hpp_master,round(c.hpp::numeric,2) AS proposed_vendor_price,
      current_quote.unit_price AS current_verified_price,
      CASE
        WHEN c.vendor_count IS DISTINCT FROM 1
          OR c.master_match_count IS DISTINCT FROM 1
          OR c.mapping_count<>1 THEN 'AMBIGUOUS_MAPPING'
        WHEN c.review_status IS DISTINCT FROM 'VERIFIED' THEN 'UNVERIFIED_MAPPING'
        WHEN c.vendor_active IS DISTINCT FROM true
          OR c.parameter_vendor_id IS DISTINCT FROM c.vendor_id THEN 'INVALID_MAPPING'
        WHEN c.hpp IS NULL OR c.hpp<=0 THEN 'INVALID_HPP'
        WHEN current_quote.id IS NOT NULL THEN 'ALREADY_ACTIVE'
        WHEN pending_quote.id IS NOT NULL THEN 'PENDING'
        ELSE 'READY'
      END AS readiness,
      CASE
        WHEN c.vendor_count IS DISTINCT FROM 1
          OR c.master_match_count IS DISTINCT FROM 1
          OR c.mapping_count<>1 THEN 'Mapping vendor/SKU tidak unik.'
        WHEN c.review_status IS DISTINCT FROM 'VERIFIED' THEN 'Mapping vendor belum diverifikasi.'
        WHEN c.vendor_active IS DISTINCT FROM true
          OR c.parameter_vendor_id IS DISTINCT FROM c.vendor_id THEN 'Vendor atau parameter tidak aktif/tidak cocok.'
        WHEN c.hpp IS NULL OR c.hpp<=0 THEN 'HPP Master kosong atau tidak valid.'
        WHEN current_quote.id IS NOT NULL THEN 'Harga vendor terverifikasi sudah tersedia.'
        WHEN pending_quote.id IS NOT NULL THEN 'Quote masih menunggu pemeriksa.'
        ELSE 'Siap dibuat sebagai quote PENDING.'
      END AS reason
    FROM candidate_maps c
    LEFT JOIN LATERAL (
      SELECT q.id,q.unit_price FROM public.wms_vendor_variant_quotes q
      WHERE q.vendor_id=c.vendor_id AND q.variant_id=c.variant_id
        AND q.status='VERIFIED' AND q.valid_from<=now()
        AND (q.valid_until IS NULL OR q.valid_until>now())
      ORDER BY q.verified_at DESC LIMIT 1
    ) current_quote ON true
    LEFT JOIN LATERAL (
      SELECT q.id FROM public.wms_vendor_variant_quotes q
      WHERE q.vendor_id=c.vendor_id AND q.variant_id=c.variant_id
        AND q.status='PENDING'
      LIMIT 1
    ) pending_quote ON true
  ),
  unmapped_rows AS (
    SELECT s.variant_id,s.sku,NULL::uuid AS vendor_id,NULL::text AS vendor_name,
      NULL::uuid AS parameter_id,s.hpp AS hpp_master,
      round(s.hpp::numeric,2) AS proposed_vendor_price,
      NULL::numeric AS current_verified_price,'NO_MAPPING'::text AS readiness,
      'SKU belum memiliki mapping vendor.'::text AS reason
    FROM active_skus s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.wms_vendor_product_candidates c
      WHERE c.candidate_master_id=s.product_id::text
    )
  )
  SELECT * FROM mapped_rows
  UNION ALL
  SELECT * FROM unmapped_rows
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_preview_initial_vendor_quotes(
  p_limit integer DEFAULT 50,p_offset integer DEFAULT 0
)
RETURNS TABLE(
  variant_id uuid,
  sku text,
  vendor_id uuid,
  vendor_name text,
  parameter_id uuid,
  hpp_master numeric,
  proposed_vendor_price numeric,
  current_verified_price numeric,
  readiness text,
  reason text,
  total_rows bigint,
  ready_mapping_count bigint,
  ready_sku_count bigint,
  skipped_count bigint,
  action_required_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR p_offset IS NULL OR p_offset<0 THEN
    RAISE EXCEPTION 'Preview page size or offset is invalid.';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT * FROM public.wms_v43c_initial_vendor_quote_candidates()
  ),
  summary AS (
    SELECT count(*) AS total_rows,
      count(*) FILTER (WHERE readiness='READY') AS ready_mapping_count,
      count(DISTINCT variant_id) FILTER (WHERE readiness='READY') AS ready_sku_count,
      count(*) FILTER (WHERE readiness<>'READY') AS skipped_count,
      count(*) FILTER (WHERE readiness NOT IN ('READY','ALREADY_ACTIVE')) AS action_required_count
    FROM candidates
  )
  SELECT c.variant_id,c.sku,c.vendor_id,c.vendor_name,c.parameter_id,
    c.hpp_master,c.proposed_vendor_price,c.current_verified_price,c.readiness,c.reason,
    s.total_rows,s.ready_mapping_count,s.ready_sku_count,s.skipped_count,s.action_required_count
  FROM candidates c CROSS JOIN summary s
  ORDER BY c.vendor_name NULLS FIRST,c.sku,c.variant_id,c.readiness
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_create_initial_vendor_quote_batch(
  p_evidence_ref text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_batch_id uuid;
  v_created integer;
  v_skipped integer;
  v_ready_skus integer;
  v_action_required integer;
  v_linked integer;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 1 AND 400
     OR btrim(p_evidence_ref) ~* '^https?://' THEN
    RAISE EXCEPTION 'Bukti konfirmasi wajib diisi; URL publik tidak diperbolehkan.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_v43c_initial_vendor_quote_candidates()
    WHERE readiness='READY'
  ) THEN
    RAISE EXCEPTION 'Tidak ada pasangan SKU/vendor yang siap dikonfirmasi.';
  END IF;
  INSERT INTO public.wms_vendor_quote_bulk_batches(evidence_ref,created_by)
  VALUES(btrim(p_evidence_ref),auth.uid())
  RETURNING id INTO v_batch_id;

  INSERT INTO public.wms_vendor_quote_bulk_batch_lines(
    batch_id,variant_id,vendor_id,parameter_id,sku_snapshot,vendor_name_snapshot,
    hpp_master_snapshot,proposed_vendor_price,readiness,outcome,reason
  )
  SELECT v_batch_id,c.variant_id,c.vendor_id,c.parameter_id,c.sku,c.vendor_name,
    c.hpp_master,c.proposed_vendor_price,c.readiness,
    CASE WHEN c.readiness='READY' THEN 'READY' ELSE 'SKIPPED' END,
    c.reason
  FROM public.wms_v43c_initial_vendor_quote_candidates() c;

  SELECT count(*) INTO v_action_required
  FROM public.wms_vendor_quote_bulk_batch_lines
  WHERE batch_id=v_batch_id AND readiness NOT IN ('READY','ALREADY_ACTIVE');
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_vendor_quote_bulk_batch_lines
    WHERE batch_id=v_batch_id AND outcome='READY'
  ) THEN
    RAISE EXCEPTION 'Tidak ada pasangan SKU/vendor yang siap setelah pratinjau dimuat ulang.';
  END IF;

  INSERT INTO public.wms_vendor_variant_quotes(
    vendor_id,variant_id,unit_price,currency,source_type,evidence_ref,
    created_by,bulk_batch_id
  )
  SELECT l.vendor_id,l.variant_id,l.proposed_vendor_price,'IDR','OTHER',
    b.evidence_ref,auth.uid(),v_batch_id
  FROM public.wms_vendor_quote_bulk_batch_lines l
  JOIN public.wms_vendor_quote_bulk_batches b ON b.id=l.batch_id
  WHERE l.batch_id=v_batch_id AND l.outcome='READY';
  GET DIAGNOSTICS v_created=ROW_COUNT;

  UPDATE public.wms_vendor_quote_bulk_batch_lines l
  SET quote_id=q.id,outcome='PENDING',
      reason='Quote PENDING; menunggu verifikasi Owner/Admin lain.'
  FROM public.wms_vendor_variant_quotes q
  WHERE l.batch_id=v_batch_id AND l.outcome='READY'
    AND q.bulk_batch_id=v_batch_id AND q.vendor_id=l.vendor_id
    AND q.variant_id=l.variant_id AND q.created_by=auth.uid()
    AND q.status='PENDING';
  GET DIAGNOSTICS v_linked=ROW_COUNT;
  IF v_linked<>v_created THEN
    RAISE EXCEPTION 'Quote tidak dapat ditautkan utuh ke batch; transaksi dibatalkan.';
  END IF;

  INSERT INTO public.wms_vendor_variant_quote_events(quote_id,action,actor_id,notes)
  SELECT l.quote_id,'CREATED',auth.uid(),
    'Batch konfirmasi harga awal '||v_batch_id::text
  FROM public.wms_vendor_quote_bulk_batch_lines l
  WHERE l.batch_id=v_batch_id AND l.outcome='PENDING';

  SELECT count(*) FILTER (WHERE outcome='SKIPPED'),
    count(DISTINCT variant_id) FILTER (WHERE outcome='PENDING')
  INTO v_skipped,v_ready_skus
  FROM public.wms_vendor_quote_bulk_batch_lines
  WHERE batch_id=v_batch_id;
  UPDATE public.wms_vendor_quote_bulk_batches
  SET ready_count=v_created,skipped_count=v_skipped,ready_sku_count=v_ready_skus,
      action_required_count=v_action_required
  WHERE id=v_batch_id;
  INSERT INTO public.wms_vendor_quote_bulk_batch_events(batch_id,action,actor_id,notes)
  VALUES(v_batch_id,'CREATED',auth.uid(),btrim(p_evidence_ref));

  RETURN jsonb_build_object(
    'batch_id',v_batch_id,
    'created_count',v_created,
    'skipped_count',v_skipped,
    'ready_sku_count',v_ready_skus,
    'action_required_count',v_action_required
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Batch dibatalkan karena quote PENDING sudah dibuat untuk vendor/SKU. Muat ulang pratinjau.';
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_review_vendor_quote_batch(
  p_batch_id uuid,p_decision text,p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_batch public.wms_vendor_quote_bulk_batches%ROWTYPE;
  v_line record;
  v_mapping_count integer;
  v_processed integer:=0;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF p_decision IS NULL OR p_decision NOT IN ('VERIFIED','REJECTED') THEN
    RAISE EXCEPTION 'Keputusan batch harus VERIFIED atau REJECTED.';
  END IF;
  IF p_decision='REJECTED' AND length(btrim(coalesce(p_notes,'')))=0 THEN
    RAISE EXCEPTION 'Alasan penolakan batch wajib diisi.';
  END IF;

  SELECT * INTO v_batch
  FROM public.wms_vendor_quote_bulk_batches
  WHERE id=p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL OR v_batch.status<>'PENDING' THEN
    RAISE EXCEPTION 'Hanya batch PENDING yang dapat diperiksa.';
  END IF;
  IF v_batch.created_by=auth.uid() THEN
    RAISE EXCEPTION 'Pembuat batch tidak dapat memverifikasi atau menolaknya.';
  END IF;

  FOR v_line IN
    SELECT l.*,q.status AS quote_status,q.created_by AS quote_creator,
      q.unit_price AS quote_price,q.currency AS quote_currency,
      q.bulk_batch_id AS quote_batch_id,q.valid_until AS quote_valid_until,
      pv.product_id,pv.hpp AS current_hpp,pv.is_active AS variant_active,
      vm.vendor_name,vm.is_active AS vendor_active
    FROM public.wms_vendor_quote_bulk_batch_lines l
    JOIN public.wms_vendor_variant_quotes q ON q.id=l.quote_id
    JOIN public.product_variants pv ON pv.id=l.variant_id
    JOIN public.wms_vendor_master vm ON vm.id=l.vendor_id
    WHERE l.batch_id=p_batch_id AND l.outcome='PENDING'
    ORDER BY l.sku_snapshot,l.vendor_name_snapshot
    FOR UPDATE OF q
  LOOP
    IF v_line.quote_status IS DISTINCT FROM 'PENDING'
       OR v_line.quote_creator IS DISTINCT FROM v_batch.created_by
       OR v_line.quote_creator=auth.uid()
       OR v_line.quote_batch_id IS DISTINCT FROM p_batch_id
       OR v_line.quote_currency IS DISTINCT FROM 'IDR'
       OR v_line.quote_price IS DISTINCT FROM v_line.proposed_vendor_price
       OR v_line.proposed_vendor_price IS DISTINCT FROM round(v_line.hpp_master_snapshot,2) THEN
      RAISE EXCEPTION 'SKU % berubah atau quote batch tidak lagi valid; seluruh batch tetap PENDING.',
        v_line.sku_snapshot;
    END IF;

    IF p_decision='VERIFIED' THEN
      IF v_line.current_hpp IS DISTINCT FROM v_line.hpp_master_snapshot
         OR v_line.variant_active IS DISTINCT FROM true
         OR v_line.vendor_active IS DISTINCT FROM true
         OR (v_line.quote_valid_until IS NOT NULL AND v_line.quote_valid_until<=now()) THEN
        RAISE EXCEPTION 'SKU % berubah atau quote batch tidak lagi valid; seluruh batch tetap PENDING.',
          v_line.sku_snapshot;
      END IF;
      SELECT count(*) INTO v_mapping_count
      FROM public.wms_vendor_product_candidates c
      JOIN public.wms_vendor_product_parameters p ON p.id=c.parameter_id
      WHERE c.candidate_master_id=v_line.product_id::text
        AND c.parameter_id=v_line.parameter_id
        AND c.review_status='VERIFIED' AND c.master_match_count=1
        AND upper(btrim(c.vendor_name))=upper(btrim(v_line.vendor_name))
        AND p.vendor_id=v_line.vendor_id
        AND (
          SELECT count(*) FROM public.wms_vendor_product_candidates c2
          WHERE c2.candidate_master_id=v_line.product_id::text
            AND upper(btrim(c2.vendor_name))=upper(btrim(v_line.vendor_name))
        )=1
        AND (
          SELECT count(*) FROM public.wms_vendor_master vm2
          WHERE upper(btrim(vm2.vendor_name))=upper(btrim(v_line.vendor_name))
        )=1;
      IF v_mapping_count<>1 THEN
        RAISE EXCEPTION 'Mapping vendor untuk SKU % tidak lagi valid atau unik; batch tetap PENDING.',
          v_line.sku_snapshot;
      END IF;
    END IF;

    UPDATE public.wms_vendor_variant_quotes
    SET status=p_decision,
      verified_by=CASE WHEN p_decision='VERIFIED' THEN auth.uid() END,
      verified_at=CASE WHEN p_decision='VERIFIED' THEN now() END
    WHERE id=v_line.quote_id AND status='PENDING';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quote SKU % telah berubah; batch dibatalkan.',v_line.sku_snapshot;
    END IF;
    INSERT INTO public.wms_vendor_variant_quote_events(quote_id,action,actor_id,notes)
    VALUES(v_line.quote_id,p_decision,auth.uid(),nullif(btrim(p_notes), ''));
    UPDATE public.wms_vendor_quote_bulk_batch_lines
    SET outcome=p_decision,
      reason=CASE WHEN p_decision='VERIFIED'
        THEN 'Harga awal diverifikasi.' ELSE btrim(p_notes) END
    WHERE id=v_line.id AND outcome='PENDING';
    v_processed:=v_processed+1;
  END LOOP;

  IF v_processed=0 OR v_processed<>v_batch.ready_count THEN
    RAISE EXCEPTION 'Jumlah quote batch tidak sesuai; tidak ada keputusan yang disimpan.';
  END IF;
  UPDATE public.wms_vendor_quote_bulk_batches
  SET status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),
      review_notes=nullif(btrim(p_notes),'')
  WHERE id=p_batch_id AND status='PENDING';
  INSERT INTO public.wms_vendor_quote_bulk_batch_events(batch_id,action,actor_id,notes)
  VALUES(p_batch_id,p_decision,auth.uid(),nullif(btrim(p_notes),''));

  RETURN jsonb_build_object(
    'batch_id',p_batch_id,
    'decision',p_decision,
    'processed_count',v_processed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_update_vendor_quote(
  p_vendor_id uuid,p_variant_id uuid,p_unit_price numeric,
  p_source_type text,p_evidence_ref text,p_valid_until timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_product_id uuid;
  v_vendor_name text;
  v_mapping_count integer;
  v_quote_id uuid;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF p_unit_price IS NULL OR p_unit_price<=0
     OR p_source_type IS NULL
     OR p_source_type NOT IN ('DOCUMENT','EMAIL','PORTAL','OTHER')
     OR length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 1 AND 400
     OR btrim(p_evidence_ref) ~* '^https?://' THEN
    RAISE EXCEPTION 'Harga, sumber, atau bukti harga vendor tidak valid.';
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until<=now() THEN
    RAISE EXCEPTION 'Masa berlaku harga harus di masa depan.';
  END IF;
  SELECT pv.product_id,vm.vendor_name
  INTO v_product_id,v_vendor_name
  FROM public.product_variants pv
  JOIN public.wms_vendor_master vm ON vm.id=p_vendor_id
  WHERE pv.id=p_variant_id AND pv.is_active AND vm.is_active;
  IF v_product_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.wms_vendor_variant_quotes q
    WHERE q.vendor_id=p_vendor_id AND q.variant_id=p_variant_id
      AND q.status='VERIFIED'
  ) THEN
    RAISE EXCEPTION 'Pembaruan hanya tersedia untuk SKU/vendor aktif dengan harga terverifikasi sebelumnya.';
  END IF;

  SELECT count(*) INTO v_mapping_count
  FROM public.wms_vendor_product_candidates c
  JOIN public.wms_vendor_product_parameters p ON p.id=c.parameter_id
  WHERE c.candidate_master_id=v_product_id::text
    AND c.review_status='VERIFIED' AND c.master_match_count=1
    AND upper(btrim(c.vendor_name))=upper(btrim(v_vendor_name))
    AND p.vendor_id=p_vendor_id
    AND (
      SELECT count(*) FROM public.wms_vendor_product_candidates c2
      WHERE c2.candidate_master_id=v_product_id::text
        AND upper(btrim(c2.vendor_name))=upper(btrim(v_vendor_name))
    )=1
    AND (
      SELECT count(*) FROM public.wms_vendor_master vm2
      WHERE upper(btrim(vm2.vendor_name))=upper(btrim(v_vendor_name))
    )=1;
  IF v_mapping_count<>1 THEN
    RAISE EXCEPTION 'Mapping vendor untuk SKU ini tidak valid atau tidak unik.';
  END IF;

  INSERT INTO public.wms_vendor_variant_quotes(
    vendor_id,variant_id,unit_price,currency,source_type,evidence_ref,
    valid_until,created_by
  ) VALUES(
    p_vendor_id,p_variant_id,p_unit_price,'IDR',p_source_type,
    btrim(p_evidence_ref),p_valid_until,auth.uid()
  ) RETURNING id INTO v_quote_id;
  INSERT INTO public.wms_vendor_variant_quote_events(quote_id,action,actor_id,notes)
  VALUES(v_quote_id,'CREATED',auth.uid(),'Pembaruan harga; quote sebelumnya dipertahankan.');
  RETURN v_quote_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Masih ada perubahan harga PENDING untuk vendor/SKU ini.';
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_review_vendor_quote(
  p_quote_id uuid,p_decision text,p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_quote public.wms_vendor_variant_quotes%ROWTYPE;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF p_decision IS NULL OR p_decision NOT IN ('VERIFIED','REJECTED') THEN
    RAISE EXCEPTION 'Quote decision must be VERIFIED or REJECTED.';
  END IF;
  SELECT * INTO v_quote FROM public.wms_vendor_variant_quotes
  WHERE id=p_quote_id FOR UPDATE;
  IF v_quote.id IS NULL OR v_quote.status<>'PENDING' THEN
    RAISE EXCEPTION 'Only pending vendor quotes can be reviewed.';
  END IF;
  IF v_quote.bulk_batch_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quote batch harus diputuskan melalui verifikasi batch.';
  END IF;
  IF v_quote.created_by=auth.uid() THEN
    RAISE EXCEPTION 'Quote creator cannot verify or reject their own quote.';
  END IF;
  IF p_decision='VERIFIED' THEN
    IF v_quote.valid_until IS NOT NULL AND v_quote.valid_until<=now() THEN
      RAISE EXCEPTION 'Expired vendor quote cannot be verified.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wms_vendor_master WHERE id=v_quote.vendor_id AND is_active)
       OR NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id=v_quote.variant_id AND is_active) THEN
      RAISE EXCEPTION 'Inactive vendor or SKU cannot be verified.';
    END IF;
  ELSIF length(btrim(coalesce(p_notes,'')))=0 THEN
    RAISE EXCEPTION 'A reason is required to reject a quote.';
  END IF;
  UPDATE public.wms_vendor_variant_quotes
  SET status=p_decision,verified_by=CASE WHEN p_decision='VERIFIED' THEN auth.uid() END,
      verified_at=CASE WHEN p_decision='VERIFIED' THEN now() END
  WHERE id=p_quote_id;
  INSERT INTO public.wms_vendor_variant_quote_events(quote_id,action,actor_id,notes)
  VALUES(p_quote_id,p_decision,auth.uid(),nullif(btrim(p_notes),''));
END;
$$;

REVOKE ALL ON FUNCTION public.wms_v43c_initial_vendor_quote_candidates(),
  public.wms_v43c_preview_initial_vendor_quotes(integer,integer),
  public.wms_v43c_create_initial_vendor_quote_batch(text),
  public.wms_v43c_review_vendor_quote_batch(uuid,text,text),
  public.wms_v43c_update_vendor_quote(uuid,uuid,numeric,text,text,timestamptz),
  public.wms_v43c_review_vendor_quote(uuid,text,text)
FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.wms_v43c_initial_vendor_quote_candidates()
FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wms_v43c_preview_initial_vendor_quotes(integer,integer),
  public.wms_v43c_create_initial_vendor_quote_batch(text),
  public.wms_v43c_review_vendor_quote_batch(uuid,text,text),
  public.wms_v43c_update_vendor_quote(uuid,uuid,numeric,text,text,timestamptz),
  public.wms_v43c_review_vendor_quote(uuid,text,text)
TO authenticated;

DO $postcheck$
BEGIN
  IF NOT (
    SELECT count(*)=3 AND bool_and(c.relrowsecurity)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN (
        'wms_vendor_quote_bulk_batches',
        'wms_vendor_quote_bulk_batch_lines',
        'wms_vendor_quote_bulk_batch_events'
      )
  ) THEN
    RAISE EXCEPTION 'Bulk quote postcheck failed: RLS is not enabled on every batch table.';
  END IF;
  IF has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batches','INSERT')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batches','UPDATE')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batches','DELETE')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batches','TRUNCATE')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batches','REFERENCES')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batches','TRIGGER')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batch_lines','INSERT')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batch_lines','UPDATE')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batch_lines','DELETE')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batch_lines','TRUNCATE')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batch_lines','REFERENCES')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batch_lines','TRIGGER')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batch_events','INSERT')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batch_events','UPDATE')
     OR has_table_privilege('authenticated','public.wms_vendor_quote_bulk_batch_events','DELETE')
     OR has_table_privilege('authenticated','public.wms_vendor_variant_quotes','INSERT')
     OR has_table_privilege('authenticated','public.wms_vendor_variant_quotes','UPDATE')
     OR has_table_privilege('authenticated','public.wms_vendor_variant_quotes','DELETE')
     OR has_table_privilege('authenticated','public.wms_vendor_variant_quotes','TRUNCATE')
     OR has_any_column_privilege(
       'authenticated','public.wms_vendor_variant_quotes','INSERT'
     )
     OR has_any_column_privilege(
       'authenticated','public.wms_vendor_variant_quotes','UPDATE'
     ) THEN
    RAISE EXCEPTION 'Bulk quote postcheck failed: direct API write privileges remain.';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.wms_v43c_create_initial_vendor_quote_batch(text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.wms_v43c_review_vendor_quote_batch(uuid,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.wms_v43c_update_vendor_quote(uuid,uuid,numeric,text,text,timestamptz)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Bulk quote postcheck failed: expected authenticated RPC grants are missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='wms_v43c_one_pending_quote_per_vendor_sku'
  ) THEN
    RAISE EXCEPTION 'Bulk quote postcheck failed: pending quote duplicate guard is missing.';
  END IF;
END;
$postcheck$;

COMMIT;
