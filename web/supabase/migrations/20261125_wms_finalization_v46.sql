-- HIPRIMA WMS V4.6
-- MULTI-WAREHOUSE FINALIZATION
-- INSTALLATION ONLY - NO STOCK REPLACEMENT

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ==========================================
-- 1. PREFLIGHT
-- ==========================================

DO $preflight$
BEGIN
    IF (
        SELECT count(*)
        FROM public.wms_warehouse_config
    ) <> 2 THEN
        RAISE EXCEPTION 'STOP: Foundation belum lengkap';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.wms_warehouse_config c
        JOIN public.warehouses w
          ON w.id=c.warehouse_id
        WHERE c.warehouse_key='STORE'
          AND NOT w.is_active
    ) THEN
        RAISE EXCEPTION 'STOP: STORE harus nonaktif';
    END IF;

    IF to_regprocedure(
        'public.wms_scoped_racks(uuid,uuid,text,boolean)'
    ) IS NULL THEN
        RAISE EXCEPTION 'STOP: V4.5B.2B belum tersedia';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.inventory
        WHERE qty_on_hand < 0
    ) THEN
        RAISE EXCEPTION 'STOP: Inventory negatif';
    END IF;
END;
$preflight$;

-- ==========================================
-- 2. OPERATIONAL GATE
-- ==========================================

CREATE TABLE public.wms_runtime_state (
    id integer PRIMARY KEY CHECK(id=1),
    phase text NOT NULL CHECK(
        phase IN ('PREPARATION','IMPORTING','READY','LIVE')
    ),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.wms_runtime_state(id,phase)
VALUES(1,'PREPARATION');

ALTER TABLE public.wms_runtime_state
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wms_runtime_state
FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.wms_require_live()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.wms_runtime_state
        WHERE id=1 AND phase='LIVE'
    ) THEN
        RAISE EXCEPTION
            'WMS belum Go Live. Transaksi stok dikunci.';
    END IF;
END;
$fn$;

-- ==========================================
-- 3. STAFF WAREHOUSE ASSIGNMENTS
-- ==========================================

CREATE TABLE public.wms_staff_warehouses (
    profile_id uuid NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,
    warehouse_id uuid NOT NULL
        REFERENCES public.warehouses(id)
        ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    assigned_by uuid REFERENCES auth.users(id),
    PRIMARY KEY(profile_id,warehouse_id)
);

ALTER TABLE public.wms_staff_warehouses
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wms_staff_warehouses
FROM PUBLIC,anon,authenticated;

INSERT INTO public.wms_staff_warehouses(
    profile_id,warehouse_id
)
SELECT p.id,c.warehouse_id
FROM public.profiles p
CROSS JOIN public.wms_warehouse_config c
WHERE p.role::text IN (
    'warehouse_manager','warehouse_staff'
)
AND c.warehouse_key='UTAMA';

CREATE FUNCTION public.wms_can_operate(
    p_warehouse_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.wms_warehouse_config c
          ON c.warehouse_id=p_warehouse_id
        WHERE p.id=auth.uid()
          AND p.is_active
          AND (
            p.role::text IN ('owner','admin')
            OR (
                p.role::text IN (
                    'warehouse_manager',
                    'warehouse_staff'
                )
                AND EXISTS (
                    SELECT 1
                    FROM public.wms_staff_warehouses sw
                    WHERE sw.profile_id=p.id
                      AND sw.warehouse_id=p_warehouse_id
                )
            )
          )
    );
$fn$;

CREATE FUNCTION public.wms_assert_warehouse_access(
    p_warehouse_id uuid
)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
BEGIN
    IF NOT public.wms_can_operate(p_warehouse_id) THEN
        RAISE EXCEPTION USING
            ERRCODE='42501',
            MESSAGE='Akses operasional gudang ditolak';
    END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.wms_assert_warehouse_active(
    p_warehouse_id uuid
)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
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

    PERFORM public.wms_assert_warehouse_access(
        p_warehouse_id
    );
END;
$fn$;

CREATE FUNCTION public.wms_set_staff_warehouses(
    p_profile_id uuid,
    p_warehouse_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY['owner','admin']::public.app_user_role[]
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id=p_profile_id
          AND role::text IN (
              'warehouse_manager','warehouse_staff'
          )
    ) THEN
        RAISE EXCEPTION 'Akun staf atau manager tidak valid';
    END IF;

    IF p_warehouse_ids IS NULL OR EXISTS (
        SELECT 1
        FROM unnest(p_warehouse_ids) AS x(id)
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.wms_warehouse_config c
            WHERE c.warehouse_id=x.id
        )
    ) THEN
        RAISE EXCEPTION 'Daftar gudang tidak valid';
    END IF;

    PERFORM 1
    FROM public.profiles
    WHERE id=p_profile_id
    FOR UPDATE;

    DELETE FROM public.wms_staff_warehouses
    WHERE profile_id=p_profile_id;

    INSERT INTO public.wms_staff_warehouses(
        profile_id,warehouse_id,assigned_by
    )
    SELECT DISTINCT
        p_profile_id,x.id,auth.uid()
    FROM unnest(p_warehouse_ids) AS x(id);

    RETURN jsonb_build_object(
        'status','SAVED',
        'profile_id',p_profile_id
    );
END;
$fn$;

-- ==========================================
-- 4. WAREHOUSE LIST
-- ==========================================

CREATE OR REPLACE FUNCTION public.wms_list_warehouses()
RETURNS TABLE(
    warehouse_key text,
    warehouse_id uuid,
    warehouse_code text,
    warehouse_name text,
    is_active boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
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
        c.warehouse_key,w.id,w.code,w.name,w.is_active
    FROM public.wms_warehouse_config c
    JOIN public.warehouses w ON w.id=c.warehouse_id
    WHERE public.wms_can_operate(w.id)
       OR EXISTS (
           SELECT 1
           FROM public.profiles p
           WHERE p.id=auth.uid()
             AND p.role::text='viewer'
             AND p.is_active
       )
    ORDER BY CASE c.warehouse_key
        WHEN 'UTAMA' THEN 1 ELSE 2 END;
END;
$fn$;

-- Filter outbound racks based on staff assignment.

DO $patch$
DECLARE
    v_def text;
    v_anchor text:='AND a.is_active';
BEGIN
    SELECT pg_get_functiondef(
        'public.wms_get_outbound_source_locations(uuid,text,text)'::regprocedure
    ) INTO v_def;

    IF position('wms_can_operate' IN v_def)>0
       OR (
           length(v_def)-
           length(replace(v_def,v_anchor,''))
       )<>length(v_anchor)
    THEN
        RAISE EXCEPTION
            'STOP: Outbound rack definition differs';
    END IF;

    EXECUTE replace(
        v_def,
        v_anchor,
        v_anchor ||
        ' AND public.wms_can_operate(a.warehouse_id)'
    );
END;
$patch$;

-- ==========================================
-- 5. CENTRAL INVENTORY WRITE PROTECTION
-- ==========================================

CREATE FUNCTION public.wms_guard_inventory_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    v_phase text;
    v_location uuid;
    v_warehouse uuid;
BEGIN
    SELECT phase INTO STRICT v_phase
    FROM public.wms_runtime_state
    WHERE id=1;

    IF v_phase='IMPORTING' THEN
        PERFORM public.assert_wms_role(
            ARRAY['owner']::public.app_user_role[]
        );
    ELSIF v_phase='LIVE' THEN
        PERFORM public.assert_wms_role(
            ARRAY[
                'owner','admin','warehouse_manager',
                'warehouse_staff'
            ]::public.app_user_role[]
        );
    ELSE
        RAISE EXCEPTION
            'WMS belum Go Live. Transaksi stok dikunci.';
    END IF;

    IF TG_OP IN ('UPDATE','DELETE') THEN
        SELECT a.warehouse_id INTO STRICT v_warehouse
        FROM public.locations l
        JOIN public.stock_areas a ON a.id=l.area_id
        WHERE l.id=OLD.location_id;

        PERFORM public.wms_assert_warehouse_access(
            v_warehouse
        );
    END IF;

    IF TG_OP IN ('INSERT','UPDATE') THEN
        v_location:=NEW.location_id;

        SELECT a.warehouse_id INTO v_warehouse
        FROM public.locations l
        JOIN public.stock_areas a ON a.id=l.area_id
        WHERE l.id=v_location
          AND l.is_active
          AND a.is_active;

        PERFORM public.wms_assert_warehouse_active(
            v_warehouse
        );

        RETURN NEW;
    END IF;

    RETURN OLD;
END;
$fn$;

CREATE TRIGGER wms_guard_inventory_write
BEFORE INSERT OR UPDATE OR DELETE
ON public.inventory
FOR EACH ROW
EXECUTE FUNCTION public.wms_guard_inventory_write();

-- Guard movement inserts, including legacy RPCs.

CREATE FUNCTION public.wms_guard_movement_access()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    v_location uuid;
    v_warehouse uuid;
    v_phase text;
BEGIN
    SELECT phase INTO STRICT v_phase
    FROM public.wms_runtime_state WHERE id=1;

    IF v_phase='IMPORTING' THEN
        PERFORM public.assert_wms_role(
            ARRAY['owner']::public.app_user_role[]
        );
    ELSE
        PERFORM public.wms_require_live();
    END IF;

    FOREACH v_location IN ARRAY ARRAY[
        NEW.from_location_id,
        NEW.to_location_id
    ] LOOP
        IF v_location IS NOT NULL THEN
            SELECT a.warehouse_id INTO STRICT v_warehouse
            FROM public.locations l
            JOIN public.stock_areas a ON a.id=l.area_id
            WHERE l.id=v_location;

            PERFORM public.wms_assert_warehouse_active(
                v_warehouse
            );
        END IF;
    END LOOP;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER wms_guard_movement_access
BEFORE INSERT ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.wms_guard_movement_access();

-- ==========================================
-- 6. STOCK OPNAME WRITE PROTECTION
-- ==========================================

CREATE FUNCTION public.wms_guard_opname_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    v_location uuid;
    v_session uuid;
    v_warehouse uuid;
    v_session_warehouse uuid;
BEGIN
    PERFORM public.wms_require_live();

    IF TG_OP IN ('UPDATE','DELETE') THEN
        SELECT a.warehouse_id INTO STRICT v_warehouse
        FROM public.locations l
        JOIN public.stock_areas a ON a.id=l.area_id
        WHERE l.id=OLD.location_id;

        PERFORM public.wms_assert_warehouse_access(
            v_warehouse
        );
    END IF;

    IF TG_OP='DELETE' THEN
        RETURN OLD;
    END IF;

    v_location:=NEW.location_id;
    v_session:=NEW.session_id;

    SELECT a.warehouse_id INTO STRICT v_warehouse
    FROM public.locations l
    JOIN public.stock_areas a ON a.id=l.area_id
    WHERE l.id=v_location;

    PERFORM public.wms_assert_warehouse_active(
        v_warehouse
    );

    SELECT warehouse_id INTO STRICT v_session_warehouse
    FROM public.stock_opname_sessions
    WHERE id=v_session;

    IF v_session_warehouse IS NOT NULL
       AND v_session_warehouse<>v_warehouse THEN
        RAISE EXCEPTION
            'Rak tidak sesuai gudang Stock Opname';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER wms_guard_opname_line
BEFORE INSERT OR UPDATE OR DELETE
ON public.stock_opname_lines
FOR EACH ROW
EXECUTE FUNCTION public.wms_guard_opname_line();

CREATE FUNCTION public.wms_guard_opname_session()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    r record;
BEGIN

    -- Allow authorized management to cancel old sessions
    -- during preparation, without modifying inventory.

    IF TG_OP='UPDATE'
       AND NEW.status='cancelled'
       AND OLD.status IN ('draft','counting','review')
    THEN
        PERFORM public.assert_wms_role(
            ARRAY['owner','admin']::public.app_user_role[]
        );

        RETURN NEW;
    END IF;

    PERFORM public.wms_require_live();

    PERFORM public.assert_wms_role(
        ARRAY[
            'owner','admin','warehouse_manager',
            'warehouse_staff'
        ]::public.app_user_role[]
    );

    IF TG_OP IN ('UPDATE','DELETE') THEN

        IF OLD.warehouse_id IS NOT NULL THEN
            PERFORM public.wms_assert_warehouse_access(
                OLD.warehouse_id
            );
        END IF;

        FOR r IN
            SELECT DISTINCT a.warehouse_id
            FROM public.stock_opname_lines ol
            JOIN public.locations l ON l.id=ol.location_id
            JOIN public.stock_areas a ON a.id=l.area_id
            WHERE ol.session_id=OLD.id
        LOOP
            PERFORM public.wms_assert_warehouse_access(
                r.warehouse_id
            );
        END LOOP;

    END IF;

    IF TG_OP='DELETE' THEN RETURN OLD; END IF;

    IF NEW.warehouse_id IS NOT NULL THEN
        PERFORM public.wms_assert_warehouse_active(
            NEW.warehouse_id
        );
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.stock_opname_lines ol
        JOIN public.locations l ON l.id=ol.location_id
        JOIN public.stock_areas a ON a.id=l.area_id
        WHERE ol.session_id=NEW.id
          AND NEW.warehouse_id IS NOT NULL
          AND a.warehouse_id<>NEW.warehouse_id
    ) THEN
        RAISE EXCEPTION 'Stock Opname lintas gudang ditolak';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER wms_guard_opname_session
BEFORE INSERT OR UPDATE OR DELETE
ON public.stock_opname_sessions
FOR EACH ROW
EXECUTE FUNCTION public.wms_guard_opname_session();

-- ==========================================
-- 7. TRANSFER DOCUMENTS
-- ==========================================

CREATE TABLE public.wms_interwarehouse_transfers (
    id uuid PRIMARY KEY,
    transfer_no text NOT NULL UNIQUE,
    source_warehouse_id uuid NOT NULL
        REFERENCES public.warehouses(id),
    destination_warehouse_id uuid NOT NULL
        REFERENCES public.warehouses(id),
    status text NOT NULL DEFAULT 'IN_TRANSIT'
        CHECK(status IN ('IN_TRANSIT','RECEIVED')),
    request_lines jsonb NOT NULL,
    received_payload jsonb,
    notes text,
    dispatched_by uuid REFERENCES auth.users(id),
    dispatched_at timestamptz NOT NULL DEFAULT now(),
    received_by uuid REFERENCES auth.users(id),
    received_at timestamptz,
    CHECK(source_warehouse_id<>destination_warehouse_id)
);

CREATE TABLE public.wms_interwarehouse_transfer_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id uuid NOT NULL
        REFERENCES public.wms_interwarehouse_transfers(id),
    variant_id uuid NOT NULL
        REFERENCES public.product_variants(id),
    from_location_id uuid NOT NULL
        REFERENCES public.locations(id),
    to_location_id uuid
        REFERENCES public.locations(id),
    qc text NOT NULL
        CHECK(qc IN ('NORMAL','DEFECT','REJECT')),
    qty integer NOT NULL CHECK(qty>0),
    dispatch_movement_no bigint NOT NULL,
    receive_movement_no bigint,
    UNIQUE(transfer_id,variant_id,from_location_id)
);

ALTER TABLE public.wms_interwarehouse_transfers
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.wms_interwarehouse_transfer_lines
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
    public.wms_interwarehouse_transfers,
    public.wms_interwarehouse_transfer_lines
FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.wms_dispatch_transfer(
    p_request_id uuid,
    p_source_warehouse_id uuid,
    p_destination_warehouse_id uuid,
    p_lines jsonb,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    r record;
    v_existing record;
    v_no text;
    v_qc text;
    v_move bigint;
    v_notes text:=nullif(trim(p_notes),'');
BEGIN
    PERFORM public.wms_require_live();

    PERFORM public.wms_assert_warehouse_active(
        p_source_warehouse_id
    );

    IF p_request_id IS NULL
       OR p_source_warehouse_id=p_destination_warehouse_id
       OR NOT EXISTS (
           SELECT 1
           FROM public.warehouses w
           JOIN public.wms_warehouse_config c
             ON c.warehouse_id=w.id
           WHERE w.id=p_destination_warehouse_id
             AND w.is_active
       )
    THEN
        RAISE EXCEPTION 'Gudang tujuan tidak valid';
    END IF;

    IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Daftar transfer tidak valid';
    END IF;

    IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200
       OR length(coalesce(v_notes,''))>500 THEN
        RAISE EXCEPTION 'Transfer maksimal 200 baris';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'TRANSFER:'||p_request_id::text,0
        )
    );

    SELECT * INTO v_existing
    FROM public.wms_interwarehouse_transfers
    WHERE id=p_request_id;

    IF FOUND THEN
        IF v_existing.source_warehouse_id
            IS DISTINCT FROM p_source_warehouse_id
        OR v_existing.destination_warehouse_id
            IS DISTINCT FROM p_destination_warehouse_id
        OR v_existing.request_lines IS DISTINCT FROM p_lines
        OR v_existing.notes IS DISTINCT FROM v_notes
        OR v_existing.dispatched_by IS DISTINCT FROM auth.uid()
        THEN
            RAISE EXCEPTION 'Request ID sudah dipakai';
        END IF;

        RETURN jsonb_build_object(
            'id',v_existing.id,
            'transfer_no',v_existing.transfer_no,
            'status',v_existing.status
        );
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_lines) AS x(
            variant_id uuid,
            from_location_id uuid,
            qty integer
        )
        GROUP BY x.variant_id,x.from_location_id
        HAVING count(*)>1
    ) THEN
        RAISE EXCEPTION 'SKU dan rak asal berulang';
    END IF;

    v_no:='TRF-'||
        upper(left(replace(p_request_id::text,'-',''),16));

    INSERT INTO public.wms_interwarehouse_transfers(
        id,transfer_no,
        source_warehouse_id,destination_warehouse_id,
        request_lines,notes,dispatched_by
    )
    VALUES(
        p_request_id,v_no,
        p_source_warehouse_id,p_destination_warehouse_id,
        p_lines,v_notes,auth.uid()
    );

    FOR r IN
        SELECT *
        FROM jsonb_to_recordset(p_lines) AS x(
            variant_id uuid,
            from_location_id uuid,
            qty integer
        )
        ORDER BY x.variant_id,x.from_location_id
    LOOP

        IF r.variant_id IS NULL
           OR r.from_location_id IS NULL
           OR r.qty IS NULL OR r.qty<=0 THEN
            RAISE EXCEPTION 'Baris transfer tidak valid';
        END IF;

        SELECT upper(a.area_type::text) INTO v_qc
        FROM public.locations l
        JOIN public.stock_areas a ON a.id=l.area_id
        WHERE l.id=r.from_location_id
          AND l.is_active
          AND a.is_active
          AND a.warehouse_id=p_source_warehouse_id;

        IF v_qc IS NULL THEN
            RAISE EXCEPTION 'Rak asal salah gudang';
        END IF;

        UPDATE public.inventory i
        SET qty_on_hand=i.qty_on_hand-r.qty,
            updated_at=now()
        WHERE i.variant_id=r.variant_id
          AND i.location_id=r.from_location_id
          AND i.qty_on_hand>=r.qty;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Stok transfer tidak mencukupi';
        END IF;

        INSERT INTO public.stock_movements(
            movement_type,variant_id,
            from_location_id,to_location_id,
            quantity,reason,reference_no,notes,created_by
        )
        VALUES(
            'transfer',r.variant_id,
            r.from_location_id,NULL,r.qty,
            'Inter-Warehouse Dispatch',
            v_no,v_notes,auth.uid()
        )
        RETURNING movement_no INTO v_move;

        INSERT INTO public.wms_interwarehouse_transfer_lines(
            transfer_id,variant_id,
            from_location_id,qc,qty,
            dispatch_movement_no
        )
        VALUES(
            p_request_id,r.variant_id,
            r.from_location_id,v_qc,r.qty,v_move
        );

    END LOOP;

    RETURN jsonb_build_object(
        'id',p_request_id,
        'transfer_no',v_no,
        'status','IN_TRANSIT'
    );

END;
$fn$;

CREATE FUNCTION public.wms_receive_transfer(
    p_transfer_id uuid,
    p_destinations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    d record;
    r record;
    v_rack uuid;
    v_move bigint;
BEGIN
    PERFORM public.wms_require_live();

    SELECT * INTO STRICT d
    FROM public.wms_interwarehouse_transfers
    WHERE id=p_transfer_id
    FOR UPDATE;

    PERFORM public.wms_assert_warehouse_active(
        d.destination_warehouse_id
    );

    IF d.status='RECEIVED' THEN
        IF d.received_payload IS DISTINCT FROM p_destinations THEN
            RAISE EXCEPTION 'Transfer sudah diterima';
        END IF;

        RETURN jsonb_build_object(
            'transfer_no',d.transfer_no,
            'status','RECEIVED'
        );
    END IF;

    IF jsonb_typeof(p_destinations)
        IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION 'Rak tujuan wajib diisi';
    END IF;

    IF jsonb_array_length(p_destinations)<>(
        SELECT count(*)
        FROM public.wms_interwarehouse_transfer_lines
        WHERE transfer_id=p_transfer_id
    ) OR EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_destinations)
            AS x(line_id uuid,to_location_id uuid)
        GROUP BY x.line_id
        HAVING count(*)>1
    ) THEN
        RAISE EXCEPTION 'Daftar penerimaan tidak lengkap';
    END IF;

    FOR r IN
        SELECT *
        FROM public.wms_interwarehouse_transfer_lines
        WHERE transfer_id=p_transfer_id
        ORDER BY variant_id,id
    LOOP

        SELECT x.to_location_id INTO v_rack
        FROM jsonb_to_recordset(p_destinations)
            AS x(line_id uuid,to_location_id uuid)
        WHERE x.line_id=r.id;

        IF NOT EXISTS (
            SELECT 1
            FROM public.locations l
            JOIN public.stock_areas a ON a.id=l.area_id
            WHERE l.id=v_rack
              AND l.is_active
              AND a.is_active
              AND a.warehouse_id=d.destination_warehouse_id
              AND upper(a.area_type::text)=r.qc
        ) THEN
            RAISE EXCEPTION
                'Rak tujuan salah gudang atau kategori QC';
        END IF;

        INSERT INTO public.inventory AS i(
            variant_id,location_id,qty_on_hand,updated_at
        )
        VALUES(r.variant_id,v_rack,r.qty,now())
        ON CONFLICT(variant_id,location_id)
        DO UPDATE SET
            qty_on_hand=i.qty_on_hand+EXCLUDED.qty_on_hand,
            updated_at=now();

        INSERT INTO public.stock_movements(
            movement_type,variant_id,
            from_location_id,to_location_id,
            quantity,reason,reference_no,created_by
        )
        VALUES(
            'transfer',r.variant_id,
            NULL,v_rack,r.qty,
            'Inter-Warehouse Receipt',
            d.transfer_no,auth.uid()
        )
        RETURNING movement_no INTO v_move;

        UPDATE public.wms_interwarehouse_transfer_lines
        SET to_location_id=v_rack,
            receive_movement_no=v_move
        WHERE id=r.id;

    END LOOP;

    UPDATE public.wms_interwarehouse_transfers
    SET status='RECEIVED',
        received_payload=p_destinations,
        received_by=auth.uid(),
        received_at=now()
    WHERE id=p_transfer_id;

    RETURN jsonb_build_object(
        'transfer_no',d.transfer_no,
        'status','RECEIVED'
    );
END;
$fn$;

-- ==========================================
-- 8. TRANSFER LIST
-- ==========================================

CREATE FUNCTION public.wms_transfer_list()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY[
            'owner','admin',
            'warehouse_manager','warehouse_staff'
        ]::public.app_user_role[]
    );

    RETURN coalesce((
        SELECT jsonb_agg(
            to_jsonb(d)
            ORDER BY d.dispatched_at DESC
        )
        FROM (
            SELECT
                t.id,t.transfer_no,t.status,
                t.source_warehouse_id,
                t.destination_warehouse_id,
                sw.name AS source_name,
                dw.name AS destination_name,
                t.dispatched_at,t.received_at,t.notes,
                public.wms_can_operate(
                    t.destination_warehouse_id
                ) AS can_receive,
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'line_id',l.id,
                            'variant_id',l.variant_id,
                            'sku',pv.sku,
                            'qc',l.qc,
                            'qty',l.qty,
                            'from_rack',fl.code,
                            'to_rack',tl.code
                        )
                        ORDER BY pv.sku,l.id
                    )
                    FROM public.wms_interwarehouse_transfer_lines l
                    JOIN public.product_variants pv
                      ON pv.id=l.variant_id
                    JOIN public.locations fl
                      ON fl.id=l.from_location_id
                    LEFT JOIN public.locations tl
                      ON tl.id=l.to_location_id
                    WHERE l.transfer_id=t.id
                ) AS lines
            FROM public.wms_interwarehouse_transfers t
            JOIN public.warehouses sw
              ON sw.id=t.source_warehouse_id
            JOIN public.warehouses dw
              ON dw.id=t.destination_warehouse_id
            WHERE public.wms_can_operate(
                t.source_warehouse_id
            ) OR public.wms_can_operate(
                t.destination_warehouse_id
            )
            ORDER BY
                CASE WHEN t.status='IN_TRANSIT'
                    THEN 0 ELSE 1 END,
                t.dispatched_at DESC
            LIMIT 200
        ) d
    ),'[]'::jsonb);
END;
$fn$;

-- ==========================================
-- 9. OPENING STOCK IMPORT BATCH
-- ==========================================

CREATE TABLE public.wms_opening_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status text NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','APPLIED')),
    racks jsonb NOT NULL,
    stock jsonb NOT NULL,
    preview jsonb NOT NULL,
    baseline_hash text NOT NULL,
    old_inventory jsonb,
    old_locations jsonb,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    applied_by uuid REFERENCES auth.users(id),
    applied_at timestamptz
);

ALTER TABLE public.wms_opening_batches
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wms_opening_batches
FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.wms_opening_fingerprint()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
    SELECT md5(concat_ws('|',
        (
            SELECT string_agg(
                concat_ws(':',
                    i.id,i.variant_id,
                    i.location_id,i.qty_on_hand
                ),'|' ORDER BY i.id
            )
            FROM public.inventory i
        ),
        (
            SELECT string_agg(
                concat_ws(':',
                    l.id,l.area_id,l.code,l.name,l.is_active
                ),'|' ORDER BY l.id
            )
            FROM public.locations l
        ),
        (
            SELECT string_agg(
                concat_ws(':',a.id,a.warehouse_id,a.is_active),
                '|' ORDER BY a.id
            )
            FROM public.stock_areas a
        ),
        (
            SELECT string_agg(
                concat_ws(':',w.id,w.is_active),
                '|' ORDER BY w.id
            )
            FROM public.warehouses w
        ),
        (SELECT count(*) FROM public.stock_movements),
        (SELECT max(movement_no) FROM public.stock_movements)
    ));
$fn$;

-- ==========================================
-- 10. OPENING STOCK VALIDATION
-- ==========================================

CREATE FUNCTION public.wms_validate_opening(
    p_racks jsonb,
    p_stock jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    v_error text;
BEGIN

    IF jsonb_typeof(p_racks) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_stock) IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION 'Data import harus berupa array';
    END IF;

    IF jsonb_array_length(p_racks)
        NOT BETWEEN 6 AND 5000
    OR jsonb_array_length(p_stock)
        NOT BETWEEN 1 AND 25000 THEN
        RAISE EXCEPTION 'Jumlah baris import tidak valid';
    END IF;

    -- Validate master rack.

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_racks) AS r(
            warehouse text,area text,rack text,name text
        )
        WHERE r.warehouse IS NULL
           OR r.warehouse NOT IN ('UTAMA','STORE')
           OR r.area IS NULL
           OR r.area NOT IN ('NORMAL','DEFECT','REJECT')
           OR r.rack IS NULL
           OR r.rack !~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'
           OR length(coalesce(r.name,''))>120
    ) THEN
        RAISE EXCEPTION 'Format master rak tidak valid';
    END IF;

    IF (
        SELECT count(DISTINCT (r.warehouse,r.area))
        FROM jsonb_to_recordset(p_racks) AS r(
            warehouse text,area text
        )
    )<>6 THEN
        RAISE EXCEPTION
            'Setiap gudang membutuhkan area NORMAL, DEFECT, REJECT';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_racks) AS r(
            warehouse text,rack text
        )
        GROUP BY r.warehouse,r.rack
        HAVING count(*)>1
    ) THEN
        RAISE EXCEPTION 'Kode rak berulang dalam satu gudang';
    END IF;

    -- New layout must not reuse a historical rack code
    -- in the same warehouse.

    SELECT r.warehouse||' / '||r.rack INTO v_error
    FROM jsonb_to_recordset(p_racks) AS r(
        warehouse text,rack text
    )
    JOIN public.wms_warehouse_config c
      ON c.warehouse_key=r.warehouse
    JOIN public.stock_areas a
      ON a.warehouse_id=c.warehouse_id
    JOIN public.locations l
      ON l.area_id=a.id
     AND upper(trim(l.code))=r.rack
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Kode rak lama tidak boleh digunakan ulang: %',
            v_error;
    END IF;

    -- Validate stock quantities.

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_stock) AS s(
            sku text,warehouse text,rack text,qty integer
        )
        WHERE nullif(trim(s.sku),'') IS NULL
           OR s.qty IS NULL
           OR s.qty<0
           OR s.qty>999999999
    ) THEN
        RAISE EXCEPTION 'SKU atau quantity tidak valid';
    END IF;

    SELECT s.sku INTO v_error
    FROM jsonb_to_recordset(p_stock) AS s(sku text)
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.product_variants pv
        WHERE pv.sku=s.sku
    )
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'SKU belum terdaftar: %',v_error;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_stock) AS s(
            sku text,warehouse text,rack text
        )
        GROUP BY s.sku,s.warehouse,s.rack
        HAVING count(*)>1
    ) THEN
        RAISE EXCEPTION 'Baris SKU dan rak berulang';
    END IF;

    SELECT concat_ws('/',s.sku,s.warehouse,s.rack)
    INTO v_error
    FROM jsonb_to_recordset(p_stock) AS s(
        sku text,warehouse text,rack text
    )
    WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_racks) AS r(
            warehouse text,rack text
        )
        WHERE r.warehouse=s.warehouse
          AND r.rack=s.rack
    )
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Rak stok tidak terdaftar: %',v_error;
    END IF;

    IF (
        SELECT coalesce(sum(s.qty),0)
        FROM jsonb_to_recordset(p_stock) AS s(qty integer)
    )<=0 THEN
        RAISE EXCEPTION 'Opening stock tidak boleh kosong total';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.inventory i
        JOIN public.locations l ON l.id=i.location_id
        JOIN public.stock_areas a ON a.id=l.area_id
        JOIN public.warehouses w ON w.id=a.warehouse_id
        WHERE i.qty_on_hand>0
          AND (
              NOT l.is_active
              OR NOT a.is_active
              OR NOT w.is_active
          )
    ) THEN
        RAISE EXCEPTION
            'Masih ada stok positif di lokasi nonaktif';
    END IF;

    RETURN jsonb_build_object(
        'old_total',
            (SELECT coalesce(sum(qty_on_hand),0)
             FROM public.inventory),
        'old_movements',
            (SELECT count(*) FROM public.stock_movements),
        'new_racks',jsonb_array_length(p_racks),
        'new_rows',jsonb_array_length(p_stock),
        'new_total',
            (
                SELECT sum(s.qty)
                FROM jsonb_to_recordset(p_stock)
                    AS s(qty integer)
            ),
        'new_skus',
            (
                SELECT count(DISTINCT s.sku)
                FROM jsonb_to_recordset(p_stock)
                    AS s(sku text)
            ),
        'summary',
            (
                SELECT jsonb_agg(to_jsonb(x)
                    ORDER BY x.warehouse,x.area)
                FROM (
                    SELECT r.warehouse,r.area,
                        count(DISTINCT r.rack) AS racks,
                        coalesce(sum(s.qty),0) AS qty
                    FROM jsonb_to_recordset(p_racks)
                        AS r(
                            warehouse text,
                            area text,rack text
                        )
                    LEFT JOIN jsonb_to_recordset(p_stock)
                        AS s(
                            warehouse text,
                            rack text,qty integer
                        )
                      ON s.warehouse=r.warehouse
                     AND s.rack=r.rack
                    GROUP BY r.warehouse,r.area
                ) x
            )
    );

END;
$fn$;

CREATE FUNCTION public.wms_preview_opening(
    p_racks jsonb,
    p_stock jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    v_preview jsonb;
    v_id uuid;
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY['owner','admin']::public.app_user_role[]
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.wms_runtime_state
        WHERE id=1 AND phase='PREPARATION'
    ) THEN
        RAISE EXCEPTION
            'Opening import hanya tersedia saat PREPARATION';
    END IF;

    v_preview:=public.wms_validate_opening(
        p_racks,p_stock
    );

    INSERT INTO public.wms_opening_batches(
        racks,stock,preview,baseline_hash,created_by
    )
    VALUES(
        p_racks,p_stock,v_preview,
        public.wms_opening_fingerprint(),
        auth.uid()
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'batch_id',v_id,
        'status','DRAFT',
        'preview',v_preview
    );
END;
$fn$;

-- ==========================================
-- 11. OWNER APPROVAL & ATOMIC CUTOVER
-- ==========================================

CREATE FUNCTION public.wms_apply_opening(
    p_batch_id uuid,
    p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    b record;
    v_preview jsonb;
    v_phase text;
    v_ref text;
    v_expected bigint;
    v_actual bigint;
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY['owner']::public.app_user_role[]
    );

    IF p_confirmation IS DISTINCT FROM 'GANTI STOK' THEN
        RAISE EXCEPTION 'Konfirmasi Owner belum sesuai';
    END IF;

    SELECT * INTO STRICT b
    FROM public.wms_opening_batches
    WHERE id=p_batch_id
    FOR UPDATE;

    IF b.status='APPLIED' THEN
        RETURN jsonb_build_object(
            'batch_id',b.id,
            'status','APPLIED'
        );
    END IF;

    SELECT phase INTO STRICT v_phase
    FROM public.wms_runtime_state
    WHERE id=1
    FOR UPDATE;

    IF v_phase<>'PREPARATION' THEN
        RAISE EXCEPTION 'Opening stock sudah dikunci';
    END IF;

    LOCK TABLE
        public.inventory,
        public.stock_movements,
        public.locations,
        public.stock_areas,
        public.warehouses,
        public.stock_opname_sessions,
        public.stock_opname_lines
    IN ACCESS EXCLUSIVE MODE;

    IF EXISTS (
        SELECT 1
        FROM public.stock_opname_sessions
        WHERE status NOT IN ('finalized','cancelled')
    ) THEN
        RAISE EXCEPTION
            'Masih ada Stock Opname yang belum ditutup';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.wms_interwarehouse_transfers
        WHERE status='IN_TRANSIT'
    ) THEN
        RAISE EXCEPTION 'Masih ada barang dalam perjalanan';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.stock_areas a
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.wms_warehouse_config c
            WHERE c.warehouse_id=a.warehouse_id
        )
    ) THEN
        RAISE EXCEPTION 'Terdapat gudang di luar konfigurasi';
    END IF;

    IF public.wms_opening_fingerprint()
        IS DISTINCT FROM b.baseline_hash
    THEN
        RAISE EXCEPTION
            'Data lama berubah sejak preview. Buat preview baru.';
    END IF;

    v_preview:=public.wms_validate_opening(
        b.racks,b.stock
    );

    v_expected:=(v_preview->>'new_total')::bigint;

    v_ref:='OPENING-'||upper(
        left(replace(p_batch_id::text,'-',''),16)
    );

    -- Archive all old balances and old rack metadata.

    UPDATE public.wms_opening_batches
    SET old_inventory=coalesce((
            SELECT jsonb_agg(
                to_jsonb(i)
                ORDER BY i.id
            )
            FROM public.inventory i
        ),'[]'::jsonb),
        old_locations=coalesce((
            SELECT jsonb_agg(
                to_jsonb(l)||
                jsonb_build_object(
                    'warehouse_id',a.warehouse_id,
                    'area_code',a.code
                )
                ORDER BY l.id
            )
            FROM public.locations l
            JOIN public.stock_areas a ON a.id=l.area_id
        ),'[]'::jsonb)
    WHERE id=p_batch_id;

    -- IMPORTING is only visible inside this transaction.

    UPDATE public.wms_runtime_state
    SET phase='IMPORTING',
        updated_at=now(),
        updated_by=auth.uid()
    WHERE id=1;

    -- Close previous balances with an auditable movement.

    INSERT INTO public.stock_movements(
        movement_type,variant_id,
        from_location_id,to_location_id,
        quantity,reason,reference_no,created_by
    )
    SELECT
        'adjustment_out',
        i.variant_id,i.location_id,NULL,
        i.qty_on_hand,
        'Cutover - closing old inventory',
        v_ref,auth.uid()
    FROM public.inventory i
    WHERE i.qty_on_hand>0
    ORDER BY i.variant_id,i.location_id;

    DELETE FROM public.inventory;

    UPDATE public.locations
    SET is_active=false,updated_at=now()
    WHERE is_active;

    -- Activate new warehouse configuration.

    UPDATE public.warehouses w
    SET is_active=true,updated_at=now()
    FROM public.wms_warehouse_config c
    WHERE w.id=c.warehouse_id;

    UPDATE public.stock_areas a
    SET is_active=true,updated_at=now()
    FROM public.wms_warehouse_config c
    WHERE a.warehouse_id=c.warehouse_id;

    -- Create new rack layout.

    INSERT INTO public.locations(
        area_id,code,name,is_active
    )
    SELECT
        a.id,r.rack,
        coalesce(nullif(trim(r.name),''),r.rack),
        true
    FROM jsonb_to_recordset(b.racks) AS r(
        warehouse text,area text,rack text,name text
    )
    JOIN public.wms_warehouse_config c
      ON c.warehouse_key=r.warehouse
    JOIN public.stock_areas a
      ON a.warehouse_id=c.warehouse_id
     AND upper(a.area_type::text)=r.area;

    -- Replace opening stock.

    INSERT INTO public.inventory(
        variant_id,location_id,qty_on_hand
    )
    SELECT
        pv.id,l.id,s.qty
    FROM jsonb_to_recordset(b.stock) AS s(
        sku text,warehouse text,rack text,qty integer
    )
    JOIN public.product_variants pv ON pv.sku=s.sku
    JOIN public.wms_warehouse_config c
      ON c.warehouse_key=s.warehouse
    JOIN public.stock_areas a
      ON a.warehouse_id=c.warehouse_id
    JOIN public.locations l
      ON l.area_id=a.id
     AND l.code=s.rack
     AND l.is_active
    WHERE s.qty>0;

    INSERT INTO public.stock_movements(
        movement_type,variant_id,
        from_location_id,to_location_id,
        quantity,reason,reference_no,created_by
    )
    SELECT
        'opening',i.variant_id,NULL,i.location_id,
        i.qty_on_hand,
        'Fresh Opening Stock',
        v_ref,auth.uid()
    FROM public.inventory i
    WHERE i.qty_on_hand>0
    ORDER BY i.variant_id,i.location_id;

    -- Reconcile exact SKU and rack balances.

    SELECT coalesce(sum(qty_on_hand),0)
    INTO v_actual
    FROM public.inventory;

    IF v_actual<>v_expected THEN
        RAISE EXCEPTION 'FAIL: Opening stock total differs';
    END IF;

    IF EXISTS (
        WITH expected AS (
            SELECT s.sku,s.warehouse,s.rack,s.qty
            FROM jsonb_to_recordset(b.stock) AS s(
                sku text,warehouse text,rack text,qty integer
            )
            WHERE s.qty>0
        ),
        actual AS (
            SELECT
                pv.sku,c.warehouse_key AS warehouse,
                l.code AS rack,i.qty_on_hand AS qty
            FROM public.inventory i
            JOIN public.product_variants pv
              ON pv.id=i.variant_id
            JOIN public.locations l ON l.id=i.location_id
            JOIN public.stock_areas a ON a.id=l.area_id
            JOIN public.wms_warehouse_config c
              ON c.warehouse_id=a.warehouse_id
        )
        (
            SELECT * FROM expected
            EXCEPT
            SELECT * FROM actual
        )
        UNION ALL
        (
            SELECT * FROM actual
            EXCEPT
            SELECT * FROM expected
        )
    ) THEN
        RAISE EXCEPTION 'FAIL: SKU/rack reconciliation differs';
    END IF;

    IF (
        SELECT count(*) FROM public.locations
        WHERE is_active
    )<>jsonb_array_length(b.racks) THEN
        RAISE EXCEPTION 'FAIL: Active rack reconciliation';
    END IF;

    UPDATE public.wms_opening_batches
    SET status='APPLIED',
        applied_at=now(),
        applied_by=auth.uid()
    WHERE id=p_batch_id;

    UPDATE public.wms_runtime_state
    SET phase='READY',
        updated_at=now(),
        updated_by=auth.uid()
    WHERE id=1;

    RETURN jsonb_build_object(
        'batch_id',p_batch_id,
        'status','APPLIED',
        'phase','READY',
        'reference',v_ref,
        'total_stock',v_actual
    );

END;
$fn$;

-- ==========================================
-- 12. OWNER GO LIVE
-- ==========================================

CREATE FUNCTION public.wms_activate_go_live(
    p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY['owner']::public.app_user_role[]
    );

    IF p_confirmation IS DISTINCT FROM 'GO LIVE' THEN
        RAISE EXCEPTION 'Konfirmasi Owner belum sesuai';
    END IF;

    UPDATE public.wms_runtime_state
    SET phase='LIVE',
        updated_at=now(),
        updated_by=auth.uid()
    WHERE id=1
      AND phase='READY'
      AND EXISTS (
          SELECT 1
          FROM public.wms_opening_batches
          WHERE status='APPLIED'
      )
      AND (
          SELECT count(*)
          FROM public.wms_warehouse_config c
          JOIN public.warehouses w
            ON w.id=c.warehouse_id
          WHERE w.is_active
      )=2;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'WMS belum siap atau sudah aktif';
    END IF;

    RETURN jsonb_build_object('phase','LIVE');
END;
$fn$;

-- ==========================================
-- 13. WAREHOUSE CONTROL CENTER
-- ==========================================

CREATE FUNCTION public.wms_control_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    v_role text;
    v_admin boolean;
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY[
            'owner','admin',
            'warehouse_manager','warehouse_staff','viewer'
        ]::public.app_user_role[]
    );

    SELECT role::text INTO v_role
    FROM public.profiles WHERE id=auth.uid();

    v_admin:=v_role IN ('owner','admin');

    RETURN jsonb_build_object(
        'role',v_role,
        'phase',(
            SELECT phase
            FROM public.wms_runtime_state WHERE id=1
        ),
        'warehouses',(
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id',w.id,
                    'key',c.warehouse_key,
                    'name',w.name,
                    'is_active',w.is_active,
                    'can_operate',public.wms_can_operate(w.id),
                    'qty',(
                        SELECT coalesce(sum(i.qty_on_hand),0)
                        FROM public.inventory i
                        JOIN public.locations l
                          ON l.id=i.location_id
                        JOIN public.stock_areas a
                          ON a.id=l.area_id
                        WHERE a.warehouse_id=w.id
                    )
                )
                ORDER BY c.warehouse_key DESC
            )
            FROM public.wms_warehouse_config c
            JOIN public.warehouses w ON w.id=c.warehouse_id
        ),
        'in_transit',(
            SELECT coalesce(sum(l.qty),0)
            FROM public.wms_interwarehouse_transfer_lines l
            JOIN public.wms_interwarehouse_transfers t
              ON t.id=l.transfer_id
            WHERE t.status='IN_TRANSIT'
        ),
        'open_opnames',(
            SELECT count(*)
            FROM public.stock_opname_sessions
            WHERE status NOT IN ('finalized','cancelled')
        ),
        'staff',CASE WHEN v_admin THEN (
            SELECT coalesce(jsonb_agg(
                jsonb_build_object(
                    'id',p.id,
                    'name',p.full_name,
                    'role',p.role,
                    'is_active',p.is_active,
                    'warehouse_ids',(
                        SELECT coalesce(
                            jsonb_agg(sw.warehouse_id),
                            '[]'::jsonb
                        )
                        FROM public.wms_staff_warehouses sw
                        WHERE sw.profile_id=p.id
                    )
                )
                ORDER BY p.full_name,p.id
            ),'[]'::jsonb)
            FROM public.profiles p
            WHERE p.role::text IN (
                'warehouse_staff','warehouse_manager'
            )
        ) ELSE '[]'::jsonb END,
        'latest_batch',CASE WHEN v_admin THEN (
            SELECT jsonb_build_object(
                'batch_id',b.id,
                'status',b.status,
                'preview',b.preview,
                'created_at',b.created_at
            )
            FROM public.wms_opening_batches b
            ORDER BY
                CASE WHEN b.status='APPLIED'
                    THEN 0 ELSE 1 END,
                b.created_at DESC
            LIMIT 1
        ) ELSE NULL END
    );
END;
$fn$;

-- ==========================================
-- 14. PRIVILEGES
-- ==========================================

REVOKE ALL ON FUNCTION
    public.wms_require_live(),
    public.wms_can_operate(uuid),
    public.wms_assert_warehouse_access(uuid),
    public.wms_assert_warehouse_active(uuid),
    public.wms_guard_inventory_write(),
    public.wms_guard_movement_access(),
    public.wms_guard_opname_line(),
    public.wms_guard_opname_session(),
    public.wms_opening_fingerprint(),
    public.wms_validate_opening(jsonb,jsonb)
FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION
    public.wms_set_staff_warehouses(uuid,uuid[]),
    public.wms_dispatch_transfer(uuid,uuid,uuid,jsonb,text),
    public.wms_receive_transfer(uuid,jsonb),
    public.wms_transfer_list(),
    public.wms_preview_opening(jsonb,jsonb),
    public.wms_apply_opening(uuid,text),
    public.wms_activate_go_live(text),
    public.wms_control_state(),
    public.wms_list_warehouses()
FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION
    public.wms_set_staff_warehouses(uuid,uuid[]),
    public.wms_dispatch_transfer(uuid,uuid,uuid,jsonb,text),
    public.wms_receive_transfer(uuid,jsonb),
    public.wms_transfer_list(),
    public.wms_preview_opening(jsonb,jsonb),
    public.wms_apply_opening(uuid,text),
    public.wms_activate_go_live(text),
    public.wms_control_state(),
    public.wms_list_warehouses()
TO authenticated;

-- Prevent staff from moving rack ownership or bypassing
-- warehouse assignments through master table edits.

REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON
    public.warehouses,
    public.stock_areas,
    public.locations
FROM PUBLIC,anon,authenticated;

REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON
    public.inventory,
    public.stock_movements
FROM PUBLIC,anon,authenticated;

-- ==========================================
-- 15. INSTALLATION VERIFICATION
-- ==========================================

DO $verify$
DECLARE
    v_staff uuid;
    v_main uuid;
    v_store uuid;
    v_inventory_count bigint;
    v_stock bigint;
    v_movements bigint;
BEGIN
    SELECT warehouse_id INTO STRICT v_main
    FROM public.wms_warehouse_config
    WHERE warehouse_key='UTAMA';

    SELECT warehouse_id INTO STRICT v_store
    FROM public.wms_warehouse_config
    WHERE warehouse_key='STORE';

    SELECT
        count(*),coalesce(sum(qty_on_hand),0)
    INTO v_inventory_count,v_stock
    FROM public.inventory;

    SELECT count(*) INTO v_movements
    FROM public.stock_movements;

    SELECT id INTO v_staff
    FROM public.profiles
    WHERE role::text='warehouse_staff'
      AND is_active
    ORDER BY id LIMIT 1;

    IF v_staff IS NULL THEN
        RAISE EXCEPTION 'Akun test staff tidak ditemukan';
    END IF;

    PERFORM set_config(
        'request.jwt.claim.sub',v_staff::text,true
    );

    PERFORM set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',v_staff,'role','authenticated'
        )::text,true
    );

    IF NOT public.wms_can_operate(v_main)
       OR public.wms_can_operate(v_store)
    THEN
        RAISE EXCEPTION 'FAIL: Staff warehouse assignment';
    END IF;

    EXECUTE 'SET LOCAL ROLE authenticated';

    -- Staff cannot perform owner opening import.

    BEGIN
        PERFORM public.wms_apply_opening(
            gen_random_uuid(),'GANTI STOK'
        );

        RAISE EXCEPTION 'FAIL: Staff opening access';

    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    -- Staff cannot activate operational mode.

    BEGIN
        PERFORM public.wms_activate_go_live('GO LIVE');

        RAISE EXCEPTION 'FAIL: Staff Go Live access';

    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    -- Staff cannot dispatch during PREPARATION.

    BEGIN
        PERFORM public.wms_dispatch_transfer(
            gen_random_uuid(),
            v_main,v_store,'[]'::jsonb,NULL
        );

        RAISE EXCEPTION 'FAIL: Operational gate';

    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>
            'WMS belum Go Live. Transaksi stok dikunci.'
        THEN
            RAISE;
        END IF;
    END;

    EXECUTE 'RESET ROLE';

    IF (
        SELECT count(*) FROM public.inventory
    )<>v_inventory_count
    OR (
        SELECT coalesce(sum(qty_on_hand),0)
        FROM public.inventory
    )<>v_stock
    OR (
        SELECT count(*) FROM public.stock_movements
    )<>v_movements
    THEN
        RAISE EXCEPTION 'FAIL: Data integrity';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.wms_apply_opening(uuid,text)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.wms_guard_inventory_write()',
        'EXECUTE'
    ) OR has_table_privilege(
        'authenticated',
        'public.locations','UPDATE'
    ) THEN
        RAISE EXCEPTION 'FAIL: Security grants';
    END IF;

END;
$verify$;

COMMIT;

-- ==========================================
-- 16. FINAL INSTALLATION REPORT
-- ==========================================

SELECT
    'V4.6 BACKEND' AS pemeriksaan,
    'PASS' AS status,
    'Finalization components installed' AS detail

UNION ALL
SELECT 'OPERATIONAL GATE','PASS',phase
FROM public.wms_runtime_state WHERE id=1

UNION ALL
SELECT 'STAFF ASSIGNMENT','PASS',count(*)::text
FROM public.wms_staff_warehouses

UNION ALL
SELECT 'TRANSFER DOCUMENTS','INFO',count(*)::text
FROM public.wms_interwarehouse_transfers

UNION ALL
SELECT 'OPENING IMPORT BATCH','INFO',count(*)::text
FROM public.wms_opening_batches

UNION ALL
SELECT 'OPEN STOCK OPNAME','INFO',count(*)::text
FROM public.stock_opname_sessions
WHERE status NOT IN ('finalized','cancelled')

UNION ALL
SELECT 'TOTAL STOCK','INFO',
    coalesce(sum(qty_on_hand),0)::text
FROM public.inventory

UNION ALL
SELECT 'TOTAL MOVEMENT','INFO',count(*)::text
FROM public.stock_movements

UNION ALL
SELECT 'TOTAL SKU','INFO',count(*)::text
FROM public.product_variants

UNION ALL
SELECT 'ACTIVE WAREHOUSE','INFO',count(*)::text
FROM public.warehouses WHERE is_active;