-- Hi.PRIMA WMS V4.4A.1
-- Final Security Lock
-- Permission changes only. No stock transaction.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
    v_base oid;
    v_raw oid;
    v_checked oid;
BEGIN
    v_base := to_regprocedure(
        'public.post_stock_movement(uuid,integer,public.stock_movement_type,uuid,uuid,text,text,text)'
    );
    v_raw := to_regprocedure(
        'public.finalize_stock_opname(uuid)'
    );
    v_checked := to_regprocedure(
        'public.finalize_stock_opname_checked(uuid)'
    );

    IF v_base IS NULL OR v_raw IS NULL
       OR v_checked IS NULL THEN
        RAISE EXCEPTION 'STOP: Fungsi WMS belum lengkap';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid=v_checked
          AND prosecdef=true
          AND position(
              'public.finalize_stock_opname('
              in prosrc
          )>0
          AND position(
              'recount_qty' in prosrc
          )>0
    ) THEN
        RAISE EXCEPTION
            'STOP: Fungsi finalize checked tidak sesuai';
    END IF;

    IF (SELECT proowner FROM pg_proc WHERE oid=v_raw)
       IS DISTINCT FROM
       (SELECT proowner FROM pg_proc WHERE oid=v_checked)
    THEN
        RAISE EXCEPTION
            'STOP: Owner fungsi finalize berbeda';
    END IF;
END;
$preflight$;

-- Tutup akses langsung fungsi internal.
REVOKE EXECUTE ON FUNCTION
    public.post_stock_movement(
        uuid,integer,public.stock_movement_type,
        uuid,uuid,text,text,text
    )
FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.post_stock_movement(
    uuid,integer,public.stock_movement_type,
    uuid,uuid,text,text,text
)
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION
    public.finalize_stock_opname(uuid)
FROM PUBLIC, anon, authenticated;

-- Mencabut izin TRUNCATE, bukan menghapus data.
REVOKE TRUNCATE ON TABLE
    public.inventory,
    public.stock_movements
FROM PUBLIC, anon, authenticated;

-- Pastikan tidak ada pemanggil database yang
-- kehilangan hak menjalankan fungsi internal.
DO $dependencies$
DECLARE
    r record;
    v_target oid;
BEGIN
    FOR r IN
        SELECT
            p.oid,
            p.proname,
            p.proowner,
            p.prosecdef,
            p.prosrc
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.prokind='f'
          AND p.proname NOT IN (
              'post_stock_movement',
              'finalize_stock_opname'
          )
          AND (
              p.prosrc ~* '\mpost_stock_movement\M'
              OR p.prosrc ~* '\mfinalize_stock_opname\M'
          )
    LOOP
        IF NOT r.prosecdef THEN
            RAISE EXCEPTION
                'STOP: Perlu audit dependency %',
                r.proname;
        END IF;

        IF r.prosrc ~* '\mpost_stock_movement\M' THEN
            v_target := to_regprocedure(
                'public.post_stock_movement(uuid,integer,public.stock_movement_type,uuid,uuid,text,text,text)'
            );

            IF NOT has_function_privilege(
                r.proowner,v_target,'EXECUTE'
            ) THEN
                RAISE EXCEPTION
                    'STOP: Dependency % kehilangan akses',
                    r.proname;
            END IF;
        END IF;

        IF r.prosrc ~* '\mfinalize_stock_opname\M' THEN
            v_target := to_regprocedure(
                'public.finalize_stock_opname(uuid)'
            );

            IF NOT has_function_privilege(
                r.proowner,v_target,'EXECUTE'
            ) THEN
                RAISE EXCEPTION
                    'STOP: Dependency % kehilangan akses',
                    r.proname;
            END IF;
        END IF;
    END LOOP;
END;
$dependencies$;

-- Verifikasi hak akses sebelum COMMIT.
DO $verify$
DECLARE
    v_role text;
    v_function text;
    v_table text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY[
        'anon','authenticated'
    ] LOOP

        IF EXISTS (
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n
                ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN (
                  'post_stock_movement',
                  'finalize_stock_opname',
                  'receive_inbound_stock',
                  'wms_receive_inbound_qc_batch'
              )
              AND has_function_privilege(
                  v_role,p.oid,'EXECUTE'
              )
        ) THEN
            RAISE EXCEPTION
                'FAIL: Fungsi internal masih terbuka';
        END IF;

        FOREACH v_table IN ARRAY ARRAY[
            'public.inventory',
            'public.stock_movements',
            'public.wms_inbound_documents',
            'public.wms_inbound_document_lines'
        ] LOOP
            IF has_table_privilege(
                v_role,v_table,'TRUNCATE'
            )
            OR has_table_privilege(
                v_role,v_table,'DELETE'
            )
            OR has_any_column_privilege(
                v_role,v_table,'INSERT'
            )
            OR has_any_column_privilege(
                v_role,v_table,'UPDATE'
            ) THEN
                RAISE EXCEPTION
                    'FAIL: Hak tulis langsung % pada %',
                    v_role,v_table;
            END IF;
        END LOOP;
    END LOOP;

    FOREACH v_function IN ARRAY ARRAY[
        'public.wms_receive_inbound_document(uuid,uuid,text,date,text,text,jsonb)',
        'public.outbound_stock(uuid,uuid,integer,text,text)',
        'public.transfer_stock(uuid,uuid,uuid,integer,text,text)',
        'public.receive_return_stock(uuid,uuid,integer,text,text,text)',
        'public.return_stock_to_supplier(uuid,uuid,integer,text,text,text)',
        'public.adjust_stock_to_physical(uuid,uuid,integer,text,text,text)',
        'public.finalize_stock_opname_checked(uuid)',
        'public.wms_inbound_rack_recommendations(uuid,text)'
    ] LOOP
        IF to_regprocedure(v_function) IS NULL THEN
            RAISE EXCEPTION
                'FAIL: RPC resmi tidak ditemukan: %',
                v_function;
        END IF;

        IF NOT has_function_privilege(
            'authenticated',v_function,'EXECUTE'
        ) OR has_function_privilege(
            'anon',v_function,'EXECUTE'
        ) THEN
            RAISE EXCEPTION
                'FAIL: Hak akses RPC resmi: %',
                v_function;
        END IF;
    END LOOP;
END;
$verify$;

COMMIT;