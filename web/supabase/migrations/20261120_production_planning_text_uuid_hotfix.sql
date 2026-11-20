BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_type text;
  v_signature text;
BEGIN
  SELECT data_type INTO v_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='wms_vendor_product_candidates'
    AND column_name='candidate_master_id';
  IF v_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'Preflight failed: candidate_master_id must be text; found %.', v_type;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products'
      AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='product_variants'
      AND column_name='product_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='wms_production_operational_approval_lines'
      AND column_name='product_id' AND data_type='uuid'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: expected product identity columns must be UUID.';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.wms_v43c_validate_batch(uuid)',
    'public.wms_v43c_validate_approval(uuid)',
    'public.wms_v43c_preview_operational_batch(uuid)',
    'public.wms_v43c_set_vendor_selection(uuid,uuid,uuid,uuid)',
    'public.wms_v43c_confirm_moq(uuid,integer,text,timestamp with time zone)',
    'public.wms_v43c_submit_operational_batch(uuid)',
    'public.wms_v43c_generate_purchase_orders(uuid)',
    'public.wms_v43c_finalize_generated_po(uuid)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Preflight failed: required RPC/helper is missing: %.', v_signature;
    END IF;
  END LOOP;
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
  LEFT JOIN public.wms_vendor_variant_quotes q ON q.id=s.quote_id
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
      OR q.id IS NULL OR q.vendor_id<>s.vendor_id OR q.variant_id<>pv.id
      OR q.status<>'VERIFIED' OR q.valid_from>now()
      OR (q.valid_until IS NOT NULL AND q.valid_until<=now())
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
    LEFT JOIN public.wms_vendor_variant_quotes q ON q.id=al.quote_id
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
      OR s.moq_confirmation_id IS DISTINCT FROM al.moq_confirmation_id
      OR vm.id IS NULL OR q.id IS NULL OR c.parameter_id IS NULL
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
    JOIN public.wms_vendor_variant_quotes q ON q.id=al.quote_id
    LEFT JOIN public.wms_vendor_moq_confirmations m ON m.id=al.moq_confirmation_id
    JOIN public.wms_vendor_product_candidates c
      ON c.parameter_id=al.parameter_id AND c.candidate_master_id=al.product_id::text
    LEFT JOIN LATERAL (
      SELECT h.hpp,h.created_at FROM public.product_variant_price_history h
      WHERE h.variant_id=pv.id ORDER BY h.created_at DESC LIMIT 1
    ) h ON true
    WHERE al.approval_id=p_approval_id AND (
      NOT pv.is_active OR NOT vm.is_active
      OR q.status<>'VERIFIED' OR q.vendor_id<>al.vendor_id
      OR q.variant_id<>al.variant_id OR q.verified_at IS DISTINCT FROM al.quote_verified_at_snapshot
      OR q.unit_price IS DISTINCT FROM al.vendor_unit_price_snapshot
      OR q.currency IS DISTINCT FROM al.currency_snapshot
      OR q.currency IS DISTINCT FROM 'IDR'
      OR q.valid_from>now() OR (q.valid_until IS NOT NULL AND q.valid_until<=now())
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
    q.id,q.unit_price,q.currency,q.valid_until,
    (s.line_id IS NOT NULL AND s.vendor_id=vm.id AND s.parameter_id=c.parameter_id
      AND s.quote_id=q.id),
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
  LEFT JOIN LATERAL (
    SELECT q0.* FROM public.wms_vendor_variant_quotes q0
    WHERE q0.vendor_id=vm.id AND q0.variant_id=pv.id AND q0.status='VERIFIED'
      AND q0.valid_from<=now() AND (q0.valid_until IS NULL OR q0.valid_until>now())
    ORDER BY q0.verified_at DESC LIMIT 1
  ) q ON true
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
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
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
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_vendor_master vm
    JOIN public.wms_vendor_variant_quotes q ON q.vendor_id=vm.id
    JOIN public.wms_vendor_product_candidates c ON c.parameter_id=p_parameter_id
    WHERE vm.id=p_vendor_id AND vm.is_active
      AND upper(btrim(c.vendor_name))=upper(btrim(vm.vendor_name))
      AND c.candidate_master_id=v_product_id::text AND c.review_status='VERIFIED'
      AND c.master_match_count=1
      AND q.id=p_quote_id AND q.variant_id=v_variant_id AND q.status='VERIFIED'
      AND q.valid_from<=now() AND (q.valid_until IS NULL OR q.valid_until>now())
  ) THEN RAISE EXCEPTION 'Select an active, verified vendor mapping and current verified quote.'; END IF;
  INSERT INTO public.wms_production_vendor_selections(
    line_id,batch_id,vendor_id,parameter_id,quote_id,selected_by
  ) VALUES(p_line_id,v_batch_id,p_vendor_id,p_parameter_id,p_quote_id,auth.uid())
  ON CONFLICT(line_id) DO UPDATE SET batch_id=excluded.batch_id,
    vendor_id=excluded.vendor_id,parameter_id=excluded.parameter_id,
    quote_id=excluded.quote_id,moq_confirmation_id=NULL,
    selected_by=excluded.selected_by,selected_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_confirm_moq(
  p_line_id uuid,p_confirmed_minimum_qty integer,p_evidence_ref text,p_valid_until timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_batch uuid;v_vendor uuid;v_parameter uuid;v_moq text;v_scope text;
  v_total integer;v_confirmation uuid;v_product uuid;v_color text;v_variant uuid;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 1 AND 400
     OR btrim(p_evidence_ref) ~* '^https?://'
     OR p_confirmed_minimum_qty IS NOT NULL AND p_confirmed_minimum_qty<=0
     OR p_valid_until IS NOT NULL AND p_valid_until<=now() THEN
    RAISE EXCEPTION 'MOQ confirmation evidence or validity is invalid.';
  END IF;
  SELECT l.batch_id,s.vendor_id,s.parameter_id,c.moq_type,pv.product_id,pv.color,pv.id
  INTO v_batch,v_vendor,v_parameter,v_moq,v_product,v_color,v_variant
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  JOIN public.wms_vendor_product_candidates c ON c.parameter_id=s.parameter_id
    AND c.candidate_master_id=pv.product_id::text
  WHERE l.id=p_line_id AND l.decision='PROPOSE';
  IF v_batch IS NULL OR v_moq<>'BY_REQUEST' THEN
    RAISE EXCEPTION 'Select a BY_REQUEST vendor before confirming MOQ.';
  END IF;
  PERFORM 1 FROM public.wms_production_review_batches
    WHERE id=v_batch AND status='DRAFT' FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.wms_production_operational_approvals WHERE batch_id=v_batch
  ) THEN RAISE EXCEPTION 'Submitted or reviewed batches cannot change MOQ confirmation.'; END IF;
  v_scope:=public.wms_v43c_scope_key(v_moq,v_product,v_color,v_variant);
  SELECT sum(l.proposed_qty)::integer INTO v_total
  FROM public.wms_production_review_lines l
  JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  JOIN public.product_variants pv ON pv.id=l.variant_id
  WHERE l.batch_id=v_batch AND l.decision='PROPOSE'
    AND s.vendor_id=v_vendor AND s.parameter_id=v_parameter
    AND public.wms_v43c_scope_key(v_moq,pv.product_id,pv.color,pv.id)=v_scope;
  IF v_total IS NULL OR v_total<=0 THEN
    RAISE EXCEPTION 'BY_REQUEST MOQ requires at least one selected proposed unit.';
  END IF;
  INSERT INTO public.wms_vendor_moq_confirmations(
    vendor_id,parameter_id,batch_id,moq_type,scope_key,requested_qty,
    confirmed_minimum_qty,evidence_ref,confirmed_by,valid_until
  ) VALUES (
    v_vendor,v_parameter,v_batch,'BY_REQUEST',v_scope,v_total,
    p_confirmed_minimum_qty,btrim(p_evidence_ref),auth.uid(),p_valid_until
  ) RETURNING id INTO v_confirmation;
  UPDATE public.wms_production_vendor_selections s
  SET moq_confirmation_id=v_confirmation
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  WHERE s.line_id=l.id AND l.batch_id=v_batch AND l.decision='PROPOSE'
    AND s.vendor_id=v_vendor AND s.parameter_id=v_parameter
    AND public.wms_v43c_scope_key(v_moq,pv.product_id,pv.color,pv.id)=v_scope;
  RETURN v_confirmation;
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
  JOIN public.wms_vendor_variant_quotes q ON q.id=s.quote_id
  JOIN public.wms_vendor_product_candidates c ON c.parameter_id=s.parameter_id
    AND c.candidate_master_id=prod.id::text
  JOIN LATERAL (
    SELECT ph.hpp,ph.created_at FROM public.product_variant_price_history ph
    WHERE ph.variant_id=pv.id ORDER BY ph.created_at DESC LIMIT 1
  ) h ON true
  WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE';

  INSERT INTO public.wms_production_operational_approval_events(
    approval_id,action,actor_id,actor_role,draft_fingerprint
  ) VALUES(v_approval,'SUBMITTED',auth.uid(),v_role,v_fingerprint);
  RETURN v_approval;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_generate_purchase_orders(p_approval_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_role text;v_approval public.wms_production_operational_approvals%ROWTYPE;
  v_conversion uuid;v_existing public.wms_production_po_conversions%ROWTYPE;
  v_vendor record;v_line record;v_po uuid;v_po_line uuid;v_order_link uuid;
  v_line_map jsonb:='{}'::jsonb;v_po_ids uuid[]:=ARRAY[]::uuid[];
  v_enabled boolean;v_eta date;
BEGIN
  v_role:=public.wms_v43c_assert_role(ARRAY['owner','admin']);
  SELECT enabled INTO v_enabled FROM public.wms_v43c_operational_config WHERE singleton;
  IF NOT coalesce(v_enabled,false) THEN
    RAISE EXCEPTION 'Generate PO is disabled.';
  END IF;
  SELECT * INTO v_approval FROM public.wms_production_operational_approvals
  WHERE id=p_approval_id FOR UPDATE;
  IF v_approval.id IS NULL OR v_approval.status<>'APPROVED' THEN
    RAISE EXCEPTION 'Only an operationally approved Draft can generate PO.';
  END IF;
  PERFORM 1 FROM public.wms_production_review_batches
  WHERE id=v_approval.batch_id FOR UPDATE;
  PERFORM public.wms_v43c_validate_approval(p_approval_id);

  SELECT * INTO v_existing FROM public.wms_production_po_conversions
  WHERE source_batch_id=v_approval.batch_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status<>'COMPLETED'
       OR v_existing.operational_approval_id<>p_approval_id
       OR v_existing.request_fingerprint<>v_approval.draft_fingerprint THEN
      RAISE EXCEPTION 'Existing conversion conflicts with this approved Draft.';
    END IF;
    SELECT array_agg(po_id ORDER BY po_id) INTO v_po_ids
    FROM public.wms_production_po_conversion_orders WHERE conversion_id=v_existing.id;
    RETURN jsonb_build_object('conversion_id',v_existing.id,'po_ids',coalesce(to_jsonb(v_po_ids),'[]'::jsonb),'idempotent',true);
  END IF;

  INSERT INTO public.wms_production_po_conversions(
    source_batch_id,operational_approval_id,idempotency_key,
    request_fingerprint,status,created_by
  ) VALUES(
    v_approval.batch_id,p_approval_id,p_approval_id,
    v_approval.draft_fingerprint,'GENERATING',auth.uid()
  ) RETURNING id INTO v_conversion;

  FOR v_vendor IN
    SELECT al.vendor_id,max(al.lead_time_days_snapshot) AS lead_days
    FROM public.wms_production_operational_approval_lines al
    WHERE al.approval_id=p_approval_id GROUP BY al.vendor_id ORDER BY al.vendor_id
  LOOP
    v_eta:=current_date+v_vendor.lead_days;
    v_po:=public.wms_po_create_auto(
      v_vendor.vendor_id,current_date,v_eta,
      'Generated from operationally approved Production Planning Draft '||v_approval.batch_id::text
    );
    v_po_ids:=array_append(v_po_ids,v_po);

    FOR v_line IN
      SELECT al.* FROM public.wms_production_operational_approval_lines al
      WHERE al.approval_id=p_approval_id AND al.vendor_id=v_vendor.vendor_id
      ORDER BY al.source_review_line_id
    LOOP
      v_po_line:=public.wms_po_add_line(
        v_po,v_line.variant_id,v_line.proposed_qty,NULL,
        current_date+v_line.lead_time_days_snapshot
      );
      UPDATE public.wms_po_lines
      SET vendor_quote_id=v_line.quote_id,
          master_hpp_snapshot=v_line.master_hpp_snapshot,
          vendor_unit_price_snapshot=v_line.vendor_unit_price_snapshot,
          vendor_currency_snapshot=v_line.currency_snapshot
      WHERE id=v_po_line;
      IF EXISTS (
        SELECT 1 FROM public.wms_vendor_product_candidates c
        WHERE c.candidate_master_id=v_line.product_id::text
          AND c.review_status='VERIFIED' AND c.master_match_count=1
          AND c.lifecycle_status='Seasonal'
      ) THEN
        PERFORM public.wms_po_approve_seasonal(v_po_line);
      END IF;
      v_line_map:=v_line_map||jsonb_build_object(v_line.source_review_line_id::text,v_po_line::text);
    END LOOP;

    INSERT INTO public.wms_production_po_conversion_orders(conversion_id,vendor_id,po_id)
    VALUES(v_conversion,v_vendor.vendor_id,v_po) RETURNING id INTO v_order_link;
    FOR v_line IN
      SELECT al.* FROM public.wms_production_operational_approval_lines al
      WHERE al.approval_id=p_approval_id AND al.vendor_id=v_vendor.vendor_id
      ORDER BY al.source_review_line_id
    LOOP
      INSERT INTO public.wms_production_po_conversion_lines(
        conversion_id,conversion_order_id,source_review_line_id,po_line_id,quote_id,
        master_hpp_snapshot,vendor_unit_price_snapshot,currency_snapshot,
        moq_type_snapshot,moq_scope_key_snapshot,moq_quantity_snapshot,
        moq_confirmation_id,ordered_qty_snapshot
      ) VALUES(
        v_conversion,v_order_link,v_line.source_review_line_id,
        (v_line_map->>v_line.source_review_line_id::text)::uuid,v_line.quote_id,
        v_line.master_hpp_snapshot,v_line.vendor_unit_price_snapshot,v_line.currency_snapshot,
        v_line.moq_type_snapshot,v_line.moq_scope_key_snapshot,v_line.moq_quantity_snapshot,
        v_line.moq_confirmation_id,v_line.proposed_qty
      );
    END LOOP;
  END LOOP;

  UPDATE public.wms_production_po_conversions SET status='COMPLETED'
  WHERE id=v_conversion;
  RETURN jsonb_build_object('conversion_id',v_conversion,'po_ids',to_jsonb(v_po_ids),'idempotent',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_finalize_generated_po(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_role text;v_status text;v_order_vendor uuid;v_approval_id uuid;
BEGIN
  v_role:=public.wms_v43c_assert_role(ARRAY['owner','admin']);
  SELECT o.status,o.vendor_id INTO v_status,v_order_vendor
  FROM public.wms_po_orders o WHERE o.id=p_po_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Only generated DRAFT PO can be finalized.';
  END IF;
  SELECT c.operational_approval_id INTO v_approval_id
  FROM public.wms_production_po_conversion_orders co
  JOIN public.wms_production_po_conversions c ON c.id=co.conversion_id
  JOIN public.wms_production_operational_approvals a ON a.id=c.operational_approval_id
  WHERE co.po_id=p_po_id AND c.status='COMPLETED' AND a.status='APPROVED'
    AND co.vendor_id=v_order_vendor;
  IF v_approval_id IS NULL THEN
    RAISE EXCEPTION 'PO is not linked to an approved operational conversion.';
  END IF;
  PERFORM public.wms_v43c_validate_approval(v_approval_id);
  IF NOT EXISTS (SELECT 1 FROM public.wms_po_lines WHERE po_id=p_po_id)
     OR EXISTS (
       SELECT 1 FROM public.wms_po_lines
       WHERE po_id=p_po_id AND variant_id IS NULL
     ) THEN
    RAISE EXCEPTION 'Generated PO is empty or contains an unmapped SKU.';
  END IF;
  IF (
    SELECT count(*) FROM public.wms_po_lines l WHERE l.po_id=p_po_id
  ) IS DISTINCT FROM (
    SELECT count(*) FROM public.wms_production_po_conversion_lines cl
    JOIN public.wms_production_po_conversion_orders co
      ON co.id=cl.conversion_order_id
    WHERE co.po_id=p_po_id
  ) THEN
    RAISE EXCEPTION 'Generated PO lines do not match their immutable conversion snapshot.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_po_lines l
    LEFT JOIN public.wms_production_po_conversion_lines cl ON cl.po_line_id=l.id
    LEFT JOIN public.wms_production_po_conversion_orders co
      ON co.id=cl.conversion_order_id
    WHERE l.po_id=p_po_id
      AND (cl.id IS NULL OR cl.conversion_id IS DISTINCT FROM co.conversion_id
        OR co.po_id IS DISTINCT FROM p_po_id)
  ) OR EXISTS (
    SELECT 1
    FROM public.wms_production_po_conversion_lines cl
    JOIN public.wms_production_po_conversion_orders co
      ON co.id=cl.conversion_order_id
    WHERE co.po_id=p_po_id
      AND NOT EXISTS (
        SELECT 1 FROM public.wms_po_lines l
        WHERE l.id=cl.po_line_id AND l.po_id=p_po_id
      )
  ) THEN
    RAISE EXCEPTION 'Generated PO line-to-conversion relationship is incomplete or inconsistent.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_po_lines l
    JOIN public.wms_production_po_conversion_lines cl ON cl.po_line_id=l.id
    JOIN public.wms_production_po_conversion_orders co
      ON co.id=cl.conversion_order_id
    LEFT JOIN public.wms_production_operational_approval_lines al
      ON al.approval_id=v_approval_id
      AND al.source_review_line_id=cl.source_review_line_id
    WHERE l.po_id=p_po_id AND (
      al.id IS NULL
      OR cl.conversion_id IS DISTINCT FROM co.conversion_id
      OR co.vendor_id IS DISTINCT FROM v_order_vendor
      OR al.vendor_id IS DISTINCT FROM co.vendor_id
      OR l.variant_id IS DISTINCT FROM al.variant_id
      OR l.ordered_qty IS DISTINCT FROM cl.ordered_qty_snapshot
      OR cl.ordered_qty_snapshot IS DISTINCT FROM al.proposed_qty
      OR l.unit_hpp IS NOT NULL
      OR l.vendor_quote_id IS DISTINCT FROM cl.quote_id
      OR cl.quote_id IS DISTINCT FROM al.quote_id
      OR l.master_hpp_snapshot IS DISTINCT FROM cl.master_hpp_snapshot
      OR cl.master_hpp_snapshot IS DISTINCT FROM al.master_hpp_snapshot
      OR l.vendor_unit_price_snapshot IS DISTINCT FROM cl.vendor_unit_price_snapshot
      OR cl.vendor_unit_price_snapshot IS DISTINCT FROM al.vendor_unit_price_snapshot
      OR l.vendor_currency_snapshot IS DISTINCT FROM cl.currency_snapshot
      OR cl.currency_snapshot IS DISTINCT FROM al.currency_snapshot
      OR cl.currency_snapshot IS DISTINCT FROM 'IDR'
    )
  ) THEN
    RAISE EXCEPTION 'Generated PO financial or quantity snapshots do not match approval.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_po_lines l
    JOIN public.wms_production_po_conversion_lines cl ON cl.po_line_id=l.id
    JOIN public.wms_production_operational_approval_lines al
      ON al.approval_id=v_approval_id
      AND al.source_review_line_id=cl.source_review_line_id
    WHERE l.po_id=p_po_id
      AND (
        al.lifecycle_status_snapshot='Seasonal'
        OR EXISTS (
          SELECT 1 FROM public.wms_vendor_product_candidates c
          WHERE c.candidate_master_id=al.product_id::text
            AND c.review_status='VERIFIED' AND c.master_match_count=1
            AND c.lifecycle_status='Seasonal'
        )
      )
      AND l.seasonal_approved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Seasonal items require the existing Owner/Admin item approval.';
  END IF;

  UPDATE public.wms_po_orders
  SET status='FINAL',finalized_by=auth.uid(),finalized_at=now(),updated_at=now()
  WHERE id=p_po_id;
END;
$$;

DO $$
DECLARE
  v_expected record;
  v_body text;
  v_security_definer boolean;
  v_search_path boolean;
  v_pattern text;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('public.wms_v43c_validate_batch(uuid)', ARRAY['c.candidate_master_id=prod.id::text','c.candidate_master_idisdistinctfromprod.id::text','c.candidate_master_id=pv.product_id::text']::text[]),
      ('public.wms_v43c_validate_approval(uuid)', ARRAY['c.candidate_master_id=al.product_id::text']::text[]),
      ('public.wms_v43c_preview_operational_batch(uuid)', ARRAY['c.candidate_master_id=prod.id::text']::text[]),
      ('public.wms_v43c_set_vendor_selection(uuid,uuid,uuid,uuid)', ARRAY['c.candidate_master_id=v_product_id::text']::text[]),
      ('public.wms_v43c_confirm_moq(uuid,integer,text,timestamp with time zone)', ARRAY['c.candidate_master_id=pv.product_id::text']::text[]),
      ('public.wms_v43c_submit_operational_batch(uuid)', ARRAY['c.candidate_master_id=prod.id::text']::text[]),
      ('public.wms_v43c_generate_purchase_orders(uuid)', ARRAY['c.candidate_master_id=v_line.product_id::text']::text[]),
      ('public.wms_v43c_finalize_generated_po(uuid)', ARRAY['c.candidate_master_id=al.product_id::text']::text[])
    ) AS expected(signature, patterns)
  LOOP
    SELECT regexp_replace(lower(p.prosrc), '\s+', '', 'g'), p.prosecdef,
           EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
                   WHERE cfg LIKE 'search_path=%')
    INTO v_body, v_security_definer, v_search_path
    FROM pg_proc p
    WHERE p.oid=to_regprocedure(v_expected.signature);
    IF v_body IS NULL OR NOT v_security_definer OR NOT v_search_path THEN
      RAISE EXCEPTION 'Postcheck failed: security attributes missing for %.', v_expected.signature;
    END IF;
    FOREACH v_pattern IN ARRAY v_expected.patterns LOOP
      IF position(v_pattern IN v_body)=0 THEN
        RAISE EXCEPTION 'Postcheck failed: expected explicit text cast missing in % (%).',
          v_expected.signature, v_pattern;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
SELECT 'PASS: all 12 product identity comparisons cast text explicitly; function signatures and SECURITY DEFINER search_path retained.' AS postcheck_result;
COMMIT;
