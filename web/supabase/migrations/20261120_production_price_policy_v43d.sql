-- V4.3D: resolved vendor price from validated Master HPP, or explicit verified change.
-- No data backfill, no changes to existing HPP, stock, or PO rows; workflow stays OFF.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
DO $$ BEGIN
  IF (SELECT enabled FROM public.wms_v43c_operational_config WHERE singleton) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Disable operational workflow before installing V4.3D.';
  END IF;
END; $$;
DO $check$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('public.wms_v43c_preview_operational_batch(uuid)','f8b1eb0931b0348ee7358ceddabbf571'),
    ('public.wms_v43c_set_vendor_selection(uuid,uuid,uuid,uuid)','954724b3b0461e8c650aeba66176320d'),
    ('public.wms_v43c_validate_batch(uuid)','2618e3d709eccf6c165430d28a790066'),
    ('public.wms_v43c_validate_approval(uuid)','a2f4ded38d23708667a9003f8fa7186a'),
    ('public.wms_v43c_submit_operational_batch(uuid)','dead9106dad5b9cb834e2f4b7bec805f')) AS expected(signature,body_hash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature) AND p.prosecdef
      AND md5(regexp_replace(p.prosrc,'\s+','','g'))=r.body_hash) THEN
      RAISE EXCEPTION 'Live RPC differs from supplied hotfix: %',r.signature;
    END IF;
  END LOOP;
END; $check$;
ALTER TABLE public.wms_vendor_variant_quotes
  ADD COLUMN scope_batch_id uuid REFERENCES public.wms_production_review_batches(id) ON DELETE RESTRICT,
  ADD COLUMN change_reason text,
  ADD COLUMN previous_unit_price numeric(14,2),
  ADD CONSTRAINT wms_v43d_change_reason_check CHECK (change_reason IS NULL OR length(btrim(change_reason)) BETWEEN 1 AND 400);
ALTER TABLE public.wms_production_vendor_selections ALTER COLUMN quote_id DROP NOT NULL,
  ADD COLUMN master_default_price numeric(14,2),
  ADD CONSTRAINT wms_v43d_selection_source_check CHECK ((quote_id IS NOT NULL AND master_default_price IS NULL) OR (quote_id IS NULL AND master_default_price IS NOT NULL AND master_default_price>0));
ALTER TABLE public.wms_production_operational_approval_lines
  ALTER COLUMN quote_id DROP NOT NULL,
  ALTER COLUMN quote_verified_at_snapshot DROP NOT NULL,
  ADD CONSTRAINT wms_v43d_approval_price_source CHECK ((quote_id IS NULL AND quote_verified_at_snapshot IS NULL AND vendor_unit_price_snapshot=master_hpp_snapshot) OR (quote_id IS NOT NULL AND quote_verified_at_snapshot IS NOT NULL));
ALTER TABLE public.wms_production_po_conversion_lines ALTER COLUMN quote_id DROP NOT NULL;
CREATE INDEX wms_v43d_quote_scope_idx ON public.wms_vendor_variant_quotes(vendor_id,variant_id,scope_batch_id,verified_at DESC);

CREATE OR REPLACE FUNCTION public.wms_v43d_valid_mapping(p_variant_id uuid,p_vendor_id uuid,p_parameter_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.product_variants pv
    JOIN public.wms_vendor_master vm ON vm.id=p_vendor_id AND vm.is_active
    JOIN public.wms_vendor_product_parameters p ON p.id=p_parameter_id AND p.vendor_id=vm.id
    JOIN public.wms_vendor_product_candidates c ON c.parameter_id=p.id
      AND c.candidate_master_id=pv.product_id::text
    WHERE pv.id=p_variant_id AND pv.is_active
      AND c.review_status='VERIFIED' AND c.master_match_count=1
      AND c.lifecycle_status IN ('On Produksi','Seasonal')
      AND upper(btrim(c.vendor_name))=upper(btrim(vm.vendor_name))
      AND (SELECT count(*) FROM public.wms_vendor_product_candidates c2
        WHERE c2.candidate_master_id=pv.product_id::text
          AND upper(btrim(c2.vendor_name))=upper(btrim(vm.vendor_name)))=1
      AND (SELECT count(*) FROM public.wms_vendor_master vm2
        WHERE upper(btrim(vm2.vendor_name))=upper(btrim(vm.vendor_name)))=1
  );
$$;

CREATE OR REPLACE FUNCTION public.wms_v43d_effective_price(p_batch_id uuid,p_variant_id uuid,p_vendor_id uuid,p_parameter_id uuid)
RETURNS TABLE(quote_id uuid,unit_price numeric,currency char(3),valid_until timestamptz,verified_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_hpp numeric; v_quote public.wms_vendor_variant_quotes%ROWTYPE;
BEGIN
  IF NOT public.wms_v43d_valid_mapping(p_variant_id,p_vendor_id,p_parameter_id) THEN RETURN; END IF;
  SELECT pv.hpp INTO v_hpp FROM public.product_variants pv
  JOIN LATERAL (SELECT h.hpp FROM public.product_variant_price_history h
    WHERE h.variant_id=pv.id ORDER BY h.created_at DESC LIMIT 1) h ON true
  WHERE pv.id=p_variant_id AND pv.is_active AND pv.hpp>0 AND pv.hpp=pv.cost_price AND pv.hpp=h.hpp;
  IF v_hpp IS NULL THEN RETURN; END IF;
  -- A relevant pending change must be resolved before ordering; do not silently fall back.
  IF EXISTS (SELECT 1 FROM public.wms_vendor_variant_quotes q
    WHERE q.vendor_id=p_vendor_id AND q.variant_id=p_variant_id AND q.status='PENDING'
      AND (q.scope_batch_id IS NULL OR q.scope_batch_id=p_batch_id)) THEN RETURN; END IF;
  SELECT q.* INTO v_quote FROM public.wms_vendor_variant_quotes q
  WHERE q.vendor_id=p_vendor_id AND q.variant_id=p_variant_id AND q.status='VERIFIED'
    AND (q.scope_batch_id IS NULL OR q.scope_batch_id=p_batch_id)
  ORDER BY (q.scope_batch_id IS NOT NULL) DESC,q.verified_at DESC,q.id DESC LIMIT 1;
  IF v_quote.id IS NOT NULL THEN
    IF v_quote.valid_from>now() OR (v_quote.valid_until IS NOT NULL AND v_quote.valid_until<=now())
      OR v_quote.verified_at IS NULL OR v_quote.currency IS DISTINCT FROM 'IDR' THEN RETURN; END IF;
    RETURN QUERY SELECT v_quote.id,v_quote.unit_price::numeric,v_quote.currency,v_quote.valid_until,v_quote.verified_at;
  ELSE
    RETURN QUERY SELECT NULL::uuid,v_hpp,'IDR'::char(3),NULL::timestamptz,NULL::timestamptz;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43d_request_price_change(
  p_batch_id uuid,p_variant_id uuid,p_vendor_id uuid,p_parameter_id uuid,
  p_unit_price numeric,p_scope text,p_reason text,p_source_type text,p_evidence_ref text,p_valid_until timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_id uuid; v_old numeric; v_scope uuid;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF p_scope IS NULL OR p_scope NOT IN ('STANDARD','THIS_PO') OR p_unit_price IS NULL
    OR p_unit_price<=0 OR p_unit_price>=1000000000000 OR p_unit_price<>round(p_unit_price,2)
    OR p_source_type IS NULL OR p_source_type NOT IN ('DOCUMENT','EMAIL','PORTAL','OTHER')
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 400
    OR length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 1 AND 400
    OR btrim(p_evidence_ref) ~* '^https?://' OR (p_valid_until IS NOT NULL AND p_valid_until<=now()) THEN
    RAISE EXCEPTION 'Harga, jenis perubahan, alasan, bukti, atau masa berlaku tidak valid.';
  END IF;
  PERFORM 1 FROM public.wms_production_review_batches b WHERE b.id=p_batch_id AND b.status='DRAFT' FOR UPDATE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.wms_production_operational_approvals a WHERE a.batch_id=p_batch_id)
    OR NOT EXISTS (SELECT 1 FROM public.wms_production_review_lines l WHERE l.batch_id=p_batch_id AND l.variant_id=p_variant_id AND l.decision='PROPOSE' AND l.proposed_qty>0) THEN
    RAISE EXCEPTION 'Perubahan harga memerlukan SKU pada Draft yang belum diajukan.';
  END IF;
  PERFORM 1 FROM public.product_variants pv WHERE pv.id=p_variant_id FOR UPDATE;
  IF NOT public.wms_v43d_valid_mapping(p_variant_id,p_vendor_id,p_parameter_id) THEN RAISE EXCEPTION 'Mapping vendor tidak valid atau tidak unik.'; END IF;
  SELECT pv.hpp INTO v_old FROM public.product_variants pv JOIN LATERAL
    (SELECT h.hpp FROM public.product_variant_price_history h WHERE h.variant_id=pv.id ORDER BY h.created_at DESC LIMIT 1) h ON true
    WHERE pv.id=p_variant_id AND pv.hpp>0 AND pv.cost_price=pv.hpp AND h.hpp=pv.hpp;
  IF v_old IS NULL THEN RAISE EXCEPTION 'HPP Master belum valid.'; END IF;
  v_scope:=CASE WHEN p_scope='THIS_PO' THEN p_batch_id ELSE NULL END;
  -- Prior price for the requested scope; may renew an expired verified quote at the same price.
  SELECT coalesce((SELECT q.unit_price FROM public.wms_vendor_variant_quotes q
    WHERE q.vendor_id=p_vendor_id AND q.variant_id=p_variant_id AND q.status='VERIFIED'
      AND (q.scope_batch_id IS NULL OR q.scope_batch_id=v_scope)
    ORDER BY (q.scope_batch_id IS NOT NULL) DESC,q.verified_at DESC,q.id DESC LIMIT 1),v_old) INTO v_old;
  IF EXISTS (SELECT 1 FROM public.wms_vendor_variant_quotes q WHERE q.vendor_id=p_vendor_id AND q.variant_id=p_variant_id AND q.status='PENDING') THEN
    RAISE EXCEPTION 'Masih ada perubahan harga PENDING vendor/SKU ini.';
  END IF;
  IF p_unit_price=v_old AND EXISTS (SELECT 1 FROM public.wms_v43d_effective_price(p_batch_id,p_variant_id,p_vendor_id,p_parameter_id) ep WHERE ep.unit_price=p_unit_price) THEN
    RAISE EXCEPTION 'Harga sama dengan harga aktif; pengajuan tidak diperlukan.';
  END IF;
  INSERT INTO public.wms_vendor_variant_quotes(vendor_id,variant_id,unit_price,currency,source_type,evidence_ref,valid_until,created_by,scope_batch_id,change_reason,previous_unit_price)
    VALUES(p_vendor_id,p_variant_id,p_unit_price,'IDR',p_source_type,btrim(p_evidence_ref),p_valid_until,auth.uid(),v_scope,btrim(p_reason),v_old)
    RETURNING id INTO v_id;
  INSERT INTO public.wms_vendor_variant_quote_events(quote_id,action,actor_id,notes)
    VALUES(v_id,'CREATED',auth.uid(),p_scope||': '||btrim(p_reason));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.wms_v43d_valid_mapping(uuid,uuid,uuid),public.wms_v43d_effective_price(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wms_v43d_request_price_change(uuid,uuid,uuid,uuid,numeric,text,text,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wms_v43d_request_price_change(uuid,uuid,uuid,uuid,numeric,text,text,text,text,timestamptz) TO authenticated;
CREATE OR REPLACE FUNCTION public.wms_v43c_preview_operational_batch(p_batch_id uuid)
RETURNS TABLE(
  batch_id uuid,line_id uuid,variant_id uuid,sku text,product_code text,
  decision text,proposed_qty integer,hpp_master numeric,cost_price numeric,
  hpp_history numeric,hpp_history_at timestamptz,vendor_id uuid,vendor_name text,
  parameter_id uuid,lead_time_days integer,lifecycle_status text,moq_type text,
  moq_quantity integer,review_status text,quote_id uuid,vendor_unit_price numeric,
  currency char(3),quote_valid_until timestamptz,selected boolean,
  moq_confirmation_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  RETURN QUERY
  SELECT l.batch_id,l.id,pv.id,pv.sku,prod.product_code,l.decision,l.proposed_qty,
    pv.hpp,pv.cost_price,h.hpp,h.created_at,vm.id,vm.vendor_name,c.parameter_id,
    c.lead_time_days,c.lifecycle_status,c.moq_type,c.moq_quantity,c.review_status,
    q.quote_id,q.unit_price,q.currency,q.valid_until,
    (s.line_id IS NOT NULL AND s.vendor_id=vm.id AND s.parameter_id=c.parameter_id
      AND q.unit_price IS NOT NULL AND s.quote_id IS NOT DISTINCT FROM q.quote_id
      AND (q.quote_id IS NOT NULL OR s.master_default_price IS NOT DISTINCT FROM q.unit_price)),
    s.moq_confirmation_id
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.products prod ON prod.id=pv.product_id
  LEFT JOIN LATERAL (
    SELECT ph.hpp,ph.created_at FROM public.product_variant_price_history ph
    WHERE ph.variant_id=pv.id ORDER BY ph.created_at DESC LIMIT 1
  ) h ON true
  LEFT JOIN public.wms_vendor_product_candidates c
    ON c.candidate_master_id=prod.id::text
  LEFT JOIN public.wms_vendor_master vm
    ON upper(btrim(vm.vendor_name))=upper(btrim(c.vendor_name))
  LEFT JOIN LATERAL public.wms_v43d_effective_price(l.batch_id,pv.id,vm.id,c.parameter_id) q ON true
  LEFT JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  WHERE l.batch_id=p_batch_id
  ORDER BY l.id,c.parameter_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_set_vendor_selection(
  p_line_id uuid,p_vendor_id uuid,p_parameter_id uuid,p_quote_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_batch_id uuid;
  v_variant_id uuid;
  v_product_id uuid;
  v_selected_price numeric;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  IF NOT coalesce((SELECT enabled FROM public.wms_v43c_operational_config WHERE singleton),false) THEN RAISE EXCEPTION 'Operational workflow disabled.'; END IF;
  SELECT l.batch_id,l.variant_id,pv.product_id INTO v_batch_id,v_variant_id,v_product_id
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  WHERE l.id=p_line_id AND l.decision='PROPOSE' AND l.proposed_qty>0
  FOR UPDATE OF l;
  IF v_batch_id IS NULL THEN RAISE EXCEPTION 'Proposed Review line not found.'; END IF;
  PERFORM 1 FROM public.wms_production_review_batches
  WHERE id=v_batch_id AND status='DRAFT' FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.wms_production_operational_approvals WHERE batch_id=v_batch_id
  ) THEN RAISE EXCEPTION 'Submitted or reviewed batches cannot change vendor selection.'; END IF;
  PERFORM 1 FROM public.product_variants pv WHERE pv.id=v_variant_id FOR SHARE;
  SELECT ep.unit_price INTO v_selected_price FROM public.wms_v43d_effective_price(v_batch_id,v_variant_id,p_vendor_id,p_parameter_id) ep
    WHERE ep.quote_id IS NOT DISTINCT FROM p_quote_id;
  IF v_selected_price IS NULL THEN RAISE EXCEPTION 'Mapping atau harga aktif tidak valid. Refresh Draft.'; END IF;
  INSERT INTO public.wms_production_vendor_selections(
    line_id,batch_id,vendor_id,parameter_id,quote_id,selected_by,master_default_price
  ) VALUES(p_line_id,v_batch_id,p_vendor_id,p_parameter_id,p_quote_id,auth.uid(),CASE WHEN p_quote_id IS NULL THEN v_selected_price END)
  ON CONFLICT(line_id) DO UPDATE SET batch_id=excluded.batch_id,
    vendor_id=excluded.vendor_id,parameter_id=excluded.parameter_id,
    quote_id=excluded.quote_id,master_default_price=excluded.master_default_price,moq_confirmation_id=NULL,
    selected_by=excluded.selected_by,selected_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_validate_batch(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_invalid bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_production_review_batches b
    WHERE b.id=p_batch_id AND b.status='DRAFT'
  ) THEN
    RAISE EXCEPTION 'Operational approval only accepts a DRAFT Review batch.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_production_review_lines l
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE' AND l.proposed_qty>0
  ) THEN
    RAISE EXCEPTION 'Review Draft has no proposed production lines.';
  END IF;

  SELECT count(*) INTO v_invalid
  FROM public.wms_production_review_lines l
  LEFT JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  LEFT JOIN public.wms_vendor_master vm ON vm.id=s.vendor_id
  LEFT JOIN LATERAL public.wms_v43d_effective_price(l.batch_id,l.variant_id,s.vendor_id,s.parameter_id) q ON true
  JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.products prod ON prod.id=pv.product_id
  LEFT JOIN public.wms_vendor_product_candidates c
    ON c.parameter_id=s.parameter_id AND c.candidate_master_id=prod.id::text
  LEFT JOIN LATERAL (
    SELECT h.hpp,h.created_at
    FROM public.product_variant_price_history h
    WHERE h.variant_id=pv.id
    ORDER BY h.created_at DESC
    LIMIT 1
  ) h ON true
  WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE'
    AND (
      s.line_id IS NULL OR vm.id IS NULL OR NOT vm.is_active
      OR NOT pv.is_active
      OR q.unit_price IS NULL OR q.quote_id IS DISTINCT FROM s.quote_id
      OR (s.quote_id IS NULL AND s.master_default_price IS DISTINCT FROM q.unit_price)
      OR c.parameter_id IS NULL OR c.review_status IS DISTINCT FROM 'VERIFIED'
      OR c.master_match_count IS DISTINCT FROM 1
      OR c.candidate_master_id IS DISTINCT FROM prod.id::text
      OR upper(btrim(c.vendor_name)) IS DISTINCT FROM upper(btrim(vm.vendor_name))
      OR prod.product_code IS NULL OR prod.name IS NULL
      OR c.lifecycle_status IS NULL OR c.lifecycle_status NOT IN ('On Produksi','Seasonal')
      OR c.lead_time_days IS NULL OR c.lead_time_days NOT BETWEEN 1 AND 365
      OR c.moq_type IS NULL OR c.moq_type NOT IN ('PER_PRODUCT','PER_COLOR','BY_REQUEST')
      OR c.moq_type IN ('PER_PRODUCT','PER_COLOR') AND c.moq_quantity IS NULL
      OR pv.hpp IS NULL OR pv.hpp<=0 OR pv.cost_price IS DISTINCT FROM pv.hpp
      OR h.hpp IS NULL OR h.hpp IS DISTINCT FROM pv.hpp
    );
  IF v_invalid>0 THEN
    RAISE EXCEPTION 'Draft has missing or stale vendor, lifecycle, MOQ, active SKU, or consistent HPP data.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wms_production_review_lines l
    JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
    JOIN public.product_variants pv ON pv.id=l.variant_id
    JOIN public.wms_vendor_product_candidates c
      ON c.parameter_id=s.parameter_id AND c.candidate_master_id=pv.product_id::text
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE'
      AND c.moq_type IN ('PER_PRODUCT','PER_COLOR')
      AND (
        SELECT sum(l2.proposed_qty)
        FROM public.wms_production_review_lines l2
        JOIN public.wms_production_vendor_selections s2 ON s2.line_id=l2.id
        JOIN public.product_variants pv2 ON pv2.id=l2.variant_id
        WHERE l2.batch_id=p_batch_id AND l2.decision='PROPOSE'
          AND s2.vendor_id=s.vendor_id AND s2.parameter_id=s.parameter_id
          AND public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id)
              = public.wms_v43c_scope_key(c.moq_type,pv2.product_id,pv2.color,pv2.id)
      ) < c.moq_quantity
  ) THEN
    RAISE EXCEPTION 'Selected vendor MOQ is not met for one or more product/color scopes.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wms_production_review_lines l
    JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
    JOIN public.product_variants pv ON pv.id=l.variant_id
    JOIN public.wms_vendor_product_candidates c ON c.parameter_id=s.parameter_id
    LEFT JOIN public.wms_vendor_moq_confirmations m
      ON m.id=s.moq_confirmation_id
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE'
      AND c.moq_type='BY_REQUEST'
      AND (
        m.id IS NULL OR m.batch_id<>p_batch_id OR m.vendor_id<>s.vendor_id
        OR m.parameter_id<>s.parameter_id OR m.scope_key<>
          public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id)
        OR (m.valid_until IS NOT NULL AND m.valid_until<=now())
        OR m.requested_qty IS DISTINCT FROM
          (SELECT sum(l2.proposed_qty)::integer
           FROM public.wms_production_review_lines l2
           JOIN public.wms_production_vendor_selections s2 ON s2.line_id=l2.id
           JOIN public.product_variants pv2 ON pv2.id=l2.variant_id
           WHERE l2.batch_id=p_batch_id AND l2.decision='PROPOSE'
             AND s2.vendor_id=s.vendor_id AND s2.parameter_id=s.parameter_id
             AND public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id)
                 = public.wms_v43c_scope_key(c.moq_type,pv2.product_id,pv2.color,pv2.id))
        OR m.confirmed_minimum_qty IS NOT NULL AND m.confirmed_minimum_qty>
          (SELECT sum(l2.proposed_qty)
           FROM public.wms_production_review_lines l2
           JOIN public.wms_production_vendor_selections s2 ON s2.line_id=l2.id
           JOIN public.product_variants pv2 ON pv2.id=l2.variant_id
           WHERE l2.batch_id=p_batch_id AND l2.decision='PROPOSE'
             AND s2.vendor_id=s.vendor_id AND s2.parameter_id=s.parameter_id
             AND public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id)
                 = public.wms_v43c_scope_key(c.moq_type,pv2.product_id,pv2.color,pv2.id))
      )
  ) THEN
    RAISE EXCEPTION 'BY_REQUEST MOQ requires a valid supplier confirmation for the selected scope.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_production_review_lines l
    JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
    JOIN public.product_variants pv ON pv.id=l.variant_id
    JOIN public.wms_vendor_product_candidates c
      ON c.parameter_id=s.parameter_id AND c.candidate_master_id=pv.product_id::text
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE'
      AND c.moq_type='BY_REQUEST'
      AND (
        s.moq_confirmation_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.wms_vendor_moq_confirmations m
          WHERE m.id=s.moq_confirmation_id
            AND m.batch_id=p_batch_id
            AND m.vendor_id=s.vendor_id
            AND m.parameter_id=s.parameter_id
            AND m.moq_type='BY_REQUEST'
            AND m.confirmed_by IS NOT NULL
            AND m.confirmed_at IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'BY_REQUEST MOQ confirmation relation is incomplete.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_validate_approval(p_approval_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_batch_id uuid;
  v_fingerprint text;
BEGIN
  SELECT a.batch_id,a.draft_fingerprint INTO v_batch_id,v_fingerprint
  FROM public.wms_production_operational_approvals a
  WHERE a.id=p_approval_id;
  IF v_batch_id IS NULL OR v_fingerprint IS NULL OR
     public.wms_v43c_review_fingerprint(v_batch_id) IS DISTINCT FROM v_fingerprint THEN
    RAISE EXCEPTION 'Review Draft changed after operational submission.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_production_operational_approval_lines al
    WHERE al.approval_id=p_approval_id
  ) OR (
    SELECT count(*) FROM public.wms_production_review_lines l
    WHERE l.batch_id=v_batch_id AND l.decision='PROPOSE' AND l.proposed_qty>0
  ) IS DISTINCT FROM (
    SELECT count(*) FROM public.wms_production_operational_approval_lines al
    WHERE al.approval_id=p_approval_id
  ) THEN
    RAISE EXCEPTION 'Operational approval is missing one or more immutable line snapshots.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_production_operational_approval_lines al
    LEFT JOIN public.wms_production_review_lines l
      ON l.id=al.source_review_line_id AND l.batch_id=v_batch_id
    LEFT JOIN public.product_variants pv ON pv.id=al.variant_id
    LEFT JOIN public.products prod ON prod.id=al.product_id
    LEFT JOIN public.wms_production_vendor_selections s
      ON s.line_id=al.source_review_line_id
    LEFT JOIN public.wms_vendor_master vm ON vm.id=al.vendor_id
    LEFT JOIN public.wms_vendor_product_candidates c
      ON c.parameter_id=al.parameter_id AND c.candidate_master_id=al.product_id::text
    WHERE al.approval_id=p_approval_id AND (
      l.id IS NULL OR l.decision IS DISTINCT FROM 'PROPOSE'
      OR l.proposed_qty IS DISTINCT FROM al.proposed_qty
      OR l.variant_id IS DISTINCT FROM al.variant_id
      OR pv.id IS NULL OR pv.product_id IS DISTINCT FROM al.product_id
      OR prod.id IS NULL OR al.sku_snapshot IS DISTINCT FROM pv.sku
      OR al.product_code_snapshot IS DISTINCT FROM prod.product_code
      OR al.product_name_snapshot IS DISTINCT FROM prod.name
      OR al.color_snapshot IS DISTINCT FROM pv.color
      OR s.line_id IS NULL OR s.batch_id IS DISTINCT FROM v_batch_id
      OR s.vendor_id IS DISTINCT FROM al.vendor_id
      OR s.parameter_id IS DISTINCT FROM al.parameter_id
      OR s.quote_id IS DISTINCT FROM al.quote_id
      OR (s.quote_id IS NULL AND s.master_default_price IS DISTINCT FROM al.vendor_unit_price_snapshot)
      OR s.moq_confirmation_id IS DISTINCT FROM al.moq_confirmation_id
      OR vm.id IS NULL OR c.parameter_id IS NULL
      OR al.currency_snapshot IS DISTINCT FROM 'IDR'
    )
  ) THEN
    RAISE EXCEPTION 'Operational approval line relation or snapshot is missing or inconsistent.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wms_production_operational_approval_lines al
    JOIN public.product_variants pv ON pv.id=al.variant_id
    JOIN public.wms_vendor_master vm ON vm.id=al.vendor_id
    LEFT JOIN LATERAL public.wms_v43d_effective_price(v_batch_id,al.variant_id,al.vendor_id,al.parameter_id) q ON true
    LEFT JOIN public.wms_vendor_moq_confirmations m ON m.id=al.moq_confirmation_id
    JOIN public.wms_vendor_product_candidates c
      ON c.parameter_id=al.parameter_id AND c.candidate_master_id=al.product_id::text
    LEFT JOIN LATERAL (
      SELECT h.hpp,h.created_at FROM public.product_variant_price_history h
      WHERE h.variant_id=pv.id ORDER BY h.created_at DESC LIMIT 1
    ) h ON true
    WHERE al.approval_id=p_approval_id AND (
      NOT pv.is_active OR NOT vm.is_active
      OR q.unit_price IS NULL OR q.quote_id IS DISTINCT FROM al.quote_id
      OR q.verified_at IS DISTINCT FROM al.quote_verified_at_snapshot
      OR q.unit_price IS DISTINCT FROM al.vendor_unit_price_snapshot
      OR q.currency IS DISTINCT FROM al.currency_snapshot
      OR q.currency IS DISTINCT FROM 'IDR'
      OR c.review_status IS DISTINCT FROM 'VERIFIED'
      OR c.master_match_count IS DISTINCT FROM 1
      OR upper(btrim(c.vendor_name)) IS DISTINCT FROM upper(btrim(vm.vendor_name))
      OR c.lead_time_days IS DISTINCT FROM al.lead_time_days_snapshot
      OR c.lifecycle_status IS DISTINCT FROM al.lifecycle_status_snapshot
      OR c.moq_type IS DISTINCT FROM al.moq_type_snapshot
      OR c.moq_quantity IS DISTINCT FROM al.moq_quantity_snapshot
      OR al.moq_type_snapshot='BY_REQUEST' AND (
        m.id IS NULL
        OR m.batch_id IS DISTINCT FROM (SELECT a.batch_id
          FROM public.wms_production_operational_approvals a
          WHERE a.id=p_approval_id)
        OR m.vendor_id IS DISTINCT FROM al.vendor_id
        OR m.parameter_id IS DISTINCT FROM al.parameter_id
        OR m.scope_key IS DISTINCT FROM al.moq_scope_key_snapshot
        OR m.requested_qty IS DISTINCT FROM (
          SELECT sum(al2.proposed_qty)::integer
          FROM public.wms_production_operational_approval_lines al2
          WHERE al2.approval_id=al.approval_id
            AND al2.vendor_id=al.vendor_id AND al2.parameter_id=al.parameter_id
            AND al2.moq_scope_key_snapshot=al.moq_scope_key_snapshot
        )
        OR (m.valid_until IS NOT NULL AND m.valid_until<=now())
        OR (m.confirmed_minimum_qty IS NOT NULL AND m.confirmed_minimum_qty>
          (SELECT sum(al2.proposed_qty)::integer
           FROM public.wms_production_operational_approval_lines al2
           WHERE al2.approval_id=al.approval_id
             AND al2.vendor_id=al.vendor_id AND al2.parameter_id=al.parameter_id
             AND al2.moq_scope_key_snapshot=al.moq_scope_key_snapshot))
      )
      OR pv.hpp IS DISTINCT FROM al.master_hpp_snapshot
      OR pv.cost_price IS DISTINCT FROM al.master_hpp_snapshot
      OR h.hpp IS DISTINCT FROM al.master_hpp_history_snapshot
      OR h.created_at IS DISTINCT FROM al.master_hpp_history_at_snapshot
    )
  ) THEN
    RAISE EXCEPTION 'Vendor quote, lifecycle, MOQ, active SKU, or HPP changed after submission.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_submit_operational_batch(p_batch_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_role text;v_fingerprint text;v_approval uuid;v_enabled boolean;
BEGIN
  v_role:=public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  SELECT enabled INTO v_enabled FROM public.wms_v43c_operational_config
  WHERE singleton FOR SHARE;
  IF NOT coalesce(v_enabled,false) THEN
    RAISE EXCEPTION 'Operational Approval and Generate PO are disabled.';
  END IF;
  PERFORM 1 FROM public.wms_production_review_batches
  WHERE id=p_batch_id AND status='DRAFT' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review batch must remain DRAFT.'; END IF;
  IF EXISTS (SELECT 1 FROM public.wms_production_operational_approvals WHERE batch_id=p_batch_id) THEN
    RAISE EXCEPTION 'This Draft already has an operational decision; use a new Review Draft for rework.';
  END IF;
  PERFORM pv.id FROM public.product_variants pv
    JOIN public.wms_production_review_lines l ON l.variant_id=pv.id
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE' ORDER BY pv.id FOR SHARE OF pv;
  PERFORM public.wms_v43c_validate_batch(p_batch_id);
  v_fingerprint:=public.wms_v43c_review_fingerprint(p_batch_id);
  INSERT INTO public.wms_production_operational_approvals(
    batch_id,status,submitted_by,submitted_role,draft_fingerprint
  ) VALUES(p_batch_id,'SUBMITTED',auth.uid(),v_role,v_fingerprint)
  RETURNING id INTO v_approval;

  INSERT INTO public.wms_production_operational_approval_lines(
    approval_id,source_review_line_id,variant_id,product_id,vendor_id,parameter_id,
    quote_id,moq_confirmation_id,sku_snapshot,product_code_snapshot,
    product_name_snapshot,color_snapshot,proposed_qty,master_hpp_snapshot,
    master_hpp_history_snapshot,master_hpp_history_at_snapshot,
    vendor_unit_price_snapshot,currency_snapshot,quote_verified_at_snapshot,
    lead_time_days_snapshot,lifecycle_status_snapshot,moq_type_snapshot,
    moq_scope_key_snapshot,moq_quantity_snapshot
  )
  SELECT v_approval,l.id,pv.id,prod.id,s.vendor_id,s.parameter_id,s.quote_id,
    s.moq_confirmation_id,pv.sku,prod.product_code,prod.name,pv.color,l.proposed_qty,
    pv.hpp,h.hpp,h.created_at,q.unit_price,q.currency,q.verified_at,
    c.lead_time_days,c.lifecycle_status,c.moq_type,
    public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id),c.moq_quantity
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.products prod ON prod.id=pv.product_id
  JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  JOIN LATERAL public.wms_v43d_effective_price(l.batch_id,pv.id,s.vendor_id,s.parameter_id) q ON q.quote_id IS NOT DISTINCT FROM s.quote_id
  JOIN public.wms_vendor_product_candidates c ON c.parameter_id=s.parameter_id
    AND c.candidate_master_id=prod.id::text
  JOIN LATERAL (
    SELECT ph.hpp,ph.created_at FROM public.product_variant_price_history ph
    WHERE ph.variant_id=pv.id ORDER BY ph.created_at DESC LIMIT 1
  ) h ON true
  WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE';

  PERFORM public.wms_v43c_validate_approval(v_approval);

  INSERT INTO public.wms_production_operational_approval_events(
    approval_id,action,actor_id,actor_role,draft_fingerprint
  ) VALUES(v_approval,'SUBMITTED',auth.uid(),v_role,v_fingerprint);
  RETURN v_approval;
END;
$$;
-- Legacy requests lack explicit scope/reason. Keep old rows, read and review RPCs intact.
REVOKE EXECUTE ON FUNCTION public.wms_v43c_create_vendor_quote(uuid,uuid,numeric,text,text,text,timestamptz),public.wms_v43c_update_vendor_quote(uuid,uuid,numeric,text,text,timestamptz),public.wms_v43c_create_initial_vendor_quote_batch(text) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
  IF (SELECT enabled FROM public.wms_v43c_operational_config WHERE singleton) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Workflow must remain OFF'; END IF;
END; $$;
COMMIT;
