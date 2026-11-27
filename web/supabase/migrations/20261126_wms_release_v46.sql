BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- Review old opname sessions.

CREATE FUNCTION public.wms_preparation_opnames()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY['owner','admin']::public.app_user_role[]
    );

    RETURN coalesce((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
        FROM (
            SELECT
                s.id,s.session_code,s.opname_type,
                s.status,s.created_at,s.notes,
                (
                    SELECT count(*)
                    FROM public.stock_opname_lines l
                    WHERE l.session_id=s.id
                ) AS total_lines
            FROM public.stock_opname_sessions s
            WHERE s.status IN ('draft','counting','review')
        ) x
    ),'[]'::jsonb);
END;
$fn$;

CREATE FUNCTION public.wms_cancel_preparation_opnames(
    p_session_ids uuid[],
    p_confirmation text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
    v_phase text;
    v_count bigint;
BEGIN
    PERFORM public.assert_wms_role(
        ARRAY['owner']::public.app_user_role[]
    );

    IF p_confirmation IS DISTINCT FROM 'BATALKAN'
       OR coalesce(cardinality(p_session_ids),0)=0
    THEN
        RAISE EXCEPTION 'Konfirmasi pembatalan tidak valid';
    END IF;

    SELECT phase INTO STRICT v_phase
    FROM public.wms_runtime_state
    WHERE id=1 FOR SHARE;

    IF v_phase<>'PREPARATION' THEN
        RAISE EXCEPTION 'WMS bukan dalam fase persiapan';
    END IF;

    UPDATE public.stock_opname_sessions
    SET status='cancelled',
        cancelled_at=now(),
        cancelled_by=auth.uid(),
        updated_at=now()
    WHERE id=ANY(p_session_ids)
      AND status IN ('draft','counting','review');

    GET DIAGNOSTICS v_count=ROW_COUNT;

    IF v_count<>cardinality(p_session_ids) THEN
        RAISE EXCEPTION 'Status sesi berubah atau ID tidak valid';
    END IF;

    RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION
    public.wms_preparation_opnames(),
    public.wms_cancel_preparation_opnames(uuid[],text)
FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION
    public.wms_preparation_opnames(),
    public.wms_cancel_preparation_opnames(uuid[],text)
TO authenticated;

-- Full temporary cutover + transfer test.
-- All test transactions are rolled back.

DO $regression$
DECLARE
    v_owner uuid;
    v_staff uuid;
    v_receiver uuid;
    v_main uuid;
    v_store uuid;
    v_variant uuid;
    v_sku text;
    v_prefix text;
    v_main_rack uuid;
    v_store_rack uuid;
    v_batch uuid;
    v_transfer uuid:=gen_random_uuid();
    v_transfer_line uuid;
    v_session uuid;
    v_old_sessions uuid[];
    v_racks jsonb;
    v_stock jsonb;
    v_dispatch jsonb;
    v_receive jsonb;
    v_result jsonb;
    v_before text;
    v_opname_before text;
    v_assign_before text;
    v_docs_before bigint;
    v_batches_before bigint;
    v_transfers_before bigint;
BEGIN

    IF (
        SELECT phase FROM public.wms_runtime_state
        WHERE id=1
    ) IS DISTINCT FROM 'PREPARATION' THEN
        RAISE EXCEPTION 'STOP: WMS harus PREPARATION';
    END IF;

    SELECT id INTO v_owner
    FROM public.profiles
    WHERE role::text='owner' AND is_active
    ORDER BY id LIMIT 1;

    SELECT id INTO v_staff
    FROM public.profiles
    WHERE role::text='warehouse_staff' AND is_active
    ORDER BY id LIMIT 1;

    IF v_owner IS NULL OR v_staff IS NULL THEN
        RAISE EXCEPTION 'Akun owner/staff test tidak tersedia';
    END IF;

    SELECT coalesce((
        SELECT id FROM public.profiles
        WHERE role::text IN ('warehouse_staff','warehouse_manager')
          AND is_active AND id<>v_staff
        ORDER BY id LIMIT 1
    ),v_staff) INTO v_receiver;

    SELECT warehouse_id INTO STRICT v_main
    FROM public.wms_warehouse_config
    WHERE warehouse_key='UTAMA';

    SELECT warehouse_id INTO STRICT v_store
    FROM public.wms_warehouse_config
    WHERE warehouse_key='STORE';

    SELECT id,sku INTO v_variant,v_sku
    FROM public.product_variants
    WHERE is_active
    ORDER BY sku LIMIT 1;

    IF v_variant IS NULL THEN
        RAISE EXCEPTION 'SKU referensi tidak tersedia';
    END IF;

    v_before:=public.wms_opening_fingerprint();

    SELECT md5(coalesce(
        string_agg(to_jsonb(s)::text,'|' ORDER BY s.id),''
    )) INTO v_opname_before
    FROM public.stock_opname_sessions s;

    SELECT md5(coalesce(
        string_agg(to_jsonb(s)::text,'|'
            ORDER BY s.profile_id,s.warehouse_id),''
    )) INTO v_assign_before
    FROM public.wms_staff_warehouses s;

    SELECT count(*) INTO v_docs_before
    FROM public.wms_inbound_documents;

    SELECT count(*) INTO v_batches_before
    FROM public.wms_opening_batches;

    SELECT count(*) INTO v_transfers_before
    FROM public.wms_interwarehouse_transfers;

    -- Everything inside this block is temporary.

    BEGIN

        v_prefix:='QA-'||upper(left(
            replace(gen_random_uuid()::text,'-',''),10
        ));

        SELECT jsonb_agg(jsonb_build_object(
            'warehouse',w.code,
            'area',a.code,
            'rack',v_prefix||'-'||a.suffix,
            'name','Temporary QA Rack'
        ))
        INTO v_racks
        FROM (VALUES ('UTAMA'),('STORE')) w(code)
        CROSS JOIN (
            VALUES
                ('NORMAL','N'),
                ('DEFECT','D'),
                ('REJECT','R')
        ) a(code,suffix);

        v_stock:=jsonb_build_array(
            jsonb_build_object(
                'sku',v_sku,'warehouse','UTAMA',
                'rack',v_prefix||'-N','qty',3
            ),
            jsonb_build_object(
                'sku',v_sku,'warehouse','STORE',
                'rack',v_prefix||'-N','qty',2
            )
        );

        SELECT coalesce(array_agg(id),ARRAY[]::uuid[])
        INTO v_old_sessions
        FROM public.stock_opname_sessions
        WHERE status IN ('draft','counting','review');

        PERFORM set_config(
            'request.jwt.claim.sub',v_owner::text,true
        );

        PERFORM set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub',v_owner,'role','authenticated'
            )::text,true
        );

        EXECUTE 'SET LOCAL ROLE authenticated';

        IF cardinality(v_old_sessions)>0 THEN
            PERFORM public.wms_cancel_preparation_opnames(
                v_old_sessions,'BATALKAN'
            );
        END IF;

        PERFORM public.wms_set_staff_warehouses(
            v_staff,ARRAY[v_main]
        );

        v_result:=public.wms_preview_opening(
            v_racks,v_stock
        );

        v_batch:=(v_result->>'batch_id')::uuid;

        IF (v_result->'preview'->>'new_total')::integer<>5
        THEN
            RAISE EXCEPTION 'FAIL: Opening preview';
        END IF;

        v_result:=public.wms_apply_opening(
            v_batch,'GANTI STOK'
        );

        IF v_result->>'phase'<>'READY' THEN
            RAISE EXCEPTION 'FAIL: Opening apply';
        END IF;

        IF (
            SELECT coalesce(sum(qty_on_hand),0)
            FROM public.inventory
        )<>5 THEN
            RAISE EXCEPTION 'FAIL: Replace total';
        END IF;

        -- Confirm that READY does not permit transfer.

        BEGIN
            PERFORM public.wms_dispatch_transfer(
                v_transfer,v_main,v_store,'[]',NULL
            );

            RAISE EXCEPTION 'FAIL: READY gate';

        EXCEPTION WHEN raise_exception THEN
            IF SQLERRM<>
                'WMS belum Go Live. Transaksi stok dikunci.'
            THEN
                RAISE;
            END IF;
        END;

        PERFORM public.wms_activate_go_live('GO LIVE');

        SELECT l.id INTO STRICT v_main_rack
        FROM public.locations l
        JOIN public.stock_areas a ON a.id=l.area_id
        WHERE a.warehouse_id=v_main
          AND l.code=v_prefix||'-N'
          AND l.is_active;

        SELECT l.id INTO STRICT v_store_rack
        FROM public.locations l
        JOIN public.stock_areas a ON a.id=l.area_id
        WHERE a.warehouse_id=v_store
          AND l.code=v_prefix||'-N'
          AND l.is_active;

        -- Switch to actual staff permission.

        PERFORM set_config(
            'request.jwt.claim.sub',v_staff::text,true
        );

        PERFORM set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub',v_staff,'role','authenticated'
            )::text,true
        );

        BEGIN
            PERFORM 1 FROM public.wms_scoped_racks(
                v_store,v_variant,NULL,false
            );

            RAISE EXCEPTION 'FAIL: Cross-warehouse access';

        EXCEPTION WHEN insufficient_privilege THEN
            NULL;
        END;

        v_dispatch:=jsonb_build_array(
            jsonb_build_object(
                'variant_id',v_variant,
                'from_location_id',v_main_rack,
                'qty',1
            )
        );

        v_result:=public.wms_dispatch_transfer(
            v_transfer,v_main,v_store,v_dispatch,'QA'
        );

        IF v_result->>'status'<>'IN_TRANSIT' THEN
            RAISE EXCEPTION 'FAIL: Transfer dispatch';
        END IF;

        -- Same request must not deduct stock again.

        PERFORM public.wms_dispatch_transfer(
            v_transfer,v_main,v_store,v_dispatch,'QA'
        );

        IF (
            SELECT qty_on_hand FROM public.inventory
            WHERE variant_id=v_variant
              AND location_id=v_main_rack
        ) IS DISTINCT FROM 2 THEN
            RAISE EXCEPTION 'FAIL: Dispatch or duplicate request';
        END IF;

        IF (
            SELECT qty_on_hand FROM public.inventory
            WHERE variant_id=v_variant
              AND location_id=v_store_rack
        ) IS DISTINCT FROM 2 THEN
            RAISE EXCEPTION 'FAIL: Premature receipt';
        END IF;

        SELECT (item->>'line_id')::uuid
        INTO STRICT v_transfer_line
        FROM jsonb_array_elements(public.wms_transfer_list())
            AS d(doc)
        CROSS JOIN LATERAL jsonb_array_elements(d.doc->'lines')
            AS l(item)
        WHERE d.doc->>'id'=v_transfer::text;

        v_receive:=jsonb_build_array(
            jsonb_build_object(
                'line_id',v_transfer_line,
                'to_location_id',v_store_rack
            )
        );

        BEGIN
            PERFORM public.wms_receive_transfer(
                v_transfer,v_receive
            );

            RAISE EXCEPTION 'FAIL: Wrong staff receipt';

        EXCEPTION WHEN insufficient_privilege THEN
            NULL;
        END;

        -- Owner assigns receiving staff to Store.

        PERFORM set_config(
            'request.jwt.claim.sub',v_owner::text,true
        );

        PERFORM set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub',v_owner,'role','authenticated'
            )::text,true
        );

        PERFORM public.wms_set_staff_warehouses(
            v_receiver,ARRAY[v_store]
        );

        PERFORM set_config(
            'request.jwt.claim.sub',v_receiver::text,true
        );

        PERFORM set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub',v_receiver,'role','authenticated'
            )::text,true
        );

        PERFORM public.wms_receive_transfer(
            v_transfer,v_receive
        );

        PERFORM public.wms_receive_transfer(
            v_transfer,v_receive
        );

        IF (
            SELECT qty_on_hand FROM public.inventory
            WHERE variant_id=v_variant
              AND location_id=v_store_rack
        ) IS DISTINCT FROM 3 THEN
            RAISE EXCEPTION 'FAIL: Receipt or duplicate receipt';
        END IF;

        IF (
            SELECT coalesce(sum(qty_on_hand),0)
            FROM public.inventory
        )<>5 THEN
            RAISE EXCEPTION 'FAIL: Transfer conservation';
        END IF;

        -- Actual Offline Store outbound.

        PERFORM 1
        FROM public.post_outbound_transaction(
            v_variant,v_store_rack,1,
            'QA-'||v_transfer::text,
            'sale','Offline Store',0,NULL
        );

        IF (
            SELECT qty_on_hand FROM public.inventory
            WHERE variant_id=v_variant
              AND location_id=v_store_rack
        ) IS DISTINCT FROM 2 THEN
            RAISE EXCEPTION 'FAIL: Store outbound';
        END IF;

        -- Verify full opname scope.

        PERFORM set_config(
            'request.jwt.claim.sub',v_owner::text,true
        );

        PERFORM set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub',v_owner,'role','authenticated'
            )::text,true
        );

        SELECT s.session_id INTO STRICT v_session
        FROM public.wms_create_stock_opname_scoped(
            v_store,'full',NULL,'Temporary QA'
        ) s;

        IF NOT EXISTS (
            SELECT 1 FROM public.stock_opname_lines
            WHERE session_id=v_session
        ) OR EXISTS (
            SELECT 1
            FROM public.stock_opname_lines ol
            JOIN public.locations l ON l.id=ol.location_id
            JOIN public.stock_areas a ON a.id=l.area_id
            WHERE ol.session_id=v_session
              AND a.warehouse_id<>v_store
        ) THEN
            RAISE EXCEPTION 'FAIL: Full opname warehouse scope';
        END IF;

        EXECUTE 'RESET ROLE';

        -- Force rollback of every temporary change.

        RAISE EXCEPTION USING
            ERRCODE='ZX001',
            MESSAGE='V46_QA_ROLLBACK';

    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
        IF SQLERRM<>'V46_QA_ROLLBACK' THEN
            RAISE;
        END IF;
    END;

    EXECUTE 'RESET ROLE';

    IF public.wms_opening_fingerprint()
        IS DISTINCT FROM v_before
    THEN
        RAISE EXCEPTION 'FAIL: Inventory or rack fingerprint changed';
    END IF;

    IF (
        SELECT phase FROM public.wms_runtime_state
        WHERE id=1
    ) IS DISTINCT FROM 'PREPARATION' THEN
        RAISE EXCEPTION 'FAIL: Phase rollback';
    END IF;

    IF (
        SELECT md5(coalesce(
            string_agg(to_jsonb(s)::text,'|' ORDER BY s.id),''
        ))
        FROM public.stock_opname_sessions s
    ) IS DISTINCT FROM v_opname_before THEN
        RAISE EXCEPTION 'FAIL: Stock opname rollback';
    END IF;

    IF (
        SELECT md5(coalesce(
            string_agg(to_jsonb(s)::text,'|'
                ORDER BY s.profile_id,s.warehouse_id),''
        ))
        FROM public.wms_staff_warehouses s
    ) IS DISTINCT FROM v_assign_before THEN
        RAISE EXCEPTION 'FAIL: Staff assignment rollback';
    END IF;

    IF (
        SELECT count(*) FROM public.wms_inbound_documents
    )<>v_docs_before
    OR (
        SELECT count(*) FROM public.wms_opening_batches
    )<>v_batches_before
    OR (
        SELECT count(*) FROM public.wms_interwarehouse_transfers
    )<>v_transfers_before
    THEN
        RAISE EXCEPTION 'FAIL: Test documents remain';
    END IF;

END;
$regression$;

-- Created only if all preceding regression checks succeed.

CREATE FUNCTION public.wms_v46_release_status()
RETURNS text
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

    RETURN 'PASS';
END;
$fn$;

REVOKE ALL ON FUNCTION
    public.wms_v46_release_status()
FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION
    public.wms_v46_release_status()
TO authenticated;

SELECT
    'V4.6 FINAL REGRESSION' AS pemeriksaan,
    'PASS' AS status,
    'Opening, transfer, receipt, security, sale, opname scope, rollback' AS detail

UNION ALL
SELECT 'TOTAL STOK','INFO',coalesce(sum(qty_on_hand),0)::text
FROM public.inventory

UNION ALL
SELECT 'TOTAL MOVEMENT','INFO',count(*)::text
FROM public.stock_movements

UNION ALL
SELECT 'OPEN OPNAME','INFO',count(*)::text
FROM public.stock_opname_sessions
WHERE status IN ('draft','counting','review')

UNION ALL
SELECT 'TRANSFER DOCUMENTS','INFO',count(*)::text
FROM public.wms_interwarehouse_transfers

UNION ALL
SELECT 'OPENING BATCHES','INFO',count(*)::text
FROM public.wms_opening_batches

UNION ALL
SELECT 'OPERATIONAL PHASE','PASS',phase
FROM public.wms_runtime_state WHERE id=1;

COMMIT;