-- Hi.PRIMA WMS V4.3N - rekomendasi rak berdasarkan stok aktif dan histori.
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
  THEN
    RAISE EXCEPTION 'STOP: Objek historis WMS tidak lengkap';
  END IF;
  IF to_regprocedure('public.wms_inbound_rack_recommendations(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: RPC rekomendasi rak sudah ada; audit sebelum mengulang';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.wms_inbound_rack_recommendations(
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
