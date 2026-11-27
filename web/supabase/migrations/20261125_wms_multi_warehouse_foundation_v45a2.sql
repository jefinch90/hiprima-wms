-- HIPRIMA WMS V4.5A.2
-- MULTI-WAREHOUSE FOUNDATION
-- NO INVENTORY REPLACEMENT

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- =====================================
-- 1. PREFLIGHT
-- =====================================

DO $preflight$
BEGIN

    IF (
        SELECT COUNT(DISTINCT warehouse_id)
        FROM public.stock_areas
    ) <> 1 THEN
        RAISE EXCEPTION
            'STOP: Struktur gudang sudah berubah';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.warehouses
        WHERE id =
            '4ef17569-12cb-4684-8e0b-f1f29cd08833'::uuid
          AND is_active = true
    ) THEN
        RAISE EXCEPTION
            'STOP: Gudang utama tidak sesuai audit';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.warehouses
        WHERE id <>
            '4ef17569-12cb-4684-8e0b-f1f29cd08833'::uuid
          AND (
              is_active = true
              OR upper(trim(code)) = 'OFFLINE-STORE'
          )
    ) THEN
        RAISE EXCEPTION
            'STOP: Gudang kedua sudah tersedia';
    END IF;

    IF to_regclass(
        'public.wms_warehouse_config'
    ) IS NOT NULL THEN
        RAISE EXCEPTION
            'STOP: Foundation sudah tersedia';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM public.stock_areas
        WHERE warehouse_id =
            '4ef17569-12cb-4684-8e0b-f1f29cd08833'::uuid
          AND is_active = true
          AND area_type::text IN (
              'normal','defect','reject'
          )
    ) <> 3 THEN
        RAISE EXCEPTION
            'STOP: Area gudang utama tidak lengkap';
    END IF;

END;
$preflight$;

-- =====================================
-- 2. WAREHOUSE CONFIGURATION
-- =====================================

CREATE TABLE public.wms_warehouse_config (
    warehouse_key text PRIMARY KEY,

    warehouse_id uuid NOT NULL UNIQUE
        REFERENCES public.warehouses(id)
        ON DELETE RESTRICT,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT wms_warehouse_config_key_check
        CHECK (warehouse_key IN ('UTAMA','STORE'))
);

ALTER TABLE public.wms_warehouse_config
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wms_warehouse_config
FROM PUBLIC, anon, authenticated;

-- =====================================
-- 3. CREATE WAREHOUSE OFFLINE STORE
-- =====================================

DO $warehouse$
DECLARE
    v_main uuid :=
        '4ef17569-12cb-4684-8e0b-f1f29cd08833';

    v_store uuid;

BEGIN

    UPDATE public.warehouses
    SET
        name = 'Gudang Utama',
        updated_at = now()
    WHERE id = v_main;

    INSERT INTO public.warehouses (
        code,
        name,
        is_active
    )
    VALUES (
        'OFFLINE-STORE',
        'Gudang Offline Store',
        false
    )
    RETURNING id INTO v_store;

    INSERT INTO public.wms_warehouse_config (
        warehouse_key,
        warehouse_id
    )
    VALUES
        ('UTAMA',v_main),
        ('STORE',v_store);

    INSERT INTO public.stock_areas (
        warehouse_id,
        code,
        name,
        area_type,
        is_active
    )
    VALUES
        (
            v_store,
            'NORMAL',
            'Area Stok Normal',
            'normal',
            false
        ),
        (
            v_store,
            'DEFECT',
            'Area Stok Defect',
            'defect',
            false
        ),
        (
            v_store,
            'REJECT',
            'Area Stok Reject',
            'reject',
            false
        );

END;
$warehouse$;

-- =====================================
-- 4. WAREHOUSE LIST RPC
-- =====================================

CREATE FUNCTION public.wms_list_warehouses()
RETURNS TABLE (
    warehouse_key text,
    warehouse_id uuid,
    warehouse_code text,
    warehouse_name text,
    is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN

    PERFORM public.assert_wms_role(
        ARRAY[
            'owner',
            'admin',
            'warehouse_manager',
            'warehouse_staff',
            'viewer'
        ]::public.app_user_role[]
    );

    RETURN QUERY
    SELECT
        c.warehouse_key,
        w.id,
        w.code,
        w.name,
        w.is_active
    FROM public.wms_warehouse_config c
    JOIN public.warehouses w
        ON w.id = c.warehouse_id
    ORDER BY
        CASE c.warehouse_key
            WHEN 'UTAMA' THEN 1
            ELSE 2
        END;

END;
$function$;

REVOKE ALL ON FUNCTION public.wms_list_warehouses()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.wms_list_warehouses()
TO authenticated;

-- =====================================
-- 5. SECURITY HARDENING
-- =====================================

REVOKE TRUNCATE ON TABLE
    public.warehouses,
    public.stock_areas,
    public.locations,
    public.sales_channel_accounts,
    public.stock_import_staging,
    public.stock_opname_sessions,
    public.stock_opname_lines
FROM PUBLIC, anon, authenticated;

-- =====================================
-- 6. VERIFY FOUNDATION BEFORE COMMIT
-- =====================================

DO $verify$
DECLARE
    v_table text;
BEGIN

    IF (
        SELECT COUNT(*)
        FROM public.wms_warehouse_config
    ) <> 2 THEN
        RAISE EXCEPTION
            'FAIL: Konfigurasi gudang tidak lengkap';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM public.stock_areas a
        JOIN public.wms_warehouse_config c
            ON c.warehouse_id = a.warehouse_id
        WHERE c.warehouse_key = 'STORE'
          AND a.is_active = false
    ) <> 3 THEN
        RAISE EXCEPTION
            'FAIL: Area Offline Store tidak lengkap';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.wms_warehouse_config c
        JOIN public.warehouses w
            ON w.id = c.warehouse_id
        WHERE c.warehouse_key = 'STORE'
          AND w.is_active = true
    ) THEN
        RAISE EXCEPTION
            'FAIL: Gudang Store aktif terlalu awal';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.locations l
        JOIN public.stock_areas a
            ON a.id = l.area_id
        JOIN public.wms_warehouse_config c
            ON c.warehouse_id = a.warehouse_id
        WHERE c.warehouse_key = 'STORE'
    ) THEN
        RAISE EXCEPTION
            'FAIL: Store memiliki rak sebelum import';
    END IF;

    FOREACH v_table IN ARRAY ARRAY[
        'warehouses',
        'stock_areas',
        'locations',
        'sales_channel_accounts',
        'stock_import_staging',
        'stock_opname_sessions',
        'stock_opname_lines'
    ] LOOP

        IF has_table_privilege(
            'authenticated',
            'public.' || v_table,
            'TRUNCATE'
        ) OR has_table_privilege(
            'anon',
            'public.' || v_table,
            'TRUNCATE'
        ) THEN
            RAISE EXCEPTION
                'FAIL: TRUNCATE masih terbuka pada %',
                v_table;
        END IF;

    END LOOP;

    IF has_function_privilege(
        'anon',
        'public.wms_list_warehouses()',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'authenticated',
        'public.wms_list_warehouses()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'FAIL: Hak akses warehouse RPC';
    END IF;

END;
$verify$;

COMMIT;

-- =====================================
-- 7. FINAL REPORT
-- =====================================

WITH report AS (

    SELECT
        1 AS nomor,
        'FOUNDATION' AS pemeriksaan,
        'PASS' AS status,
        'V4.5A.2 MULTI-WAREHOUSE INSTALLED' AS detail

    UNION ALL

    SELECT
        2,
        c.warehouse_key,
        CASE WHEN w.is_active
             THEN 'ACTIVE'
             ELSE 'INACTIVE'
        END,
        w.name
    FROM public.wms_warehouse_config c
    JOIN public.warehouses w
        ON w.id = c.warehouse_id

    UNION ALL

    SELECT
        3,
        'AREA - ' || c.warehouse_key,
        'INFO',
        COUNT(a.id)::text
    FROM public.wms_warehouse_config c
    LEFT JOIN public.stock_areas a
        ON a.warehouse_id = c.warehouse_id
    GROUP BY c.warehouse_key

    UNION ALL

    SELECT
        4,
        'STOK - ' || c.warehouse_key,
        'INFO',
        COALESCE(SUM(i.qty_on_hand),0)::text
    FROM public.wms_warehouse_config c
    LEFT JOIN public.stock_areas a
        ON a.warehouse_id = c.warehouse_id
    LEFT JOIN public.locations l
        ON l.area_id = a.id
    LEFT JOIN public.inventory i
        ON i.location_id = l.id
    GROUP BY c.warehouse_key

    UNION ALL

    SELECT
        5,'TOTAL STOK','INFO',
        COALESCE(SUM(qty_on_hand),0)::text
    FROM public.inventory

    UNION ALL

    SELECT
        6,'TOTAL SKU','INFO',COUNT(*)::text
    FROM public.product_variants

    UNION ALL

    SELECT
        7,'TOTAL MOVEMENT','INFO',COUNT(*)::text
    FROM public.stock_movements

    UNION ALL

    SELECT
        8,'TOTAL RAK','INFO',COUNT(*)::text
    FROM public.locations

)

SELECT *
FROM report
ORDER BY nomor,pemeriksaan;