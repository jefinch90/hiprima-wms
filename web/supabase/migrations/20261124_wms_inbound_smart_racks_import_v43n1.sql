-- Hi.PRIMA WMS V4.3N.1 - rekomendasi rak: stok, histori, import awal.
-- DRAFT ONLY: Jangan jalankan di Production tanpa persetujuan Owner.
-- READ-ONLY RPC. Tidak mengubah inventory, stock_movements, PO, ataupun HPP.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.inventory') IS NULL
    OR to_regclass('public.stock_movements') IS NULL
    OR to_regclass('public.locations') IS NULL
    OR to_regclass('public.stock_areas') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.stock_import_staging') IS NULL
    OR to_regclass('public.product_variants') IS NULL
  THEN
    RAISE EXCEPTION 'STOP: Objek historis WMS tidak lengkap';
  END IF;
  IF to_regprocedure('public.wms_inbound_rack_recommendations(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'STOP: RPC V4.3N belum ada';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.wms_inbound_rack_recommendations(
  p_variant_id uuid,
  p_area_code text DEFAULT 'NORMAL'
)
RETURNS TABLE (
  location_id uuid,
  location_code text,
  location_name text,
  current_qty integer,
  last_used_at timestamptz,
  last_movement_no bigint,
  recommendation_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_area text := upper(btrim(coalesce(p_area_code,'')));
BEGIN
  SELECT p.role::text INTO v_role
  FROM public.profiles p WHERE p.id=v_user AND p.is_active=true;
  IF coalesce(v_role,'') NOT IN ('owner','admin','warehouse_manager','warehouse_staff') THEN
    RAISE EXCEPTION 'Akses ditolak: role tidak berhak melihat rekomendasi rak';
  END IF;
  IF p_variant_id IS NULL OR v_area NOT IN ('NORMAL','DEFECT','REJECT') THEN
    RAISE EXCEPTION 'SKU atau area QC tidak valid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id=p_variant_id) THEN
    RAISE EXCEPTION 'SKU tidak ditemukan';
  END IF;

  RETURN QUERY
  WITH balances AS (
    SELECT i.location_id, SUM(i.qty_on_hand)::bigint AS qty
    FROM public.inventory i
    WHERE i.variant_id=p_variant_id
    GROUP BY i.location_id
  ), history AS (
    SELECT DISTINCT ON (m.to_location_id)
      m.to_location_id AS dest_id,
      m.created_at AS last_dest_at,
      m.movement_no AS last_no
    FROM public.stock_movements m
    WHERE m.variant_id=p_variant_id AND m.to_location_id IS NOT NULL
      AND m.quantity > 0
    ORDER BY m.to_location_id, m.created_at DESC, m.movement_no DESC, m.id DESC
  ), candidates AS (
    SELECT l.id AS rack_id, l.code AS rack_code, l.name AS rack_name,
      GREATEST(coalesce(b.qty,0::bigint),0::bigint) AS qty,
      h.last_dest_at, h.last_no
    FROM public.locations l
    JOIN public.stock_areas sa ON sa.id=l.area_id
    LEFT JOIN balances b ON b.location_id=l.id
    LEFT JOIN history h ON h.dest_id=l.id
    WHERE l.is_active=true AND sa.is_active=true AND upper(sa.code)=v_area
      AND (coalesce(b.qty,0::bigint)>0 OR h.dest_id IS NOT NULL)
  )
  SELECT c.rack_id, c.rack_code, c.rack_name,
    least(c.qty,2147483647::bigint)::integer AS current_qty,
    c.last_dest_at, c.last_no,
    CASE WHEN c.qty>0 THEN 'CURRENT' ELSE 'HISTORY' END::text
  FROM candidates c
  ORDER BY CASE WHEN c.qty>0 THEN 0 ELSE 1 END,
    c.qty DESC, c.last_dest_at DESC NULLS LAST, c.rack_code, c.rack_id
  LIMIT 5;

  -- RETURN QUERY sets FOUND when at least one eligible current/history row exists.
  IF FOUND OR v_area <> 'NORMAL' THEN RETURN; END IF;

  -- Import fallback: exact normalized SKU and a uniquely matching active NORMAL rack.
  -- Ambiguous SKU/code or missing rack: return no suggestion, never guess.
  RETURN QUERY
  WITH target AS (
    SELECT upper(btrim(pv.sku)) AS sku_key
    FROM public.product_variants pv WHERE pv.id=p_variant_id
  ), unique_sku AS (
    SELECT t.sku_key FROM target t
    WHERE (SELECT count(*) FROM public.product_variants pv
           WHERE upper(btrim(pv.sku))=t.sku_key)=1
  ), import_codes AS (
    SELECT DISTINCT upper(btrim(st.normal_location)) AS rack_key
    FROM public.stock_import_staging st
    JOIN unique_sku u ON upper(btrim(st.sku))=u.sku_key
    WHERE nullif(btrim(st.normal_location),'') IS NOT NULL
  ), single_code AS (
    SELECT min(ic.rack_key) AS rack_key FROM import_codes ic HAVING count(*)=1
  ), matches AS (
    SELECT l.id AS rack_id,l.code AS rack_code,l.name AS rack_name
    FROM public.locations l
    JOIN public.stock_areas sa ON sa.id=l.area_id
    JOIN single_code sc ON upper(btrim(l.code))=sc.rack_key
    WHERE l.is_active=true AND sa.is_active=true AND upper(sa.code)='NORMAL'
  )
  SELECT m.rack_id,m.rack_code,m.rack_name,0::integer,
         NULL::timestamptz,NULL::bigint,'IMPORT'::text
  FROM matches m WHERE (SELECT count(*) FROM matches)=1;
END;
$function$;

REVOKE ALL ON FUNCTION public.wms_inbound_rack_recommendations(uuid,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wms_inbound_rack_recommendations(uuid,text)
TO authenticated;

DO $verify$
BEGIN
  IF has_function_privilege(
    'anon','public.wms_inbound_rack_recommendations(uuid,text)','EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated','public.wms_inbound_rack_recommendations(uuid,text)','EXECUTE'
  ) THEN
    RAISE EXCEPTION 'STOP: Hak akses RPC rekomendasi rak tidak tepat';
  END IF;
END;
$verify$;

COMMIT;

SELECT 'V4.3N.1 INSTALL' AS pemeriksaan,
  CASE WHEN has_function_privilege('authenticated','public.wms_inbound_rack_recommendations(uuid,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.wms_inbound_rack_recommendations(uuid,text)','EXECUTE')
    AND EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.wms_inbound_rack_recommendations(uuid,text)')
      AND prosecdef AND provolatile='s' AND position('IMPORT' in prosrc)>0)
    THEN 'PASS' ELSE 'STOP' END AS hasil;
