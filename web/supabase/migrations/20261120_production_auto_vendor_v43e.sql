-- V4.3E: choose only a single valid mapped vendor; preserve saved choices.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
DO $$ BEGIN
  IF (SELECT enabled FROM public.wms_v43c_operational_config WHERE singleton) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Workflow must remain OFF during installation.';
  END IF;
  IF to_regprocedure('public.wms_v43d_valid_mapping(uuid,uuid,uuid)') IS NULL OR
     to_regprocedure('public.wms_v43d_effective_price(uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'V4.3D price policy required.';
  END IF;
  IF to_regprocedure('public.wms_v43e_auto_select_vendors(uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'V4.3E already exists. Do not reapply.';
  END IF;
END; $$;
CREATE FUNCTION public.wms_v43e_auto_select_vendors(p_batch_id uuid,p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE v_result jsonb; v_enabled boolean;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  IF p_apply IS TRUE THEN
    SELECT cfg.enabled INTO v_enabled FROM public.wms_v43c_operational_config cfg WHERE cfg.singleton FOR SHARE;
    IF v_enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'Operational workflow disabled.'; END IF;
    PERFORM 1 FROM public.wms_production_review_batches b WHERE b.id=p_batch_id AND b.status='DRAFT' FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.wms_production_review_batches b WHERE b.id=p_batch_id AND b.status='DRAFT';
  END IF;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.wms_production_operational_approvals a WHERE a.batch_id=p_batch_id) THEN
    RAISE EXCEPTION 'Only unsubmitted DRAFT batches can use automatic vendor selection.';
  END IF;
  -- Count valid mappings before checking the price, lead time or MOQ. Never silently
  -- switch to another supplier because a valid supplier has a pending price change.
  WITH mapped AS (
    SELECT l.id AS line_id,l.variant_id,vm.id AS vendor_id,c.parameter_id,
      c.lead_time_days,c.moq_type,c.moq_quantity,
      count(*) OVER (PARTITION BY l.id) AS mapping_count
    FROM public.wms_production_review_lines l
    JOIN public.product_variants pv ON pv.id=l.variant_id
    JOIN public.wms_vendor_product_candidates c ON c.candidate_master_id=pv.product_id::text
    JOIN public.wms_vendor_master vm ON upper(btrim(vm.vendor_name))=upper(btrim(c.vendor_name))
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE' AND l.proposed_qty>0
      AND NOT EXISTS (SELECT 1 FROM public.wms_production_vendor_selections s WHERE s.line_id=l.id)
      AND public.wms_v43d_valid_mapping(l.variant_id,vm.id,c.parameter_id)
  ), eligible AS (
    SELECT m.line_id,m.vendor_id,m.parameter_id,ep.quote_id,ep.unit_price
    FROM mapped m
    JOIN LATERAL public.wms_v43d_effective_price(p_batch_id,m.variant_id,m.vendor_id,m.parameter_id) ep ON true
    WHERE m.mapping_count=1 AND m.lead_time_days BETWEEN 1 AND 365
      AND (m.moq_type='BY_REQUEST' OR (m.moq_type IN ('PER_PRODUCT','PER_COLOR') AND m.moq_quantity>0))
      AND ep.unit_price>0 AND ep.currency='IDR'
  )
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.line_id),'[]'::jsonb) INTO v_result FROM eligible e;
  IF p_apply IS TRUE THEN
    -- Existing selection, including stale/manual choices, is never overwritten.
    -- The existing submit/approve/PO validation RPCs recheck all data and snapshots.
    INSERT INTO public.wms_production_vendor_selections(line_id,batch_id,vendor_id,parameter_id,quote_id,selected_by,master_default_price)
    SELECT e.line_id,p_batch_id,e.vendor_id,e.parameter_id,e.quote_id,auth.uid(),
      CASE WHEN e.quote_id IS NULL THEN e.unit_price END
    FROM jsonb_to_recordset(v_result) AS e(line_id uuid,vendor_id uuid,parameter_id uuid,quote_id uuid,unit_price numeric)
    ON CONFLICT(line_id) DO NOTHING;
  END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.wms_v43e_auto_select_vendors(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wms_v43e_auto_select_vendors(uuid,boolean) TO authenticated;
DO $$ BEGIN
  IF (SELECT enabled FROM public.wms_v43c_operational_config WHERE singleton) IS DISTINCT FROM false OR
     has_function_privilege('anon','public.wms_v43e_auto_select_vendors(uuid,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'V4.3E security check failed.';
  END IF;
END; $$;
COMMIT;
