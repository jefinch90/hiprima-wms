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
      count(*) FILTER (WHERE candidate.readiness='READY') AS ready_mapping_count,
      count(DISTINCT candidate.variant_id)
        FILTER (WHERE candidate.readiness='READY') AS ready_sku_count,
      count(*) FILTER (WHERE candidate.readiness<>'READY') AS skipped_count,
      count(*) FILTER (
        WHERE candidate.readiness NOT IN ('READY','ALREADY_ACTIVE')
      ) AS action_required_count
    FROM candidates AS candidate
  )
  SELECT c.variant_id,c.sku,c.vendor_id,c.vendor_name,c.parameter_id,
    c.hpp_master,c.proposed_vendor_price,c.current_verified_price,c.readiness,c.reason,
    s.total_rows,s.ready_mapping_count,s.ready_sku_count,s.skipped_count,s.action_required_count
  FROM candidates AS c CROSS JOIN summary AS s
  ORDER BY c.vendor_name NULLS FIRST,c.sku,c.variant_id,c.readiness
  LIMIT p_limit OFFSET p_offset;
END;
$$;
