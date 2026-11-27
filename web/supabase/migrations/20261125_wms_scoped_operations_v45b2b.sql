-- HIPRIMA WMS V4.5B.2B
-- WAREHOUSE SCOPED OPERATIONS
-- NO STOCK REPLACEMENT

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION public.wms_assert_warehouse_active(
    p_warehouse_id uuid
)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.warehouses w
        JOIN public.wms_warehouse_config c
            ON c.warehouse_id=w.id
        WHERE w.id=p_warehouse_id
          AND w.is_active
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE='22023',
            MESSAGE='Gudang tidak tersedia atau belum aktif';
    END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION
    public.wms_assert_warehouse_active(uuid)
FROM PUBLIC,anon,authenticated;

-- =====================================
-- SHARED RACK QUERY
-- =====================================

CREATE FUNCTION public.wms_scoped_racks(
    p_warehouse_id uuid,
    p_variant_id uuid,
    p_area_code text DEFAULT NULL,
    p_positive_only boolean DEFAULT false
)
RETURNS TABLE(
    location_id uuid,
    location_code text,
    location_name text,
    area_code text,
    area_name text,
    current_qty integer,
    qty_on_hand integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY[
            'owner','admin',
            'warehouse_manager','warehouse_staff'
        ]::public.app_user_role[]
    );

    PERFORM public.wms_assert_warehouse_active(
        p_warehouse_id
    );

    IF p_variant_id IS NULL THEN
        RAISE EXCEPTION 'SKU wajib dipilih';
    END IF;

    IF p_area_code IS NOT NULL
       AND upper(trim(p_area_code))
           NOT IN ('NORMAL','DEFECT','REJECT')
    THEN
        RAISE EXCEPTION 'Area QC tidak valid';
    END IF;

    RETURN QUERY
    SELECT
        l.id,l.code,l.name,a.code,a.name,
        coalesce(i.qty_on_hand,0)::integer,
        coalesce(i.qty_on_hand,0)::integer
    FROM public.locations l
    JOIN public.stock_areas a
        ON a.id=l.area_id
    LEFT JOIN public.inventory i
        ON i.location_id=l.id
       AND i.variant_id=p_variant_id
    WHERE a.warehouse_id=p_warehouse_id
      AND a.is_active
      AND l.is_active
      AND (
          p_area_code IS NULL
          OR upper(a.area_type::text)=upper(trim(p_area_code))
      )
      AND (
          NOT p_positive_only
          OR coalesce(i.qty_on_hand,0)>0
      )
    ORDER BY a.code,l.code;
END;
$fn$;

-- =====================================
-- SMART RACK BY WAREHOUSE
-- =====================================

CREATE FUNCTION public.wms_rack_tips_scoped(
    p_warehouse_id uuid,
    p_variant_id uuid,
    p_area_code text DEFAULT 'NORMAL'
)
RETURNS TABLE(
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
AS $fn$
BEGIN
    RETURN QUERY
    WITH racks AS (
        SELECT *
        FROM public.wms_scoped_racks(
            p_warehouse_id,
            p_variant_id,
            p_area_code,
            false
        )
    ),
    history AS (
        SELECT DISTINCT ON (m.to_location_id)
            m.to_location_id,
            m.created_at,
            m.movement_no
        FROM public.stock_movements m
        JOIN racks r
            ON r.location_id=m.to_location_id
        WHERE m.variant_id=p_variant_id
          AND m.quantity>0
        ORDER BY m.to_location_id,
            m.created_at DESC,m.movement_no DESC
    )
    SELECT
        r.location_id,
        r.location_code,
        r.location_name,
        r.current_qty,
        h.created_at,
        h.movement_no,
        CASE WHEN r.current_qty>0
            THEN 'CURRENT'
            ELSE 'HISTORY'
        END::text
    FROM racks r
    LEFT JOIN history h
        ON h.to_location_id=r.location_id
    WHERE r.current_qty>0
       OR h.to_location_id IS NOT NULL
    ORDER BY
        CASE WHEN r.current_qty>0 THEN 0 ELSE 1 END,
        r.current_qty DESC,
        h.created_at DESC NULLS LAST,
        r.location_code
    LIMIT 5;
END;
$fn$;

-- =====================================
-- MOVEMENT ACTIVE LOCATION GUARD
-- =====================================

CREATE FUNCTION public.wms_guard_movement_location()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_location uuid;
BEGIN
    FOREACH v_location IN ARRAY ARRAY[
        NEW.from_location_id,
        NEW.to_location_id
    ] LOOP

        IF v_location IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM public.locations l
               JOIN public.stock_areas a
                   ON a.id=l.area_id
               JOIN public.warehouses w
                   ON w.id=a.warehouse_id
               JOIN public.wms_warehouse_config c
                   ON c.warehouse_id=w.id
               WHERE l.id=v_location
                 AND l.is_active
                 AND a.is_active
                 AND w.is_active
           )
        THEN
            RAISE EXCEPTION
                'Movement ditolak: lokasi atau gudang tidak aktif';
        END IF;

    END LOOP;

    RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION
    public.wms_guard_movement_location()
FROM PUBLIC,anon,authenticated;

CREATE TRIGGER wms_guard_movement_location
BEFORE INSERT ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.wms_guard_movement_location();

-- =====================================
-- INBOUND: ONE DOCUMENT ONE WAREHOUSE
-- =====================================

ALTER TABLE public.wms_inbound_documents
ADD COLUMN warehouse_id uuid
REFERENCES public.warehouses(id)
ON DELETE RESTRICT;

CREATE FUNCTION public.wms_guard_inbound_warehouse()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_count bigint;
    v_valid bigint;
    v_warehouses bigint;
    v_id uuid;
BEGIN

    SELECT
        count(*),
        count(c.warehouse_id),
        count(DISTINCT c.warehouse_id),
        (array_agg(DISTINCT c.warehouse_id))[1]
    INTO v_count,v_valid,v_warehouses,v_id

    FROM jsonb_array_elements(NEW.request_lines) AS ln(item)
    CROSS JOIN LATERAL
        jsonb_array_elements(ln.item->'items') AS qc(item)

    LEFT JOIN public.locations l
        ON l.id=(qc.item->>'location_id')::uuid
       AND l.is_active

    LEFT JOIN public.stock_areas a
        ON a.id=l.area_id AND a.is_active

    LEFT JOIN public.warehouses w
        ON w.id=a.warehouse_id AND w.is_active

    LEFT JOIN public.wms_warehouse_config c
        ON c.warehouse_id=w.id;

    IF v_count=0
       OR v_count<>v_valid
       OR v_warehouses<>1
    THEN
        RAISE EXCEPTION
            'Inbound wajib menggunakan satu gudang aktif';
    END IF;

    NEW.warehouse_id := v_id;
    RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION
    public.wms_guard_inbound_warehouse()
FROM PUBLIC,anon,authenticated;

CREATE TRIGGER wms_guard_inbound_warehouse
BEFORE INSERT ON public.wms_inbound_documents
FOR EACH ROW
EXECUTE FUNCTION public.wms_guard_inbound_warehouse();

-- =====================================
-- STOCK OPNAME LOCATIONS
-- =====================================

CREATE FUNCTION public.wms_stock_opname_locations_scoped(
    p_warehouse_id uuid
)
RETURNS TABLE(
    location_id uuid,
    location_code text,
    location_name text,
    area_code text,
    area_name text,
    total_sku bigint,
    total_qty bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN

    PERFORM public.assert_wms_role(
        ARRAY[
            'owner','admin',
            'warehouse_manager','warehouse_staff'
        ]::public.app_user_role[]
    );

    PERFORM public.wms_assert_warehouse_active(
        p_warehouse_id
    );

    RETURN QUERY
    SELECT
        l.id,l.code,l.name,a.code,a.name,
        count(DISTINCT i.variant_id)
            FILTER (WHERE i.qty_on_hand>0),
        coalesce(sum(i.qty_on_hand),0)::bigint
    FROM public.locations l
    JOIN public.stock_areas a
        ON a.id=l.area_id
    LEFT JOIN public.inventory i
        ON i.location_id=l.id
    WHERE a.warehouse_id=p_warehouse_id
      AND a.is_active AND l.is_active
    GROUP BY l.id,l.code,l.name,a.code,a.name
    ORDER BY
        CASE upper(a.code)
            WHEN 'NORMAL' THEN 1
            WHEN 'DEFECT' THEN 2
            ELSE 3
        END,l.code;

END;
$fn$;

-- =====================================
-- SCOPED STOCK OPNAME SESSION
-- PRESERVE EXISTING BUSINESS LOGIC
-- =====================================

ALTER TABLE public.stock_opname_sessions
ADD COLUMN warehouse_id uuid
REFERENCES public.warehouses(id)
ON DELETE RESTRICT;

DO $patch$
DECLARE
    v_def text;
    v_anchor text;
BEGIN

    SELECT pg_get_functiondef(
        'public.create_stock_opname_session(text,uuid[],text)'::regprocedure
    ) INTO v_def;

    v_anchor :=
        'FUNCTION public.create_stock_opname_session(';

    IF position(v_anchor IN v_def)=0
       OR position('assert_wms_role' IN v_def)=0
       OR (
           length(v_def)-
           length(replace(v_def,'l.is_active = true',''))
       ) <> 2*length('l.is_active = true')
       OR (
           length(v_def)-
           length(replace(v_def,'v_type :=',''))
       ) <> length('v_type :=')
       OR (
           length(v_def)-
           length(replace(v_def,'session_code =',''))
       ) <> length('session_code =')
    THEN
        RAISE EXCEPTION
            'STOP: Definisi stock opname berbeda dari audit';
    END IF;

    v_def := replace(
        v_def,
        v_anchor,
        'FUNCTION public.wms_create_stock_opname_scoped(p_warehouse_id uuid, '
    );

    v_def := replace(
        v_def,
        'v_type :=',
        'PERFORM public.wms_assert_warehouse_active(p_warehouse_id);'
        || chr(10) || '  v_type :='
    );

    v_def := replace(
        v_def,
        'l.is_active = true',
        'l.is_active = true AND EXISTS (
            SELECT 1 FROM public.stock_areas wa
            WHERE wa.id=l.area_id
              AND wa.is_active=true
              AND wa.warehouse_id=p_warehouse_id
        )'
    );

    v_def := replace(
        v_def,
        'session_code =',
        'warehouse_id = p_warehouse_id, session_code ='
    );

    EXECUTE v_def;

END;
$patch$;

-- Legacy frontend: compatible while only one warehouse active.
-- Once both warehouses are active, explicit selection is required.

CREATE OR REPLACE FUNCTION public.create_stock_opname_session(
    p_opname_type text,
    p_location_ids uuid[] DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS TABLE(
    session_id uuid,
    session_code text,
    total_locations bigint,
    total_lines bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_id uuid;
BEGIN

    PERFORM public.assert_wms_role(
        ARRAY[
            'owner','admin',
            'warehouse_manager','warehouse_staff'
        ]::public.app_user_role[]
    );

    IF (
        SELECT count(*)
        FROM public.wms_warehouse_config c
        JOIN public.warehouses w ON w.id=c.warehouse_id
        WHERE w.is_active
    ) <> 1 THEN
        RAISE EXCEPTION
            'Pilih gudang melalui versi WMS Multi-Warehouse';
    END IF;

    SELECT w.id INTO STRICT v_id
    FROM public.wms_warehouse_config c
    JOIN public.warehouses w ON w.id=c.warehouse_id
    WHERE w.is_active;

    RETURN QUERY
    SELECT *
    FROM public.wms_create_stock_opname_scoped(
        v_id,p_opname_type,p_location_ids,p_notes
    );

END;
$fn$;

-- =====================================
-- STOCK MOVEMENT HISTORY
-- =====================================

CREATE FUNCTION public.wms_stock_movements_scoped(
    p_warehouse_id uuid,
    p_search text,
    p_type text,
    p_limit integer,
    p_offset integer
)
RETURNS TABLE(
    movement_id uuid,
    movement_no bigint,
    movement_type text,
    created_at timestamptz,
    variant_id uuid,
    sku text,
    product_code text,
    product_name text,
    quantity integer,
    from_location text,
    to_location text,
    reason text,
    reference_no text,
    sales_channel text,
    notes text,
    created_by uuid,
    total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN

    PERFORM public.assert_wms_role(
        ARRAY[
            'owner','admin','warehouse_manager',
            'warehouse_staff','viewer'
        ]::public.app_user_role[]
    );

    RETURN QUERY
    SELECT
        m.id,m.movement_no,m.movement_type::text,
        m.created_at,m.variant_id,
        pv.sku,p.product_code,p.name,m.quantity,

        CASE WHEN fl.id IS NULL THEN NULL
            ELSE concat_ws(' / ',fw.name,fl.code)
        END,

        CASE WHEN tl.id IS NULL THEN NULL
            ELSE concat_ws(' / ',tw.name,tl.code)
        END,

        m.reason,m.reference_no,m.sales_channel,
        m.notes,m.created_by,
        count(*) OVER()::bigint

    FROM public.stock_movements m

    JOIN public.product_variants pv
        ON pv.id=m.variant_id
    JOIN public.products p
        ON p.id=pv.product_id

    LEFT JOIN public.locations fl
        ON fl.id=m.from_location_id
    LEFT JOIN public.stock_areas fa
        ON fa.id=fl.area_id
    LEFT JOIN public.warehouses fw
        ON fw.id=fa.warehouse_id

    LEFT JOIN public.locations tl
        ON tl.id=m.to_location_id
    LEFT JOIN public.stock_areas ta
        ON ta.id=tl.area_id
    LEFT JOIN public.warehouses tw
        ON tw.id=ta.warehouse_id

    WHERE (
        p_warehouse_id IS NULL
        OR fa.warehouse_id=p_warehouse_id
        OR ta.warehouse_id=p_warehouse_id
    )
    AND (
        coalesce(trim(p_type),'')=''
        OR m.movement_type::text=trim(p_type)
    )
    AND (
        coalesce(trim(p_search),'')=''
        OR concat_ws(' ',
            pv.sku,p.product_code,p.name,
            m.reference_no,m.reason,m.notes,
            fl.code,tl.code,fw.name,tw.name,
            m.sales_channel
        ) ILIKE '%'||trim(p_search)||'%'
    )

    ORDER BY m.movement_no DESC
    LIMIT greatest(p_limit,1)
    OFFSET greatest(p_offset,0);

END;
$fn$;

-- =====================================
-- SECURITY
-- =====================================

REVOKE ALL ON FUNCTION
    public.wms_scoped_racks(uuid,uuid,text,boolean),
    public.wms_rack_tips_scoped(uuid,uuid,text),
    public.wms_stock_opname_locations_scoped(uuid),
    public.wms_create_stock_opname_scoped(uuid,text,uuid[],text),
    public.wms_stock_movements_scoped(uuid,text,text,integer,integer),
    public.create_stock_opname_session(text,uuid[],text)
FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION
    public.wms_scoped_racks(uuid,uuid,text,boolean),
    public.wms_rack_tips_scoped(uuid,uuid,text),
    public.wms_stock_opname_locations_scoped(uuid),
    public.wms_create_stock_opname_scoped(uuid,text,uuid[],text),
    public.wms_stock_movements_scoped(uuid,text,text,integer,integer),
    public.create_stock_opname_session(text,uuid[],text)
TO authenticated;

REVOKE EXECUTE ON FUNCTION
    public.get_stock_movements(text,text,integer,integer)
FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION
    public.get_stock_movements(text,text,integer,integer)
TO authenticated;

-- Protect location history from cascading deletion.

REVOKE DELETE ON TABLE
    public.warehouses,
    public.stock_areas,
    public.locations
FROM PUBLIC,anon,authenticated;

-- =====================================
-- AUTOMATED NON-MUTATING CHECK
-- =====================================

DO $verify$
DECLARE
    v_main uuid;
    v_store uuid;
    v_staff uuid;
    v_variant uuid;
    v_racks bigint;
    v_movements bigint;
    v_result bigint;
BEGIN

    SELECT warehouse_id INTO STRICT v_main
    FROM public.wms_warehouse_config
    WHERE warehouse_key='UTAMA';

    SELECT warehouse_id INTO STRICT v_store
    FROM public.wms_warehouse_config
    WHERE warehouse_key='STORE';

    IF NOT EXISTS (
        SELECT 1 FROM public.warehouses
        WHERE id=v_store AND NOT is_active
    ) THEN
        RAISE EXCEPTION 'STOP: Store harus nonaktif';
    END IF;

    SELECT id INTO v_staff
    FROM public.profiles
    WHERE role::text='warehouse_staff'
      AND is_active
    ORDER BY id
    LIMIT 1;

    SELECT i.variant_id INTO v_variant
    FROM public.inventory i
    JOIN public.locations l ON l.id=i.location_id
    JOIN public.stock_areas a ON a.id=l.area_id
    WHERE a.warehouse_id=v_main
      AND a.is_active AND l.is_active
      AND i.qty_on_hand>0
    ORDER BY i.qty_on_hand DESC
    LIMIT 1;

    IF v_staff IS NULL OR v_variant IS NULL THEN
        RAISE EXCEPTION 'STOP: Data pemeriksaan tidak tersedia';
    END IF;

    SELECT count(*) INTO v_racks
    FROM public.locations l
    JOIN public.stock_areas a ON a.id=l.area_id
    WHERE a.warehouse_id=v_main
      AND a.is_active AND l.is_active;

    SELECT count(*) INTO v_movements
    FROM public.stock_movements;

    PERFORM set_config(
        'request.jwt.claim.sub',v_staff::text,true
    );

    PERFORM set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',v_staff,
            'role','authenticated'
        )::text,true
    );

    EXECUTE 'SET LOCAL ROLE authenticated';

    -- Rack scope.

    IF NOT EXISTS (
        SELECT 1
        FROM public.wms_scoped_racks(
            v_main,v_variant,NULL,true
        )
    ) THEN
        RAISE EXCEPTION 'FAIL: Rack scope';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.wms_scoped_racks(
            v_main,v_variant,NULL,false
        ) r
        JOIN public.locations l ON l.id=r.location_id
        JOIN public.stock_areas a ON a.id=l.area_id
        WHERE a.warehouse_id<>v_main
    ) THEN
        RAISE EXCEPTION 'FAIL: Rack lintas gudang';
    END IF;

    -- Inactive Store must reject operational access.

    BEGIN

        PERFORM 1
        FROM public.wms_scoped_racks(
            v_store,v_variant,NULL,false
        );

        RAISE EXCEPTION 'FAIL: Store inactive accessible';

    EXCEPTION WHEN invalid_parameter_value THEN

        IF SQLERRM <>
            'Gudang tidak tersedia atau belum aktif'
        THEN
            RAISE;
        END IF;

    END;

    -- Smart rack read test.

    PERFORM 1
    FROM public.wms_rack_tips_scoped(
        v_main,v_variant,'NORMAL'
    );

    -- Stock opname rack scope.

    SELECT count(*) INTO v_result
    FROM public.wms_stock_opname_locations_scoped(v_main);

    IF v_result<>v_racks THEN
        RAISE EXCEPTION 'FAIL: Stock opname rack count';
    END IF;

    -- History pagination and warehouse scope.

    SELECT total_count INTO v_result
    FROM public.wms_stock_movements_scoped(
        NULL,NULL,NULL,1,0
    );

    IF coalesce(v_result,0)<>v_movements THEN
        RAISE EXCEPTION 'FAIL: History count';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.wms_stock_movements_scoped(
            v_store,NULL,NULL,1,0
        )
    ) THEN
        RAISE EXCEPTION 'FAIL: Store history';
    END IF;

    EXECUTE 'RESET ROLE';

    IF has_table_privilege(
        'authenticated','public.locations','DELETE'
    ) OR has_table_privilege(
        'authenticated','public.stock_areas','DELETE'
    ) OR has_table_privilege(
        'authenticated','public.warehouses','DELETE'
    ) THEN
        RAISE EXCEPTION 'FAIL: Master deletion privilege';
    END IF;

END;
$verify$;

COMMIT;

SELECT
    'V4.5B.2B BACKEND' AS pemeriksaan,
    'PASS' AS status,
    'Warehouse scoped operations installed' AS detail

UNION ALL

SELECT
    'RACK SCOPE','PASS',
    'Warehouse filter verified'

UNION ALL

SELECT
    'SMART RACK','PASS',
    'RPC read verified'

UNION ALL

SELECT
    'STORE INACTIVE','PASS',
    'Operational access rejected'

UNION ALL

SELECT
    'OPNAME RACK SCOPE','PASS',
    'Rack count verified'

UNION ALL

SELECT
    'MOVEMENT HISTORY','PASS',
    'Warehouse filter and count verified'

UNION ALL

SELECT
    'TOTAL STOK','INFO',
    coalesce(sum(qty_on_hand),0)::text
FROM public.inventory

UNION ALL

SELECT
    'TOTAL MOVEMENT','INFO',count(*)::text
FROM public.stock_movements;