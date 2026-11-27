-- HIPRIMA WMS V4.5B.2A
-- CHANNEL ALIASES + WAREHOUSE INVENTORY FILTER

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.wms_sale_warehouse_key(
    p_channel text
)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT CASE
        regexp_replace(
            lower(trim(coalesce(p_channel,''))),
            '[^a-z0-9]','','g'
        )
        WHEN 'tiktokshop' THEN 'UTAMA'
        WHEN 'shopee' THEN 'UTAMA'
        WHEN 'tokopedia' THEN 'UTAMA'
        WHEN 'lazada' THEN 'UTAMA'
        WHEN 'website' THEN 'UTAMA'
        WHEN 'whatsapp' THEN 'UTAMA'
        WHEN 'bazar' THEN 'UTAMA'
        WHEN 'bazaar' THEN 'UTAMA'
        WHEN 'bazarevent' THEN 'UTAMA'
        WHEN 'bazaarevent' THEN 'UTAMA'
        WHEN 'wholesalereseller' THEN 'UTAMA'
        WHEN 'wholesale' THEN 'UTAMA'
        WHEN 'reseller' THEN 'UTAMA'
        WHEN 'other' THEN 'UTAMA'
        WHEN 'offlinestore' THEN 'STORE'
        ELSE NULL
    END;
$fn$;

REVOKE ALL ON FUNCTION
    public.wms_sale_warehouse_key(text)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.wms_inventory_by_warehouse(
    p_warehouse_id uuid,
    p_search text,
    p_limit integer,
    p_offset integer
)
RETURNS TABLE(
    variant_id uuid,
    sku text,
    product_code text,
    product_name text,
    brand text,
    color text,
    size text,
    barcode text,
    normal_qty bigint,
    defect_qty bigint,
    reject_qty bigint,
    total_qty bigint,
    normal_locations text,
    defect_locations text,
    reject_locations text,
    total_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$

    WITH balances AS (
        SELECT
            i.variant_id,
            a.area_type::text AS qc,
            w.name || ' / ' || l.code AS rack,
            sum(i.qty_on_hand)::bigint AS qty
        FROM public.inventory i
        JOIN public.locations l
            ON l.id=i.location_id
        JOIN public.stock_areas a
            ON a.id=l.area_id
        JOIN public.warehouses w
            ON w.id=a.warehouse_id
        WHERE p_warehouse_id IS NULL
           OR w.id=p_warehouse_id
        GROUP BY
            i.variant_id,a.area_type,w.name,l.code
    ),
    result AS (
        SELECT
            pv.id AS variant_id,
            pv.sku,
            p.product_code,
            p.name AS product_name,
            p.brand,
            pv.color,
            pv.size,
            pv.barcode,
            coalesce(sum(b.qty) FILTER(
                WHERE b.qc='normal'),0)::bigint AS normal_qty,
            coalesce(sum(b.qty) FILTER(
                WHERE b.qc='defect'),0)::bigint AS defect_qty,
            coalesce(sum(b.qty) FILTER(
                WHERE b.qc='reject'),0)::bigint AS reject_qty,
            coalesce(sum(b.qty),0)::bigint AS total_qty,
            string_agg(
                b.rack || ' - ' || b.qty || ' pcs',
                ', ' ORDER BY b.rack
            ) FILTER (
                WHERE b.qc='normal' AND b.qty<>0
            ) AS normal_locations,
            string_agg(
                b.rack || ' - ' || b.qty || ' pcs',
                ', ' ORDER BY b.rack
            ) FILTER (
                WHERE b.qc='defect' AND b.qty<>0
            ) AS defect_locations,
            string_agg(
                b.rack || ' - ' || b.qty || ' pcs',
                ', ' ORDER BY b.rack
            ) FILTER (
                WHERE b.qc='reject' AND b.qty<>0
            ) AS reject_locations
        FROM public.product_variants pv
        JOIN public.products p
            ON p.id=pv.product_id
        LEFT JOIN balances b
            ON b.variant_id=pv.id
        WHERE coalesce(trim(p_search),'')=''
           OR pv.sku ILIKE '%'||trim(p_search)||'%'
           OR p.product_code ILIKE '%'||trim(p_search)||'%'
           OR p.name ILIKE '%'||trim(p_search)||'%'
           OR coalesce(pv.color,'') ILIKE '%'||trim(p_search)||'%'
        GROUP BY
            pv.id,pv.sku,p.product_code,p.name,p.brand,
            pv.color,pv.size,pv.barcode
    )

    SELECT r.*,count(*) OVER()::bigint
    FROM result r
    ORDER BY r.product_name,r.sku
    LIMIT greatest(p_limit,1)
    OFFSET greatest(p_offset,0);

$fn$;

CREATE FUNCTION public.wms_valuation_by_warehouse(
    p_warehouse_id uuid
)
RETURNS TABLE(
    normal_qty bigint,
    defect_qty bigint,
    reject_qty bigint,
    total_qty bigint,
    normal_inventory_value_hpp numeric,
    defect_inventory_value_hpp numeric,
    reject_inventory_value_hpp numeric,
    total_inventory_value_hpp numeric,
    potential_sales_value numeric,
    potential_gross_profit numeric,
    margin_pct numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$

    WITH stock AS (
        SELECT
            a.area_type::text AS qc,
            i.qty_on_hand AS qty,
            coalesce(pv.hpp,0) AS hpp,
            coalesce(pv.selling_price,0) AS price
        FROM public.inventory i
        JOIN public.locations l
            ON l.id=i.location_id
        JOIN public.stock_areas a
            ON a.id=l.area_id
        JOIN public.product_variants pv
            ON pv.id=i.variant_id
        WHERE p_warehouse_id IS NULL
           OR a.warehouse_id=p_warehouse_id
    ),
    totals AS (
        SELECT
            coalesce(sum(qty) FILTER(
                WHERE qc='normal'),0)::bigint AS nq,
            coalesce(sum(qty) FILTER(
                WHERE qc='defect'),0)::bigint AS dq,
            coalesce(sum(qty) FILTER(
                WHERE qc='reject'),0)::bigint AS rq,
            coalesce(sum(qty),0)::bigint AS tq,
            coalesce(sum(qty*hpp) FILTER(
                WHERE qc='normal'),0)::numeric AS nv,
            coalesce(sum(qty*hpp) FILTER(
                WHERE qc='defect'),0)::numeric AS dv,
            coalesce(sum(qty*hpp) FILTER(
                WHERE qc='reject'),0)::numeric AS rv,
            coalesce(sum(qty*hpp),0)::numeric AS tv,
            coalesce(sum(qty*price) FILTER(
                WHERE qc='normal'),0)::numeric AS ps,
            coalesce(sum(qty*(price-hpp)) FILTER(
                WHERE qc='normal'),0)::numeric AS gp
        FROM stock
    )
    SELECT nq,dq,rq,tq,nv,dv,rv,tv,ps,gp,
        CASE WHEN ps>0
            THEN round(gp/ps*100,2)
            ELSE NULL::numeric
        END
    FROM totals;

$fn$;

REVOKE ALL ON FUNCTION
    public.wms_inventory_by_warehouse(uuid,text,integer,integer),
    public.wms_valuation_by_warehouse(uuid)
FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION
    public.wms_inventory_by_warehouse(uuid,text,integer,integer),
    public.wms_valuation_by_warehouse(uuid)
TO authenticated;

-- AUTOMATED VERIFICATION

DO $verify$
DECLARE
    v_main uuid;
    v_store uuid;
    v_all record;
    v_a record;
    v_b record;
    v_old record;
    v_list_total numeric;
BEGIN

    SELECT warehouse_id INTO STRICT v_main
    FROM public.wms_warehouse_config
    WHERE warehouse_key='UTAMA';

    SELECT warehouse_id INTO STRICT v_store
    FROM public.wms_warehouse_config
    WHERE warehouse_key='STORE';

    IF public.wms_sale_warehouse_key('Bazaar/Event')
        IS DISTINCT FROM 'UTAMA'
    OR public.wms_sale_warehouse_key('Wholesale/Reseller')
        IS DISTINCT FROM 'UTAMA'
    OR public.wms_sale_warehouse_key('Other')
        IS DISTINCT FROM 'UTAMA'
    OR public.wms_sale_warehouse_key('Offline Store')
        IS DISTINCT FROM 'STORE'
    OR public.wms_sale_warehouse_key('POS')
        IS NOT NULL
    THEN
        RAISE EXCEPTION 'FAIL: Channel routing';
    END IF;

    SELECT * INTO v_all
    FROM public.wms_valuation_by_warehouse(NULL);

    SELECT * INTO v_a
    FROM public.wms_valuation_by_warehouse(v_main);

    SELECT * INTO v_b
    FROM public.wms_valuation_by_warehouse(v_store);

    SELECT * INTO v_old
    FROM public.get_inventory_valuation_summary();

    IF to_jsonb(v_all) IS DISTINCT FROM to_jsonb(v_old)
    THEN
        RAISE EXCEPTION 'FAIL: Valuation differs from previous version';
    END IF;

    IF v_all.total_qty <>
        v_a.total_qty+v_b.total_qty
    OR v_all.total_inventory_value_hpp <>
        v_a.total_inventory_value_hpp+
        v_b.total_inventory_value_hpp
    THEN
        RAISE EXCEPTION 'FAIL: Warehouse reconciliation';
    END IF;

    SELECT coalesce(sum(total_qty),0)
    INTO v_list_total
    FROM public.wms_inventory_by_warehouse(
        NULL,NULL,100000,0
    );

    IF v_list_total <> v_all.total_qty THEN
        RAISE EXCEPTION 'FAIL: Inventory list reconciliation';
    END IF;

END;
$verify$;

COMMIT;

SELECT
    'V4.5B.2A BACKEND' AS pemeriksaan,
    'PASS' AS status,
    'Routing aliases dan inventory filter' AS detail

UNION ALL

SELECT
    c.warehouse_key,
    'PASS',
    'STOK = ' || v.total_qty::text
FROM public.wms_warehouse_config c
CROSS JOIN LATERAL
    public.wms_valuation_by_warehouse(c.warehouse_id) v

UNION ALL

SELECT
    'TOTAL STOK','INFO',
    coalesce(sum(qty_on_hand),0)::text
FROM public.inventory

UNION ALL

SELECT
    'TOTAL MOVEMENT','INFO',count(*)::text
FROM public.stock_movements;