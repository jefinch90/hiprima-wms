-- HIPRIMA WMS V4.5B.1
-- SALES CHANNEL WAREHOUSE ROUTING

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 1. Validasi foundation

DO $preflight$
BEGIN
    IF (
        SELECT count(*)
        FROM public.wms_warehouse_config
        WHERE warehouse_key IN ('UTAMA','STORE')
    ) <> 2 THEN
        RAISE EXCEPTION 'STOP: Foundation belum lengkap';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.wms_warehouse_config c
        JOIN public.warehouses w
            ON w.id = c.warehouse_id
        WHERE c.warehouse_key = 'STORE'
          AND w.is_active = false
    ) THEN
        RAISE EXCEPTION 'STOP: Store harus belum aktif';
    END IF;
END;
$preflight$;

-- 2. Mapping sales channel

CREATE FUNCTION public.wms_sale_warehouse_key(
    p_channel text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
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
        WHEN 'offlinestore' THEN 'STORE'
        ELSE NULL
    END;
$function$;

REVOKE ALL ON FUNCTION
    public.wms_sale_warehouse_key(text)
FROM PUBLIC, anon, authenticated;

-- 3. Warehouse routing RPC untuk frontend

CREATE FUNCTION public.wms_resolve_sales_warehouse(
    p_sales_channel text
)
RETURNS TABLE(
    warehouse_key text,
    warehouse_id uuid,
    warehouse_name text,
    is_active boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_key text;
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY[
            'owner','admin',
            'warehouse_manager','warehouse_staff'
        ]::public.app_user_role[]
    );

    v_key := public.wms_sale_warehouse_key(
        p_sales_channel
    );

    IF v_key IS NULL THEN
        RAISE EXCEPTION
            'Sales Channel belum memiliki routing gudang';
    END IF;

    RETURN QUERY
    SELECT
        c.warehouse_key,
        w.id,
        w.name,
        w.is_active
    FROM public.wms_warehouse_config c
    JOIN public.warehouses w
        ON w.id = c.warehouse_id
    WHERE c.warehouse_key = v_key;
END;
$function$;

REVOKE ALL ON FUNCTION
    public.wms_resolve_sales_warehouse(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.wms_resolve_sales_warehouse(text)
TO authenticated;

-- 4. Validasi lokasi outbound di backend

CREATE FUNCTION public.wms_assert_outbound_location(
    p_location_id uuid,
    p_transaction_type text,
    p_sales_channel text
)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_source uuid;
    v_expected uuid;
    v_key text;
BEGIN

    SELECT w.id INTO v_source
    FROM public.locations l
    JOIN public.stock_areas a
        ON a.id = l.area_id
    JOIN public.warehouses w
        ON w.id = a.warehouse_id
    WHERE l.id = p_location_id
      AND l.is_active
      AND a.is_active
      AND w.is_active
      AND a.area_type = 'normal';

    IF v_source IS NULL THEN
        RAISE EXCEPTION
            'Gudang, area atau rak asal tidak aktif';
    END IF;

    IF lower(trim(p_transaction_type)) = 'sale' THEN

        v_key := public.wms_sale_warehouse_key(
            p_sales_channel
        );

        IF v_key IS NULL THEN
            RAISE EXCEPTION
                'Sales Channel belum memiliki routing gudang';
        END IF;

        SELECT c.warehouse_id INTO v_expected
        FROM public.wms_warehouse_config c
        WHERE c.warehouse_key = v_key;

        IF v_source IS DISTINCT FROM v_expected THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'Gudang tidak sesuai Sales Channel';
        END IF;

    END IF;

END;
$function$;

REVOKE ALL ON FUNCTION
    public.wms_assert_outbound_location(uuid,text,text)
FROM PUBLIC, anon, authenticated;

-- 5. Pasang guard pada RPC outbound aktual.
-- Pertahankan business logic sebelumnya.

DO $patch$
DECLARE
    v_oid oid;
    v_def text;
    v_anchor text := '  -- LOCK SOURCE INVENTORY';
    v_guard text :=
        '  PERFORM public.wms_assert_outbound_location(' ||
        'p_from_location_id, v_transaction_type, v_sales_channel);';
BEGIN

    v_oid := to_regprocedure(
        'public.post_outbound_transaction(uuid,uuid,integer,text,text,text,numeric,text)'
    );

    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'STOP: RPC outbound tidak ditemukan';
    END IF;

    SELECT pg_get_functiondef(v_oid)
    INTO v_def;

    IF position('assert_wms_role' IN v_def) = 0
       OR position('wms_assert_outbound_location' IN v_def) > 0
       OR (
           length(v_def) -
           length(replace(v_def,v_anchor,''))
       ) <> length(v_anchor)
    THEN
        RAISE EXCEPTION 'STOP: Definisi outbound tidak sesuai';
    END IF;

    v_def := replace(
        v_def,
        v_anchor,
        v_guard || chr(10) || chr(10) || v_anchor
    );

    EXECUTE v_def;

END;
$patch$;

-- 6. RPC pemilihan rak per sales channel

CREATE FUNCTION public.wms_get_outbound_source_locations(
    p_variant_id uuid,
    p_transaction_type text,
    p_sales_channel text
)
RETURNS TABLE(
    location_id uuid,
    location_code text,
    location_name text,
    area_code text,
    area_name text,
    qty_on_hand integer,
    warehouse_key text,
    warehouse_id uuid,
    warehouse_name text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_type text;
    v_key text;
BEGIN

    PERFORM public.assert_wms_role(
        ARRAY[
            'owner','admin',
            'warehouse_manager','warehouse_staff'
        ]::public.app_user_role[]
    );

    v_type := lower(trim(
        coalesce(p_transaction_type,'')
    ));

    IF v_type NOT IN (
        'sale','sample','giveaway','internal_use','other'
    ) THEN
        RAISE EXCEPTION 'Transaction Type tidak valid';
    END IF;

    IF v_type = 'sale' THEN
        v_key := public.wms_sale_warehouse_key(
            p_sales_channel
        );

        IF v_key IS NULL THEN
            RAISE EXCEPTION
                'Sales Channel belum memiliki routing gudang';
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        l.id,
        l.code,
        l.name,
        a.code,
        a.name,
        i.qty_on_hand,
        c.warehouse_key,
        w.id,
        w.name
    FROM public.inventory i
    JOIN public.locations l
        ON l.id = i.location_id
    JOIN public.stock_areas a
        ON a.id = l.area_id
    JOIN public.warehouses w
        ON w.id = a.warehouse_id
    JOIN public.wms_warehouse_config c
        ON c.warehouse_id = w.id
    WHERE i.variant_id = p_variant_id
      AND i.qty_on_hand > 0
      AND l.is_active
      AND a.is_active
      AND w.is_active
      AND a.area_type = 'normal'
      AND (
          v_type <> 'sale'
          OR c.warehouse_key = v_key
      )
    ORDER BY c.warehouse_key,l.code;

END;
$function$;

REVOKE ALL ON FUNCTION
    public.wms_get_outbound_source_locations(uuid,text,text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.wms_get_outbound_source_locations(uuid,text,text)
TO authenticated;

-- 7. Automated routing and security tests

DO $verify$
DECLARE
    r record;
    v_staff uuid;
    v_variant uuid;
    v_rack uuid;
BEGIN

    FOR r IN
        SELECT * FROM (
            VALUES
                ('TikTok Shop','UTAMA'),
                ('Shopee','UTAMA'),
                ('Tokopedia','UTAMA'),
                ('Lazada','UTAMA'),
                ('Website','UTAMA'),
                ('WhatsApp','UTAMA'),
                ('Bazar','UTAMA'),
                ('Offline Store','STORE'),
                ('offline_store','STORE'),
                ('POS',NULL),
                ('Unknown',NULL)
        ) AS x(channel,expected)
    LOOP

        IF public.wms_sale_warehouse_key(r.channel)
           IS DISTINCT FROM r.expected
        THEN
            RAISE EXCEPTION
                'FAIL: Routing %',r.channel;
        END IF;

    END LOOP;

    SELECT id INTO v_staff
    FROM public.profiles
    WHERE role::text = 'warehouse_staff'
      AND is_active
    ORDER BY id
    LIMIT 1;

    SELECT i.variant_id,l.id
    INTO v_variant,v_rack
    FROM public.inventory i
    JOIN public.locations l
        ON l.id = i.location_id
    JOIN public.stock_areas a
        ON a.id = l.area_id
    JOIN public.wms_warehouse_config c
        ON c.warehouse_id = a.warehouse_id
    WHERE i.qty_on_hand > 0
      AND l.is_active
      AND a.is_active
      AND a.area_type = 'normal'
      AND c.warehouse_key = 'UTAMA'
    ORDER BY i.qty_on_hand DESC
    LIMIT 1;

    IF v_staff IS NULL OR v_variant IS NULL THEN
        RAISE EXCEPTION
            'STOP: Data pengujian tidak tersedia';
    END IF;

    PERFORM set_config(
        'request.jwt.claim.sub',
        v_staff::text,true
    );

    PERFORM set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',v_staff,
            'role','authenticated'
        )::text,true
    );

    EXECUTE 'SET LOCAL ROLE authenticated';

    -- Store belum aktif: tidak boleh ada rak Store.

    IF EXISTS (
        SELECT 1
        FROM public.wms_get_outbound_source_locations(
            v_variant,'sale','Offline Store'
        )
    ) THEN
        RAISE EXCEPTION
            'FAIL: Rak Store tersedia sebelum aktif';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.wms_get_outbound_source_locations(
            v_variant,'sale','Shopee'
        )
        WHERE location_id = v_rack
          AND warehouse_key = 'UTAMA'
    ) THEN
        RAISE EXCEPTION
            'FAIL: Rak Utama tidak ditemukan';
    END IF;

    -- Penjualan Offline Store tidak boleh
    -- mengurangi stok Gudang Utama.
    -- Subtransaksi selalu batal jika terjadi error.

    BEGIN

        PERFORM 1
        FROM public.post_outbound_transaction(
            v_variant,
            v_rack,
            1,
            'AUTO-V45B1-' || gen_random_uuid()::text,
            'sale',
            'Offline Store',
            0,
            NULL
        );

        RAISE EXCEPTION
            'FAIL: Penjualan dari gudang salah diterima';

    EXCEPTION WHEN insufficient_privilege THEN

        IF SQLERRM <> 'Gudang tidak sesuai Sales Channel'
        THEN
            RAISE;
        END IF;

    END;

    EXECUTE 'RESET ROLE';

    IF has_function_privilege(
        'authenticated',
        'public.wms_assert_outbound_location(uuid,text,text)',
        'EXECUTE'
    )
    OR has_function_privilege(
        'anon',
        'public.wms_resolve_sales_warehouse(text)',
        'EXECUTE'
    )
    OR has_function_privilege(
        'anon',
        'public.wms_get_outbound_source_locations(uuid,text,text)',
        'EXECUTE'
    )
    THEN
        RAISE EXCEPTION 'FAIL: Warehouse RPC security';
    END IF;

END;
$verify$;

COMMIT;

-- 8. Final report

SELECT
    'ROUTING INSTALLED' AS pemeriksaan,
    CASE WHEN position(
        'wms_assert_outbound_location' IN
        pg_get_functiondef(
            'public.post_outbound_transaction(uuid,uuid,integer,text,text,text,numeric,text)'::regprocedure
        )
    ) > 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    'V4.5B.1' AS detail

UNION ALL

SELECT
    x.channel,
    CASE WHEN public.wms_sale_warehouse_key(x.channel)
        IS NOT DISTINCT FROM x.expected
        THEN 'PASS' ELSE 'FAIL' END,
    coalesce(
        public.wms_sale_warehouse_key(x.channel),
        'DITOLAK'
    )
FROM (
    VALUES
        ('TikTok Shop','UTAMA'),
        ('Shopee','UTAMA'),
        ('Tokopedia','UTAMA'),
        ('Lazada','UTAMA'),
        ('Website','UTAMA'),
        ('WhatsApp','UTAMA'),
        ('Bazar','UTAMA'),
        ('Offline Store','STORE'),
        ('POS',NULL)
) AS x(channel,expected)

UNION ALL

SELECT 'TOTAL STOK','INFO',
    coalesce(sum(qty_on_hand),0)::text
FROM public.inventory

UNION ALL

SELECT 'TOTAL MOVEMENT','INFO',count(*)::text
FROM public.stock_movements;