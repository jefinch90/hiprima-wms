BEGIN;

DO $patch$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_functiondef(
        'public.post_outbound_transaction(uuid,uuid,integer,text,text,text,numeric,text)'::regprocedure
    )
    INTO v_def;

    IF position('assert_wms_role' IN v_def)=0 THEN

        IF v_def !~* '\mbegin\M' THEN
            RAISE EXCEPTION 'Outbound function anchor not found';
        END IF;

        v_def:=regexp_replace(
            v_def,
            '\mbegin\M',
            'BEGIN' || chr(10) ||
            '  PERFORM public.assert_wms_role(ARRAY[''owner'',''admin'',''warehouse_manager'',''warehouse_staff'']::public.app_user_role[]);',
            'i'
        );

        EXECUTE v_def;
    END IF;
END;
$patch$;

REVOKE EXECUTE ON FUNCTION
    public.outbound_stock(uuid,uuid,integer,text,text)
FROM PUBLIC,anon,authenticated;

COMMIT;