-- HI.PRIMA WMS V4.3C Production Planning MVP.
-- Additive, transactional, and dormant by default. Does not modify existing
-- PO, inventory, product, HPP, Review, or simulation-approval rows.
BEGIN;

DO $preflight$
DECLARE
  item record;
  column_name name;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('public.profiles', 'id'),
      ('public.profiles', 'role'),
      ('public.profiles', 'is_active'),
      ('public.wms_vendor_master', 'id'),
      ('public.wms_vendor_master', 'vendor_name'),
      ('public.wms_vendor_master', 'is_active'),
      ('public.wms_vendor_product_parameters', 'id'),
      ('public.wms_vendor_product_parameters', 'vendor_id'),
      ('public.product_variants', 'id'),
      ('public.product_variants', 'product_id'),
      ('public.product_variants', 'sku'),
      ('public.product_variants', 'color'),
      ('public.product_variants', 'hpp'),
      ('public.product_variants', 'cost_price'),
      ('public.product_variants', 'is_active'),
      ('public.product_variant_price_history', 'variant_id'),
      ('public.product_variant_price_history', 'hpp'),
      ('public.product_variant_price_history', 'created_at'),
      ('public.products', 'id'),
      ('public.products', 'product_code'),
      ('public.products', 'name'),
      ('public.wms_production_review_batches', 'id'),
      ('public.wms_production_review_batches', 'status'),
      ('public.wms_production_review_batches', 'notes'),
      ('public.wms_production_review_lines', 'id'),
      ('public.wms_production_review_lines', 'batch_id'),
      ('public.wms_production_review_lines', 'variant_id'),
      ('public.wms_production_review_lines', 'decision'),
      ('public.wms_production_review_lines', 'proposed_qty'),
      ('public.wms_production_review_lines', 'review_notes'),
      ('public.wms_sim_approval_requests', 'batch_id'),
      ('public.wms_po_orders', 'id'),
      ('public.wms_po_orders', 'status'),
      ('public.wms_po_lines', 'id'),
      ('public.wms_po_lines', 'po_id'),
      ('public.wms_po_lines', 'variant_id'),
      ('public.wms_po_lines', 'unit_hpp'),
      ('public.wms_vendor_product_candidates', 'parameter_id'),
      ('public.wms_vendor_product_candidates', 'candidate_master_id'),
      ('public.wms_vendor_product_candidates', 'product_code'),
      ('public.wms_vendor_product_candidates', 'vendor_name'),
      ('public.wms_vendor_product_candidates', 'lead_time_days'),
      ('public.wms_vendor_product_candidates', 'lifecycle_status'),
      ('public.wms_vendor_product_candidates', 'moq_type'),
      ('public.wms_vendor_product_candidates', 'moq_quantity'),
      ('public.wms_vendor_product_candidates', 'review_status'),
      ('public.wms_vendor_product_candidates', 'master_match_count')
    ) AS expected(object_name, column_name)
  LOOP
    IF to_regclass(item.object_name) IS NULL OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = split_part(item.object_name, '.', 1)
        AND c.table_name = split_part(item.object_name, '.', 2)
        AND c.column_name = item.column_name
    ) THEN
      RAISE EXCEPTION 'V4.3C preflight failed: missing %.%',
        item.object_name, item.column_name;
    END IF;
  END LOOP;

  IF to_regprocedure('public.wms_po_create_auto(uuid,date,date,text)') IS NULL
     OR to_regprocedure('public.wms_po_add_line(uuid,uuid,integer,numeric,date)') IS NULL
     OR to_regprocedure('public.wms_po_approve_seasonal(uuid)') IS NULL
     OR to_regprocedure('public.wms_po_require_role(boolean)') IS NULL
     OR to_regprocedure('public.assert_wms_role(public.app_user_role[])') IS NULL THEN
    RAISE EXCEPTION 'V4.3C preflight failed: required secured PO/stock RPC is missing.';
  END IF;
  IF NOT has_function_privilege(current_user,'public.wms_po_create_auto(uuid,date,date,text)','EXECUTE')
     OR NOT has_function_privilege(current_user,'public.wms_po_add_line(uuid,uuid,integer,numeric,date)','EXECUTE')
     OR NOT has_function_privilege(current_user,'public.wms_po_approve_seasonal(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'V4.3C preflight failed: migration owner cannot invoke secured PO RPCs.';
  END IF;

  IF has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('anon', 'public.profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'V4.3C preflight failed: profiles direct UPDATE is still granted.';
  END IF;
  FOR column_name IN
    SELECT a.attname FROM pg_attribute a
    WHERE a.attrelid='public.profiles'::regclass
      AND a.attnum>0 AND NOT a.attisdropped
  LOOP
    IF has_column_privilege('authenticated','public.profiles',column_name,'UPDATE')
       OR has_column_privilege('anon','public.profiles',column_name,'UPDATE') THEN
      RAISE EXCEPTION 'V4.3C preflight failed: direct UPDATE is granted on profiles.%.',column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid='public.wms_production_review_lines'::regclass
      AND t.tgname='trg_guard_sim_review_lines_v42f'
      AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
  ) THEN
    RAISE EXCEPTION 'V4.3C preflight failed: existing V4.3B.6 Review Lines guard is missing or disabled.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('wms_v436_guard_review_batch','wms_v436_lock_sim_request_batch')
      AND (
        p.proname='wms_v436_guard_review_batch'
          AND (position('public.wms_sim_approval_requests' IN p.prosrc)=0
            OR position('request.batch_id = old.id' IN lower(p.prosrc))=0)
        OR p.proname='wms_v436_lock_sim_request_batch'
          AND (position('for update' IN lower(p.prosrc))=0
            OR position('batch.id = new.batch_id' IN lower(p.prosrc))=0
            OR position('draft' IN lower(p.prosrc))=0)
      )
  ) THEN
    RAISE EXCEPTION 'V4.3C preflight failed: existing V4.3B.6 Review guard function does not match the reviewed behavior.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN (
      'wms_v43c_operational_config',
      'wms_vendor_variant_quotes',
      'wms_production_operational_approvals',
      'wms_production_po_conversions'
    )
  ) OR to_regprocedure('public.wms_v43c_assert_role(text[])') IS NOT NULL THEN
    RAISE EXCEPTION 'V4.3C preflight failed: migration objects already exist.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.wms_v436_guard_review_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.wms_sim_approval_requests request
    WHERE request.batch_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Review Draft is immutable after simulation submission.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wms_v436_lock_sim_request_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_batch_id uuid;
BEGIN
  SELECT batch.id
  INTO v_batch_id
  FROM public.wms_production_review_batches batch
  WHERE batch.id = NEW.batch_id
    AND batch.status::text = 'DRAFT'
  FOR UPDATE;

  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION
      'Simulation submission requires an existing DRAFT batch.'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.wms_v436_guard_review_batch(),
  public.wms_v436_lock_sim_request_batch()
FROM PUBLIC, anon, authenticated;

DO $install_v436_review_guards$
DECLARE
  v_total integer;
  v_active integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE t.tgenabled IN ('O','A')
                                     AND t.tgtype=27)
  INTO v_total, v_active
  FROM pg_trigger t
  WHERE t.tgrelid='public.wms_production_review_batches'::regclass
    AND t.tgfoid='public.wms_v436_guard_review_batch()'::regprocedure
    AND NOT t.tgisinternal;
  IF v_total=0 THEN
    IF EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid='public.wms_production_review_batches'::regclass
        AND t.tgname='trg_wms_v436_guard_review_batch'
        AND NOT t.tgisinternal
    ) THEN
      RAISE EXCEPTION 'V4.3C refuses to replace an unexpected Review batch trigger.';
    END IF;
    EXECUTE 'CREATE TRIGGER trg_wms_v436_guard_review_batch
      BEFORE UPDATE OR DELETE ON public.wms_production_review_batches
      FOR EACH ROW EXECUTE FUNCTION public.wms_v436_guard_review_batch()';
  ELSIF v_total<>1 OR v_active<>1 THEN
    RAISE EXCEPTION 'V4.3C found an inactive, malformed, or duplicate V4.3B.6 Review batch trigger.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE t.tgenabled IN ('O','A')
                                     AND t.tgtype=7)
  INTO v_total, v_active
  FROM pg_trigger t
  WHERE t.tgrelid='public.wms_sim_approval_requests'::regclass
    AND t.tgfoid='public.wms_v436_lock_sim_request_batch()'::regprocedure
    AND NOT t.tgisinternal;
  IF v_total=0 THEN
    IF EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid='public.wms_sim_approval_requests'::regclass
        AND t.tgname='trg_wms_v436_lock_sim_request_batch'
        AND NOT t.tgisinternal
    ) THEN
      RAISE EXCEPTION 'V4.3C refuses to replace an unexpected simulation request trigger.';
    END IF;
    EXECUTE 'CREATE TRIGGER trg_wms_v436_lock_sim_request_batch
      BEFORE INSERT ON public.wms_sim_approval_requests
      FOR EACH ROW EXECUTE FUNCTION public.wms_v436_lock_sim_request_batch()';
  ELSIF v_total<>1 OR v_active<>1 THEN
    RAISE EXCEPTION 'V4.3C found an inactive, malformed, or duplicate V4.3B.6 request trigger.';
  END IF;
END;
$install_v436_review_guards$;

CREATE TABLE public.wms_v43c_operational_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.wms_v43c_operational_config(singleton, enabled)
VALUES (true, false);

CREATE TABLE public.wms_vendor_variant_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.wms_vendor_master(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  unit_price numeric(14,2) NOT NULL CHECK (unit_price > 0),
  currency char(3) NOT NULL CHECK (currency = 'IDR'),
  source_type text NOT NULL CHECK (source_type IN ('DOCUMENT','EMAIL','PORTAL','OTHER')),
  evidence_ref text NOT NULL CHECK (
    length(btrim(evidence_ref)) BETWEEN 1 AND 400
    AND btrim(evidence_ref) !~* '^https?://'
  ),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  verified_at timestamptz,
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (
    (status='VERIFIED' AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
    OR status <> 'VERIFIED'
  )
);
CREATE INDEX wms_v43c_quotes_lookup_idx
  ON public.wms_vendor_variant_quotes(vendor_id, variant_id, status, valid_from, valid_until);

CREATE TABLE public.wms_vendor_variant_quote_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.wms_vendor_variant_quotes(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATED','VERIFIED','REJECTED')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.wms_vendor_moq_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.wms_vendor_master(id) ON DELETE RESTRICT,
  parameter_id uuid NOT NULL REFERENCES public.wms_vendor_product_parameters(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.wms_production_review_batches(id) ON DELETE RESTRICT,
  moq_type text NOT NULL CHECK (moq_type='BY_REQUEST'),
  scope_key text NOT NULL,
  requested_qty integer NOT NULL CHECK (requested_qty > 0),
  confirmed_minimum_qty integer CHECK (
    confirmed_minimum_qty IS NULL OR confirmed_minimum_qty > 0
  ),
  evidence_ref text NOT NULL CHECK (
    length(btrim(evidence_ref)) BETWEEN 1 AND 400
    AND btrim(evidence_ref) !~* '^https?://'
  ),
  confirmed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wms_v43c_moq_confirmations_scope_idx
  ON public.wms_vendor_moq_confirmations(batch_id,vendor_id,parameter_id,scope_key,confirmed_at DESC);

CREATE TABLE public.wms_production_vendor_selections (
  line_id uuid PRIMARY KEY REFERENCES public.wms_production_review_lines(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.wms_production_review_batches(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES public.wms_vendor_master(id) ON DELETE RESTRICT,
  parameter_id uuid NOT NULL REFERENCES public.wms_vendor_product_parameters(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL REFERENCES public.wms_vendor_variant_quotes(id) ON DELETE RESTRICT,
  moq_confirmation_id uuid REFERENCES public.wms_vendor_moq_confirmations(id) ON DELETE RESTRICT,
  selected_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  selected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.wms_production_operational_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL UNIQUE
    REFERENCES public.wms_production_review_batches(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED','APPROVED','REJECTED')),
  submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_role text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  draft_fingerprint text NOT NULL,
  decided_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decided_role text,
  decided_at timestamptz,
  decision_notes text,
  CHECK (
    (status='SUBMITTED' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('APPROVED','REJECTED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(decision_notes,''))) > 0)
);

CREATE TABLE public.wms_production_operational_approval_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL
    REFERENCES public.wms_production_operational_approvals(id) ON DELETE RESTRICT,
  source_review_line_id uuid NOT NULL
    REFERENCES public.wms_production_review_lines(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES public.wms_vendor_master(id) ON DELETE RESTRICT,
  parameter_id uuid NOT NULL REFERENCES public.wms_vendor_product_parameters(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL REFERENCES public.wms_vendor_variant_quotes(id) ON DELETE RESTRICT,
  moq_confirmation_id uuid REFERENCES public.wms_vendor_moq_confirmations(id) ON DELETE RESTRICT,
  sku_snapshot text NOT NULL,
  product_code_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  color_snapshot text,
  proposed_qty integer NOT NULL CHECK (proposed_qty > 0),
  master_hpp_snapshot numeric(14,2) NOT NULL CHECK (master_hpp_snapshot > 0),
  master_hpp_history_snapshot numeric(14,2) NOT NULL CHECK (master_hpp_history_snapshot > 0),
  master_hpp_history_at_snapshot timestamptz NOT NULL,
  vendor_unit_price_snapshot numeric(14,2) NOT NULL CHECK (vendor_unit_price_snapshot > 0),
  currency_snapshot char(3) NOT NULL CHECK (currency_snapshot = 'IDR'),
  quote_verified_at_snapshot timestamptz NOT NULL,
  lead_time_days_snapshot integer NOT NULL CHECK (lead_time_days_snapshot BETWEEN 1 AND 365),
  lifecycle_status_snapshot text NOT NULL,
  moq_type_snapshot text NOT NULL
    CHECK (moq_type_snapshot IN ('PER_PRODUCT','PER_COLOR','BY_REQUEST')),
  moq_scope_key_snapshot text NOT NULL,
  moq_quantity_snapshot integer CHECK (moq_quantity_snapshot IS NULL OR moq_quantity_snapshot > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(approval_id, source_review_line_id)
);

CREATE TABLE public.wms_production_operational_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL
    REFERENCES public.wms_production_operational_approvals(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('SUBMITTED','APPROVED','REJECTED')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_role text NOT NULL,
  draft_fingerprint text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.wms_production_po_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_batch_id uuid NOT NULL UNIQUE
    REFERENCES public.wms_production_review_batches(id) ON DELETE RESTRICT,
  operational_approval_id uuid NOT NULL
    REFERENCES public.wms_production_operational_approvals(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL UNIQUE,
  request_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('GENERATING','COMPLETED')),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.wms_production_po_conversion_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id uuid NOT NULL
    REFERENCES public.wms_production_po_conversions(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES public.wms_vendor_master(id) ON DELETE RESTRICT,
  po_id uuid NOT NULL UNIQUE REFERENCES public.wms_po_orders(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversion_id, vendor_id)
);

CREATE TABLE public.wms_production_po_conversion_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id uuid NOT NULL
    REFERENCES public.wms_production_po_conversions(id) ON DELETE RESTRICT,
  conversion_order_id uuid NOT NULL
    REFERENCES public.wms_production_po_conversion_orders(id) ON DELETE RESTRICT,
  source_review_line_id uuid NOT NULL
    REFERENCES public.wms_production_review_lines(id) ON DELETE RESTRICT,
  po_line_id uuid NOT NULL UNIQUE REFERENCES public.wms_po_lines(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL REFERENCES public.wms_vendor_variant_quotes(id) ON DELETE RESTRICT,
  master_hpp_snapshot numeric(14,2) NOT NULL,
  vendor_unit_price_snapshot numeric(14,2) NOT NULL,
  currency_snapshot char(3) NOT NULL CHECK (currency_snapshot = 'IDR'),
  moq_type_snapshot text NOT NULL,
  moq_scope_key_snapshot text NOT NULL,
  moq_quantity_snapshot integer,
  moq_confirmation_id uuid REFERENCES public.wms_vendor_moq_confirmations(id) ON DELETE RESTRICT,
  ordered_qty_snapshot integer NOT NULL CHECK (ordered_qty_snapshot > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversion_id, source_review_line_id)
);

ALTER TABLE public.wms_po_lines
  ADD COLUMN vendor_quote_id uuid
    REFERENCES public.wms_vendor_variant_quotes(id) ON DELETE RESTRICT,
  ADD COLUMN master_hpp_snapshot numeric(14,2),
  ADD COLUMN vendor_unit_price_snapshot numeric(14,2),
  ADD COLUMN vendor_currency_snapshot char(3);

ALTER TABLE public.wms_po_lines
  ADD CONSTRAINT wms_po_lines_v43c_currency_idr_check
  CHECK (vendor_currency_snapshot IS NULL OR vendor_currency_snapshot = 'IDR');

ALTER TABLE public.wms_v43c_operational_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_vendor_variant_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_vendor_variant_quote_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_vendor_moq_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_production_vendor_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_production_operational_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_production_operational_approval_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_production_operational_approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_production_po_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_production_po_conversion_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_production_po_conversion_lines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wms_v43c_operational_config,
  public.wms_vendor_variant_quotes,
  public.wms_vendor_variant_quote_events,
  public.wms_vendor_moq_confirmations,
  public.wms_production_vendor_selections,
  public.wms_production_operational_approvals,
  public.wms_production_operational_approval_lines,
  public.wms_production_operational_approval_events,
  public.wms_production_po_conversions,
  public.wms_production_po_conversion_orders,
  public.wms_production_po_conversion_lines
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.wms_vendor_variant_quotes,
  public.wms_vendor_variant_quote_events,
  public.wms_vendor_moq_confirmations,
  public.wms_production_vendor_selections,
  public.wms_production_operational_approvals,
  public.wms_production_operational_approval_lines,
  public.wms_production_operational_approval_events,
  public.wms_production_po_conversions,
  public.wms_production_po_conversion_orders,
  public.wms_production_po_conversion_lines
TO authenticated;

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'wms_vendor_variant_quotes',
    'wms_vendor_variant_quote_events',
    'wms_vendor_moq_confirmations',
    'wms_production_vendor_selections',
    'wms_production_operational_approvals',
    'wms_production_operational_approval_lines',
    'wms_production_operational_approval_events',
    'wms_production_po_conversions',
    'wms_production_po_conversion_orders',
    'wms_production_po_conversion_lines'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
       USING (EXISTS (
         SELECT 1 FROM public.profiles p
         WHERE p.id=auth.uid() AND p.is_active
           AND p.role IN (''owner'',''admin'',''warehouse_manager'')
       ))',
      table_name || '_v43c_read', table_name
    );
  END LOOP;
END;
$policies$;

CREATE OR REPLACE FUNCTION public.wms_v43c_assert_role(p_roles text[])
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'V4.3C requires an authenticated active profile.';
  END IF;
  SELECT p.role::text INTO v_role
  FROM public.profiles p
  WHERE p.id=auth.uid() AND p.is_active AND p.role::text=ANY(p_roles);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Active account does not have the required Production Planning role.';
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_scope_key(
  p_moq_type text, p_product_id uuid, p_color text, p_variant_id uuid
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog AS $$
  SELECT CASE p_moq_type
    WHEN 'PER_PRODUCT' THEN p_product_id::text
    WHEN 'PER_COLOR' THEN p_product_id::text || ':' || coalesce(p_color,'<NULL>')
    WHEN 'BY_REQUEST' THEN p_variant_id::text
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_review_fingerprint(p_batch_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT md5(jsonb_build_object(
    'id', b.id, 'status', b.status, 'notes', b.notes,
    'lines', coalesce((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id)
      FROM public.wms_production_review_lines l
      WHERE l.batch_id=b.id
    ), '[]'::jsonb)
  )::text)
  FROM public.wms_production_review_batches b
  WHERE b.id=p_batch_id
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_validate_batch(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_invalid bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_production_review_batches b
    WHERE b.id=p_batch_id AND b.status='DRAFT'
  ) THEN
    RAISE EXCEPTION 'Operational approval only accepts a DRAFT Review batch.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_production_review_lines l
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE' AND l.proposed_qty>0
  ) THEN
    RAISE EXCEPTION 'Review Draft has no proposed production lines.';
  END IF;

  SELECT count(*) INTO v_invalid
  FROM public.wms_production_review_lines l
  LEFT JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  LEFT JOIN public.wms_vendor_master vm ON vm.id=s.vendor_id
  LEFT JOIN public.wms_vendor_variant_quotes q ON q.id=s.quote_id
  JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.products prod ON prod.id=pv.product_id
  LEFT JOIN public.wms_vendor_product_candidates c
    ON c.parameter_id=s.parameter_id AND c.candidate_master_id=prod.id
  LEFT JOIN LATERAL (
    SELECT h.hpp,h.created_at
    FROM public.product_variant_price_history h
    WHERE h.variant_id=pv.id
    ORDER BY h.created_at DESC
    LIMIT 1
  ) h ON true
  WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE'
    AND (
      s.line_id IS NULL OR vm.id IS NULL OR NOT vm.is_active
      OR NOT pv.is_active
      OR q.id IS NULL OR q.vendor_id<>s.vendor_id OR q.variant_id<>pv.id
      OR q.status<>'VERIFIED' OR q.valid_from>now()
      OR (q.valid_until IS NOT NULL AND q.valid_until<=now())
      OR c.parameter_id IS NULL OR c.review_status IS DISTINCT FROM 'VERIFIED'
      OR c.master_match_count IS DISTINCT FROM 1
      OR c.candidate_master_id IS DISTINCT FROM prod.id
      OR upper(btrim(c.vendor_name)) IS DISTINCT FROM upper(btrim(vm.vendor_name))
      OR prod.product_code IS NULL OR prod.name IS NULL
      OR c.lifecycle_status IS NULL OR c.lifecycle_status NOT IN ('On Produksi','Seasonal')
      OR c.lead_time_days IS NULL OR c.lead_time_days NOT BETWEEN 1 AND 365
      OR c.moq_type IS NULL OR c.moq_type NOT IN ('PER_PRODUCT','PER_COLOR','BY_REQUEST')
      OR c.moq_type IN ('PER_PRODUCT','PER_COLOR') AND c.moq_quantity IS NULL
      OR pv.hpp IS NULL OR pv.hpp<=0 OR pv.cost_price IS DISTINCT FROM pv.hpp
      OR h.hpp IS NULL OR h.hpp IS DISTINCT FROM pv.hpp
    );
  IF v_invalid>0 THEN
    RAISE EXCEPTION 'Draft has missing or stale vendor, lifecycle, MOQ, active SKU, or consistent HPP data.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wms_production_review_lines l
    JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
    JOIN public.product_variants pv ON pv.id=l.variant_id
    JOIN public.wms_vendor_product_candidates c
      ON c.parameter_id=s.parameter_id AND c.candidate_master_id=pv.product_id
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE'
      AND c.moq_type IN ('PER_PRODUCT','PER_COLOR')
      AND (
        SELECT sum(l2.proposed_qty)
        FROM public.wms_production_review_lines l2
        JOIN public.wms_production_vendor_selections s2 ON s2.line_id=l2.id
        JOIN public.product_variants pv2 ON pv2.id=l2.variant_id
        WHERE l2.batch_id=p_batch_id AND l2.decision='PROPOSE'
          AND s2.vendor_id=s.vendor_id AND s2.parameter_id=s.parameter_id
          AND public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id)
              = public.wms_v43c_scope_key(c.moq_type,pv2.product_id,pv2.color,pv2.id)
      ) < c.moq_quantity
  ) THEN
    RAISE EXCEPTION 'Selected vendor MOQ is not met for one or more product/color scopes.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wms_production_review_lines l
    JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
    JOIN public.product_variants pv ON pv.id=l.variant_id
    JOIN public.wms_vendor_product_candidates c ON c.parameter_id=s.parameter_id
    LEFT JOIN public.wms_vendor_moq_confirmations m
      ON m.id=s.moq_confirmation_id
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE'
      AND c.moq_type='BY_REQUEST'
      AND (
        m.id IS NULL OR m.batch_id<>p_batch_id OR m.vendor_id<>s.vendor_id
        OR m.parameter_id<>s.parameter_id OR m.scope_key<>
          public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id)
        OR (m.valid_until IS NOT NULL AND m.valid_until<=now())
        OR m.requested_qty IS DISTINCT FROM
          (SELECT sum(l2.proposed_qty)::integer
           FROM public.wms_production_review_lines l2
           JOIN public.wms_production_vendor_selections s2 ON s2.line_id=l2.id
           JOIN public.product_variants pv2 ON pv2.id=l2.variant_id
           WHERE l2.batch_id=p_batch_id AND l2.decision='PROPOSE'
             AND s2.vendor_id=s.vendor_id AND s2.parameter_id=s.parameter_id
             AND public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id)
                 = public.wms_v43c_scope_key(c.moq_type,pv2.product_id,pv2.color,pv2.id))
        OR m.confirmed_minimum_qty IS NOT NULL AND m.confirmed_minimum_qty>
          (SELECT sum(l2.proposed_qty)
           FROM public.wms_production_review_lines l2
           JOIN public.wms_production_vendor_selections s2 ON s2.line_id=l2.id
           JOIN public.product_variants pv2 ON pv2.id=l2.variant_id
           WHERE l2.batch_id=p_batch_id AND l2.decision='PROPOSE'
             AND s2.vendor_id=s.vendor_id AND s2.parameter_id=s.parameter_id
             AND public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id)
                 = public.wms_v43c_scope_key(c.moq_type,pv2.product_id,pv2.color,pv2.id))
      )
  ) THEN
    RAISE EXCEPTION 'BY_REQUEST MOQ requires a valid supplier confirmation for the selected scope.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_production_review_lines l
    JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
    JOIN public.product_variants pv ON pv.id=l.variant_id
    JOIN public.wms_vendor_product_candidates c
      ON c.parameter_id=s.parameter_id AND c.candidate_master_id=pv.product_id
    WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE'
      AND c.moq_type='BY_REQUEST'
      AND (
        s.moq_confirmation_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.wms_vendor_moq_confirmations m
          WHERE m.id=s.moq_confirmation_id
            AND m.batch_id=p_batch_id
            AND m.vendor_id=s.vendor_id
            AND m.parameter_id=s.parameter_id
            AND m.moq_type='BY_REQUEST'
            AND m.confirmed_by IS NOT NULL
            AND m.confirmed_at IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'BY_REQUEST MOQ confirmation relation is incomplete.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_validate_approval(p_approval_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_batch_id uuid;
  v_fingerprint text;
BEGIN
  SELECT a.batch_id,a.draft_fingerprint INTO v_batch_id,v_fingerprint
  FROM public.wms_production_operational_approvals a
  WHERE a.id=p_approval_id;
  IF v_batch_id IS NULL OR v_fingerprint IS NULL OR
     public.wms_v43c_review_fingerprint(v_batch_id) IS DISTINCT FROM v_fingerprint THEN
    RAISE EXCEPTION 'Review Draft changed after operational submission.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_production_operational_approval_lines al
    WHERE al.approval_id=p_approval_id
  ) OR (
    SELECT count(*) FROM public.wms_production_review_lines l
    WHERE l.batch_id=v_batch_id AND l.decision='PROPOSE' AND l.proposed_qty>0
  ) IS DISTINCT FROM (
    SELECT count(*) FROM public.wms_production_operational_approval_lines al
    WHERE al.approval_id=p_approval_id
  ) THEN
    RAISE EXCEPTION 'Operational approval is missing one or more immutable line snapshots.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_production_operational_approval_lines al
    LEFT JOIN public.wms_production_review_lines l
      ON l.id=al.source_review_line_id AND l.batch_id=v_batch_id
    LEFT JOIN public.product_variants pv ON pv.id=al.variant_id
    LEFT JOIN public.products prod ON prod.id=al.product_id
    LEFT JOIN public.wms_production_vendor_selections s
      ON s.line_id=al.source_review_line_id
    LEFT JOIN public.wms_vendor_master vm ON vm.id=al.vendor_id
    LEFT JOIN public.wms_vendor_variant_quotes q ON q.id=al.quote_id
    LEFT JOIN public.wms_vendor_product_candidates c
      ON c.parameter_id=al.parameter_id AND c.candidate_master_id=al.product_id
    WHERE al.approval_id=p_approval_id AND (
      l.id IS NULL OR l.decision IS DISTINCT FROM 'PROPOSE'
      OR l.proposed_qty IS DISTINCT FROM al.proposed_qty
      OR l.variant_id IS DISTINCT FROM al.variant_id
      OR pv.id IS NULL OR pv.product_id IS DISTINCT FROM al.product_id
      OR prod.id IS NULL OR al.sku_snapshot IS DISTINCT FROM pv.sku
      OR al.product_code_snapshot IS DISTINCT FROM prod.product_code
      OR al.product_name_snapshot IS DISTINCT FROM prod.name
      OR al.color_snapshot IS DISTINCT FROM pv.color
      OR s.line_id IS NULL OR s.batch_id IS DISTINCT FROM v_batch_id
      OR s.vendor_id IS DISTINCT FROM al.vendor_id
      OR s.parameter_id IS DISTINCT FROM al.parameter_id
      OR s.quote_id IS DISTINCT FROM al.quote_id
      OR s.moq_confirmation_id IS DISTINCT FROM al.moq_confirmation_id
      OR vm.id IS NULL OR q.id IS NULL OR c.parameter_id IS NULL
      OR al.currency_snapshot IS DISTINCT FROM 'IDR'
    )
  ) THEN
    RAISE EXCEPTION 'Operational approval line relation or snapshot is missing or inconsistent.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wms_production_operational_approval_lines al
    JOIN public.product_variants pv ON pv.id=al.variant_id
    JOIN public.wms_vendor_master vm ON vm.id=al.vendor_id
    JOIN public.wms_vendor_variant_quotes q ON q.id=al.quote_id
    LEFT JOIN public.wms_vendor_moq_confirmations m ON m.id=al.moq_confirmation_id
    JOIN public.wms_vendor_product_candidates c
      ON c.parameter_id=al.parameter_id AND c.candidate_master_id=al.product_id
    LEFT JOIN LATERAL (
      SELECT h.hpp,h.created_at FROM public.product_variant_price_history h
      WHERE h.variant_id=pv.id ORDER BY h.created_at DESC LIMIT 1
    ) h ON true
    WHERE al.approval_id=p_approval_id AND (
      NOT pv.is_active OR NOT vm.is_active
      OR q.status<>'VERIFIED' OR q.vendor_id<>al.vendor_id
      OR q.variant_id<>al.variant_id OR q.verified_at IS DISTINCT FROM al.quote_verified_at_snapshot
      OR q.unit_price IS DISTINCT FROM al.vendor_unit_price_snapshot
      OR q.currency IS DISTINCT FROM al.currency_snapshot
      OR q.currency IS DISTINCT FROM 'IDR'
      OR q.valid_from>now() OR (q.valid_until IS NOT NULL AND q.valid_until<=now())
      OR c.review_status IS DISTINCT FROM 'VERIFIED'
      OR c.master_match_count IS DISTINCT FROM 1
      OR upper(btrim(c.vendor_name)) IS DISTINCT FROM upper(btrim(vm.vendor_name))
      OR c.lead_time_days IS DISTINCT FROM al.lead_time_days_snapshot
      OR c.lifecycle_status IS DISTINCT FROM al.lifecycle_status_snapshot
      OR c.moq_type IS DISTINCT FROM al.moq_type_snapshot
      OR c.moq_quantity IS DISTINCT FROM al.moq_quantity_snapshot
      OR al.moq_type_snapshot='BY_REQUEST' AND (
        m.id IS NULL
        OR m.batch_id IS DISTINCT FROM (SELECT a.batch_id
          FROM public.wms_production_operational_approvals a
          WHERE a.id=p_approval_id)
        OR m.vendor_id IS DISTINCT FROM al.vendor_id
        OR m.parameter_id IS DISTINCT FROM al.parameter_id
        OR m.scope_key IS DISTINCT FROM al.moq_scope_key_snapshot
        OR m.requested_qty IS DISTINCT FROM (
          SELECT sum(al2.proposed_qty)::integer
          FROM public.wms_production_operational_approval_lines al2
          WHERE al2.approval_id=al.approval_id
            AND al2.vendor_id=al.vendor_id AND al2.parameter_id=al.parameter_id
            AND al2.moq_scope_key_snapshot=al.moq_scope_key_snapshot
        )
        OR (m.valid_until IS NOT NULL AND m.valid_until<=now())
        OR (m.confirmed_minimum_qty IS NOT NULL AND m.confirmed_minimum_qty>
          (SELECT sum(al2.proposed_qty)::integer
           FROM public.wms_production_operational_approval_lines al2
           WHERE al2.approval_id=al.approval_id
             AND al2.vendor_id=al.vendor_id AND al2.parameter_id=al.parameter_id
             AND al2.moq_scope_key_snapshot=al.moq_scope_key_snapshot))
      )
      OR pv.hpp IS DISTINCT FROM al.master_hpp_snapshot
      OR pv.cost_price IS DISTINCT FROM al.master_hpp_snapshot
      OR h.hpp IS DISTINCT FROM al.master_hpp_history_snapshot
      OR h.created_at IS DISTINCT FROM al.master_hpp_history_at_snapshot
    )
  ) THEN
    RAISE EXCEPTION 'Vendor quote, lifecycle, MOQ, active SKU, or HPP changed after submission.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_workflow_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_enabled boolean;
  v_hpp_guard boolean;
  v_stock_guard_count integer;
  v_review_guard_count integer;
  v_ready boolean;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  SELECT c.enabled INTO v_enabled
  FROM public.wms_v43c_operational_config c WHERE c.singleton;
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid='public.product_variants'::regclass
      AND t.tgname='trg_wms_v43c_active_hpp_account'
      AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
  ) INTO v_hpp_guard;
  SELECT count(*) INTO v_stock_guard_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('transfer_stock','receive_inbound_stock','outbound_stock',
      'adjust_stock_to_physical','receive_return_stock','return_stock_to_supplier')
    AND position('assert_wms_role' IN lower(p.prosrc))>0;
  SELECT count(*) INTO v_review_guard_count
  FROM pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgenabled IN ('O','A')
    AND (
      t.tgrelid='public.wms_production_review_batches'::regclass
      AND t.tgfoid='public.wms_v436_guard_review_batch()'::regprocedure
      AND t.tgtype=27
      OR t.tgrelid='public.wms_sim_approval_requests'::regclass
      AND t.tgfoid='public.wms_v436_lock_sim_request_batch()'::regprocedure
      AND t.tgtype=7
    );
  v_ready := v_hpp_guard AND v_stock_guard_count=6 AND v_review_guard_count=2
    AND to_regprocedure('public.wms_po_create_auto(uuid,date,date,text)') IS NOT NULL
    AND to_regprocedure('public.wms_po_add_line(uuid,uuid,integer,numeric,date)') IS NOT NULL
    AND to_regprocedure('public.wms_v43c_finalize_generated_po(uuid)') IS NOT NULL;
  RETURN jsonb_build_object(
    'enabled',coalesce(v_enabled,false),
    'ready',v_ready,
    'hpp_active_account_guard',v_hpp_guard,
    'secured_stock_rpc_count',v_stock_guard_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_set_operational_enabled(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_status jsonb;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner']);
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Feature state is required.'; END IF;
  IF p_enabled THEN
    v_status := public.wms_v43c_workflow_status();
    IF NOT coalesce((v_status->>'ready')::boolean,false) THEN
      RAISE EXCEPTION 'Production workflow cannot be enabled: backend security readiness checks failed.';
    END IF;
  END IF;
  UPDATE public.wms_v43c_operational_config
  SET enabled=p_enabled,changed_by=auth.uid(),changed_at=now()
  WHERE singleton;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_create_vendor_quote(
  p_vendor_id uuid,p_variant_id uuid,p_unit_price numeric,p_currency text,
  p_source_type text,p_evidence_ref text,p_valid_until timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  IF p_unit_price IS NULL OR p_unit_price<=0
     OR p_currency IS DISTINCT FROM 'IDR'
     OR p_source_type NOT IN ('DOCUMENT','EMAIL','PORTAL','OTHER')
     OR length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 1 AND 400
     OR btrim(p_evidence_ref) ~* '^https?://' THEN
    RAISE EXCEPTION 'Vendor quote price, currency, source, or evidence reference is invalid.';
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until<=now() THEN
    RAISE EXCEPTION 'Quote expiry must be in the future.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wms_vendor_master WHERE id=p_vendor_id AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id=p_variant_id AND is_active) THEN
    RAISE EXCEPTION 'Vendor and SKU must both be active.';
  END IF;
  INSERT INTO public.wms_vendor_variant_quotes(
    vendor_id,variant_id,unit_price,currency,source_type,evidence_ref,valid_until,created_by
  ) VALUES (
    p_vendor_id,p_variant_id,p_unit_price,p_currency,p_source_type,btrim(p_evidence_ref),
    p_valid_until,auth.uid()
  ) RETURNING id INTO v_id;
  INSERT INTO public.wms_vendor_variant_quote_events(quote_id,action,actor_id)
  VALUES(v_id,'CREATED',auth.uid());
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_review_vendor_quote(
  p_quote_id uuid,p_decision text,p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_quote public.wms_vendor_variant_quotes%ROWTYPE;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF p_decision NOT IN ('VERIFIED','REJECTED') THEN
    RAISE EXCEPTION 'Quote decision must be VERIFIED or REJECTED.';
  END IF;
  SELECT * INTO v_quote FROM public.wms_vendor_variant_quotes
  WHERE id=p_quote_id FOR UPDATE;
  IF v_quote.id IS NULL OR v_quote.status<>'PENDING' THEN
    RAISE EXCEPTION 'Only pending vendor quotes can be reviewed.';
  END IF;
  IF v_quote.created_by=auth.uid() THEN
    RAISE EXCEPTION 'Quote creator cannot verify or reject their own quote.';
  END IF;
  IF p_decision='VERIFIED' THEN
    IF v_quote.valid_until IS NOT NULL AND v_quote.valid_until<=now() THEN
      RAISE EXCEPTION 'Expired vendor quote cannot be verified.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wms_vendor_master WHERE id=v_quote.vendor_id AND is_active)
       OR NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id=v_quote.variant_id AND is_active) THEN
      RAISE EXCEPTION 'Inactive vendor or SKU cannot be verified.';
    END IF;
  ELSIF length(btrim(coalesce(p_notes,'')))=0 THEN
    RAISE EXCEPTION 'A reason is required to reject a quote.';
  END IF;
  UPDATE public.wms_vendor_variant_quotes
  SET status=p_decision,verified_by=CASE WHEN p_decision='VERIFIED' THEN auth.uid() END,
      verified_at=CASE WHEN p_decision='VERIFIED' THEN now() END
  WHERE id=p_quote_id;
  INSERT INTO public.wms_vendor_variant_quote_events(quote_id,action,actor_id,notes)
  VALUES(p_quote_id,p_decision,auth.uid(),nullif(btrim(p_notes),''));
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_preview_operational_batch(p_batch_id uuid)
RETURNS TABLE(
  batch_id uuid,line_id uuid,variant_id uuid,sku text,product_code text,
  decision text,proposed_qty integer,hpp_master numeric,cost_price numeric,
  hpp_history numeric,hpp_history_at timestamptz,vendor_id uuid,vendor_name text,
  parameter_id uuid,lead_time_days integer,lifecycle_status text,moq_type text,
  moq_quantity integer,review_status text,quote_id uuid,vendor_unit_price numeric,
  currency char(3),quote_valid_until timestamptz,selected boolean,
  moq_confirmation_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  RETURN QUERY
  SELECT l.batch_id,l.id,pv.id,pv.sku,prod.product_code,l.decision,l.proposed_qty,
    pv.hpp,pv.cost_price,h.hpp,h.created_at,vm.id,vm.vendor_name,c.parameter_id,
    c.lead_time_days,c.lifecycle_status,c.moq_type,c.moq_quantity,c.review_status,
    q.id,q.unit_price,q.currency,q.valid_until,
    (s.line_id IS NOT NULL AND s.vendor_id=vm.id AND s.parameter_id=c.parameter_id
      AND s.quote_id=q.id),
    s.moq_confirmation_id
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.products prod ON prod.id=pv.product_id
  LEFT JOIN LATERAL (
    SELECT ph.hpp,ph.created_at FROM public.product_variant_price_history ph
    WHERE ph.variant_id=pv.id ORDER BY ph.created_at DESC LIMIT 1
  ) h ON true
  LEFT JOIN public.wms_vendor_product_candidates c
    ON c.candidate_master_id=prod.id
  LEFT JOIN public.wms_vendor_master vm
    ON upper(btrim(vm.vendor_name))=upper(btrim(c.vendor_name))
  LEFT JOIN LATERAL (
    SELECT q0.* FROM public.wms_vendor_variant_quotes q0
    WHERE q0.vendor_id=vm.id AND q0.variant_id=pv.id AND q0.status='VERIFIED'
      AND q0.valid_from<=now() AND (q0.valid_until IS NULL OR q0.valid_until>now())
    ORDER BY q0.verified_at DESC LIMIT 1
  ) q ON true
  LEFT JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  WHERE l.batch_id=p_batch_id
  ORDER BY l.id,c.parameter_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_set_vendor_selection(
  p_line_id uuid,p_vendor_id uuid,p_parameter_id uuid,p_quote_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_batch_id uuid;
  v_variant_id uuid;
  v_product_id uuid;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  SELECT l.batch_id,l.variant_id,pv.product_id INTO v_batch_id,v_variant_id,v_product_id
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  WHERE l.id=p_line_id AND l.decision='PROPOSE' AND l.proposed_qty>0
  FOR UPDATE OF l;
  IF v_batch_id IS NULL THEN RAISE EXCEPTION 'Proposed Review line not found.'; END IF;
  PERFORM 1 FROM public.wms_production_review_batches
  WHERE id=v_batch_id AND status='DRAFT' FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.wms_production_operational_approvals WHERE batch_id=v_batch_id
  ) THEN RAISE EXCEPTION 'Submitted or reviewed batches cannot change vendor selection.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_vendor_master vm
    JOIN public.wms_vendor_variant_quotes q ON q.vendor_id=vm.id
    JOIN public.wms_vendor_product_candidates c ON c.parameter_id=p_parameter_id
    WHERE vm.id=p_vendor_id AND vm.is_active
      AND upper(btrim(c.vendor_name))=upper(btrim(vm.vendor_name))
      AND c.candidate_master_id=v_product_id AND c.review_status='VERIFIED'
      AND c.master_match_count=1
      AND q.id=p_quote_id AND q.variant_id=v_variant_id AND q.status='VERIFIED'
      AND q.valid_from<=now() AND (q.valid_until IS NULL OR q.valid_until>now())
  ) THEN RAISE EXCEPTION 'Select an active, verified vendor mapping and current verified quote.'; END IF;
  INSERT INTO public.wms_production_vendor_selections(
    line_id,batch_id,vendor_id,parameter_id,quote_id,selected_by
  ) VALUES(p_line_id,v_batch_id,p_vendor_id,p_parameter_id,p_quote_id,auth.uid())
  ON CONFLICT(line_id) DO UPDATE SET batch_id=excluded.batch_id,
    vendor_id=excluded.vendor_id,parameter_id=excluded.parameter_id,
    quote_id=excluded.quote_id,moq_confirmation_id=NULL,
    selected_by=excluded.selected_by,selected_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_confirm_moq(
  p_line_id uuid,p_confirmed_minimum_qty integer,p_evidence_ref text,p_valid_until timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_batch uuid;v_vendor uuid;v_parameter uuid;v_moq text;v_scope text;
  v_total integer;v_confirmation uuid;v_product uuid;v_color text;v_variant uuid;
BEGIN
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 1 AND 400
     OR btrim(p_evidence_ref) ~* '^https?://'
     OR p_confirmed_minimum_qty IS NOT NULL AND p_confirmed_minimum_qty<=0
     OR p_valid_until IS NOT NULL AND p_valid_until<=now() THEN
    RAISE EXCEPTION 'MOQ confirmation evidence or validity is invalid.';
  END IF;
  SELECT l.batch_id,s.vendor_id,s.parameter_id,c.moq_type,pv.product_id,pv.color,pv.id
  INTO v_batch,v_vendor,v_parameter,v_moq,v_product,v_color,v_variant
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  JOIN public.wms_vendor_product_candidates c ON c.parameter_id=s.parameter_id
    AND c.candidate_master_id=pv.product_id
  WHERE l.id=p_line_id AND l.decision='PROPOSE';
  IF v_batch IS NULL OR v_moq<>'BY_REQUEST' THEN
    RAISE EXCEPTION 'Select a BY_REQUEST vendor before confirming MOQ.';
  END IF;
  PERFORM 1 FROM public.wms_production_review_batches
    WHERE id=v_batch AND status='DRAFT' FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.wms_production_operational_approvals WHERE batch_id=v_batch
  ) THEN RAISE EXCEPTION 'Submitted or reviewed batches cannot change MOQ confirmation.'; END IF;
  v_scope:=public.wms_v43c_scope_key(v_moq,v_product,v_color,v_variant);
  SELECT sum(l.proposed_qty)::integer INTO v_total
  FROM public.wms_production_review_lines l
  JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  JOIN public.product_variants pv ON pv.id=l.variant_id
  WHERE l.batch_id=v_batch AND l.decision='PROPOSE'
    AND s.vendor_id=v_vendor AND s.parameter_id=v_parameter
    AND public.wms_v43c_scope_key(v_moq,pv.product_id,pv.color,pv.id)=v_scope;
  IF v_total IS NULL OR v_total<=0 THEN
    RAISE EXCEPTION 'BY_REQUEST MOQ requires at least one selected proposed unit.';
  END IF;
  INSERT INTO public.wms_vendor_moq_confirmations(
    vendor_id,parameter_id,batch_id,moq_type,scope_key,requested_qty,
    confirmed_minimum_qty,evidence_ref,confirmed_by,valid_until
  ) VALUES (
    v_vendor,v_parameter,v_batch,'BY_REQUEST',v_scope,v_total,
    p_confirmed_minimum_qty,btrim(p_evidence_ref),auth.uid(),p_valid_until
  ) RETURNING id INTO v_confirmation;
  UPDATE public.wms_production_vendor_selections s
  SET moq_confirmation_id=v_confirmation
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  WHERE s.line_id=l.id AND l.batch_id=v_batch AND l.decision='PROPOSE'
    AND s.vendor_id=v_vendor AND s.parameter_id=v_parameter
    AND public.wms_v43c_scope_key(v_moq,pv.product_id,pv.color,pv.id)=v_scope;
  RETURN v_confirmation;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_submit_operational_batch(p_batch_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_role text;v_fingerprint text;v_approval uuid;v_enabled boolean;
BEGIN
  v_role:=public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  SELECT enabled INTO v_enabled FROM public.wms_v43c_operational_config
  WHERE singleton FOR SHARE;
  IF NOT coalesce(v_enabled,false) THEN
    RAISE EXCEPTION 'Operational Approval and Generate PO are disabled.';
  END IF;
  PERFORM 1 FROM public.wms_production_review_batches
  WHERE id=p_batch_id AND status='DRAFT' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review batch must remain DRAFT.'; END IF;
  IF EXISTS (SELECT 1 FROM public.wms_production_operational_approvals WHERE batch_id=p_batch_id) THEN
    RAISE EXCEPTION 'This Draft already has an operational decision; use a new Review Draft for rework.';
  END IF;
  PERFORM public.wms_v43c_validate_batch(p_batch_id);
  v_fingerprint:=public.wms_v43c_review_fingerprint(p_batch_id);
  INSERT INTO public.wms_production_operational_approvals(
    batch_id,status,submitted_by,submitted_role,draft_fingerprint
  ) VALUES(p_batch_id,'SUBMITTED',auth.uid(),v_role,v_fingerprint)
  RETURNING id INTO v_approval;

  INSERT INTO public.wms_production_operational_approval_lines(
    approval_id,source_review_line_id,variant_id,product_id,vendor_id,parameter_id,
    quote_id,moq_confirmation_id,sku_snapshot,product_code_snapshot,
    product_name_snapshot,color_snapshot,proposed_qty,master_hpp_snapshot,
    master_hpp_history_snapshot,master_hpp_history_at_snapshot,
    vendor_unit_price_snapshot,currency_snapshot,quote_verified_at_snapshot,
    lead_time_days_snapshot,lifecycle_status_snapshot,moq_type_snapshot,
    moq_scope_key_snapshot,moq_quantity_snapshot
  )
  SELECT v_approval,l.id,pv.id,prod.id,s.vendor_id,s.parameter_id,s.quote_id,
    s.moq_confirmation_id,pv.sku,prod.product_code,prod.name,pv.color,l.proposed_qty,
    pv.hpp,h.hpp,h.created_at,q.unit_price,q.currency,q.verified_at,
    c.lead_time_days,c.lifecycle_status,c.moq_type,
    public.wms_v43c_scope_key(c.moq_type,pv.product_id,pv.color,pv.id),c.moq_quantity
  FROM public.wms_production_review_lines l
  JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.products prod ON prod.id=pv.product_id
  JOIN public.wms_production_vendor_selections s ON s.line_id=l.id
  JOIN public.wms_vendor_variant_quotes q ON q.id=s.quote_id
  JOIN public.wms_vendor_product_candidates c ON c.parameter_id=s.parameter_id
    AND c.candidate_master_id=prod.id
  JOIN LATERAL (
    SELECT ph.hpp,ph.created_at FROM public.product_variant_price_history ph
    WHERE ph.variant_id=pv.id ORDER BY ph.created_at DESC LIMIT 1
  ) h ON true
  WHERE l.batch_id=p_batch_id AND l.decision='PROPOSE';

  INSERT INTO public.wms_production_operational_approval_events(
    approval_id,action,actor_id,actor_role,draft_fingerprint
  ) VALUES(v_approval,'SUBMITTED',auth.uid(),v_role,v_fingerprint);
  RETURN v_approval;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_decide_operational_approval(
  p_approval_id uuid,p_decision text,p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_role text;v_approval public.wms_production_operational_approvals%ROWTYPE;
  v_enabled boolean;
BEGIN
  v_role:=public.wms_v43c_assert_role(ARRAY['owner','admin']);
  IF p_decision NOT IN ('APPROVED','REJECTED') THEN
    RAISE EXCEPTION 'Operational decision must be APPROVED or REJECTED.';
  END IF;
  IF p_decision='REJECTED' AND length(btrim(coalesce(p_notes,'')))=0 THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;
  SELECT enabled INTO v_enabled FROM public.wms_v43c_operational_config WHERE singleton;
  IF NOT coalesce(v_enabled,false) THEN
    RAISE EXCEPTION 'Operational approval is disabled.';
  END IF;
  SELECT * INTO v_approval FROM public.wms_production_operational_approvals
  WHERE id=p_approval_id FOR UPDATE;
  IF v_approval.id IS NULL OR v_approval.status<>'SUBMITTED' THEN
    RAISE EXCEPTION 'Only submitted operational requests can be decided.';
  END IF;
  IF v_approval.submitted_by=auth.uid() THEN
    RAISE EXCEPTION 'The submitter cannot approve or reject their own Draft.';
  END IF;
  PERFORM public.wms_v43c_validate_approval(p_approval_id);
  UPDATE public.wms_production_operational_approvals
  SET status=p_decision,decided_by=auth.uid(),decided_role=v_role,
      decided_at=now(),decision_notes=nullif(btrim(p_notes),'')
  WHERE id=p_approval_id;
  INSERT INTO public.wms_production_operational_approval_events(
    approval_id,action,actor_id,actor_role,draft_fingerprint,notes
  ) VALUES(p_approval_id,p_decision,auth.uid(),v_role,
    v_approval.draft_fingerprint,nullif(btrim(p_notes),''));
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_generate_purchase_orders(p_approval_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_role text;v_approval public.wms_production_operational_approvals%ROWTYPE;
  v_conversion uuid;v_existing public.wms_production_po_conversions%ROWTYPE;
  v_vendor record;v_line record;v_po uuid;v_po_line uuid;v_order_link uuid;
  v_line_map jsonb:='{}'::jsonb;v_po_ids uuid[]:=ARRAY[]::uuid[];
  v_enabled boolean;v_eta date;
BEGIN
  v_role:=public.wms_v43c_assert_role(ARRAY['owner','admin']);
  SELECT enabled INTO v_enabled FROM public.wms_v43c_operational_config WHERE singleton;
  IF NOT coalesce(v_enabled,false) THEN
    RAISE EXCEPTION 'Generate PO is disabled.';
  END IF;
  SELECT * INTO v_approval FROM public.wms_production_operational_approvals
  WHERE id=p_approval_id FOR UPDATE;
  IF v_approval.id IS NULL OR v_approval.status<>'APPROVED' THEN
    RAISE EXCEPTION 'Only an operationally approved Draft can generate PO.';
  END IF;
  PERFORM 1 FROM public.wms_production_review_batches
  WHERE id=v_approval.batch_id FOR UPDATE;
  PERFORM public.wms_v43c_validate_approval(p_approval_id);

  SELECT * INTO v_existing FROM public.wms_production_po_conversions
  WHERE source_batch_id=v_approval.batch_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status<>'COMPLETED'
       OR v_existing.operational_approval_id<>p_approval_id
       OR v_existing.request_fingerprint<>v_approval.draft_fingerprint THEN
      RAISE EXCEPTION 'Existing conversion conflicts with this approved Draft.';
    END IF;
    SELECT array_agg(po_id ORDER BY po_id) INTO v_po_ids
    FROM public.wms_production_po_conversion_orders WHERE conversion_id=v_existing.id;
    RETURN jsonb_build_object('conversion_id',v_existing.id,'po_ids',coalesce(to_jsonb(v_po_ids),'[]'::jsonb),'idempotent',true);
  END IF;

  INSERT INTO public.wms_production_po_conversions(
    source_batch_id,operational_approval_id,idempotency_key,
    request_fingerprint,status,created_by
  ) VALUES(
    v_approval.batch_id,p_approval_id,p_approval_id,
    v_approval.draft_fingerprint,'GENERATING',auth.uid()
  ) RETURNING id INTO v_conversion;

  FOR v_vendor IN
    SELECT al.vendor_id,max(al.lead_time_days_snapshot) AS lead_days
    FROM public.wms_production_operational_approval_lines al
    WHERE al.approval_id=p_approval_id GROUP BY al.vendor_id ORDER BY al.vendor_id
  LOOP
    v_eta:=current_date+v_vendor.lead_days;
    v_po:=public.wms_po_create_auto(
      v_vendor.vendor_id,current_date,v_eta,
      'Generated from operationally approved Production Planning Draft '||v_approval.batch_id::text
    );
    v_po_ids:=array_append(v_po_ids,v_po);

    FOR v_line IN
      SELECT al.* FROM public.wms_production_operational_approval_lines al
      WHERE al.approval_id=p_approval_id AND al.vendor_id=v_vendor.vendor_id
      ORDER BY al.source_review_line_id
    LOOP
      v_po_line:=public.wms_po_add_line(
        v_po,v_line.variant_id,v_line.proposed_qty,NULL,
        current_date+v_line.lead_time_days_snapshot
      );
      UPDATE public.wms_po_lines
      SET vendor_quote_id=v_line.quote_id,
          master_hpp_snapshot=v_line.master_hpp_snapshot,
          vendor_unit_price_snapshot=v_line.vendor_unit_price_snapshot,
          vendor_currency_snapshot=v_line.currency_snapshot
      WHERE id=v_po_line;
      IF EXISTS (
        SELECT 1 FROM public.wms_vendor_product_candidates c
        WHERE c.candidate_master_id=v_line.product_id
          AND c.review_status='VERIFIED' AND c.master_match_count=1
          AND c.lifecycle_status='Seasonal'
      ) THEN
        PERFORM public.wms_po_approve_seasonal(v_po_line);
      END IF;
      v_line_map:=v_line_map||jsonb_build_object(v_line.source_review_line_id::text,v_po_line::text);
    END LOOP;

    INSERT INTO public.wms_production_po_conversion_orders(conversion_id,vendor_id,po_id)
    VALUES(v_conversion,v_vendor.vendor_id,v_po) RETURNING id INTO v_order_link;
    FOR v_line IN
      SELECT al.* FROM public.wms_production_operational_approval_lines al
      WHERE al.approval_id=p_approval_id AND al.vendor_id=v_vendor.vendor_id
      ORDER BY al.source_review_line_id
    LOOP
      INSERT INTO public.wms_production_po_conversion_lines(
        conversion_id,conversion_order_id,source_review_line_id,po_line_id,quote_id,
        master_hpp_snapshot,vendor_unit_price_snapshot,currency_snapshot,
        moq_type_snapshot,moq_scope_key_snapshot,moq_quantity_snapshot,
        moq_confirmation_id,ordered_qty_snapshot
      ) VALUES(
        v_conversion,v_order_link,v_line.source_review_line_id,
        (v_line_map->>v_line.source_review_line_id::text)::uuid,v_line.quote_id,
        v_line.master_hpp_snapshot,v_line.vendor_unit_price_snapshot,v_line.currency_snapshot,
        v_line.moq_type_snapshot,v_line.moq_scope_key_snapshot,v_line.moq_quantity_snapshot,
        v_line.moq_confirmation_id,v_line.proposed_qty
      );
    END LOOP;
  END LOOP;

  UPDATE public.wms_production_po_conversions SET status='COMPLETED'
  WHERE id=v_conversion;
  RETURN jsonb_build_object('conversion_id',v_conversion,'po_ids',to_jsonb(v_po_ids),'idempotent',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_finalize_generated_po(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_role text;v_status text;v_order_vendor uuid;v_approval_id uuid;
BEGIN
  v_role:=public.wms_v43c_assert_role(ARRAY['owner','admin']);
  SELECT o.status,o.vendor_id INTO v_status,v_order_vendor
  FROM public.wms_po_orders o WHERE o.id=p_po_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Only generated DRAFT PO can be finalized.';
  END IF;
  SELECT c.operational_approval_id INTO v_approval_id
  FROM public.wms_production_po_conversion_orders co
  JOIN public.wms_production_po_conversions c ON c.id=co.conversion_id
  JOIN public.wms_production_operational_approvals a ON a.id=c.operational_approval_id
  WHERE co.po_id=p_po_id AND c.status='COMPLETED' AND a.status='APPROVED'
    AND co.vendor_id=v_order_vendor;
  IF v_approval_id IS NULL THEN
    RAISE EXCEPTION 'PO is not linked to an approved operational conversion.';
  END IF;
  PERFORM public.wms_v43c_validate_approval(v_approval_id);
  IF NOT EXISTS (SELECT 1 FROM public.wms_po_lines WHERE po_id=p_po_id)
     OR EXISTS (
       SELECT 1 FROM public.wms_po_lines
       WHERE po_id=p_po_id AND variant_id IS NULL
     ) THEN
    RAISE EXCEPTION 'Generated PO is empty or contains an unmapped SKU.';
  END IF;
  IF (
    SELECT count(*) FROM public.wms_po_lines l WHERE l.po_id=p_po_id
  ) IS DISTINCT FROM (
    SELECT count(*) FROM public.wms_production_po_conversion_lines cl
    JOIN public.wms_production_po_conversion_orders co
      ON co.id=cl.conversion_order_id
    WHERE co.po_id=p_po_id
  ) THEN
    RAISE EXCEPTION 'Generated PO lines do not match their immutable conversion snapshot.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_po_lines l
    LEFT JOIN public.wms_production_po_conversion_lines cl ON cl.po_line_id=l.id
    LEFT JOIN public.wms_production_po_conversion_orders co
      ON co.id=cl.conversion_order_id
    WHERE l.po_id=p_po_id
      AND (cl.id IS NULL OR cl.conversion_id IS DISTINCT FROM co.conversion_id
        OR co.po_id IS DISTINCT FROM p_po_id)
  ) OR EXISTS (
    SELECT 1
    FROM public.wms_production_po_conversion_lines cl
    JOIN public.wms_production_po_conversion_orders co
      ON co.id=cl.conversion_order_id
    WHERE co.po_id=p_po_id
      AND NOT EXISTS (
        SELECT 1 FROM public.wms_po_lines l
        WHERE l.id=cl.po_line_id AND l.po_id=p_po_id
      )
  ) THEN
    RAISE EXCEPTION 'Generated PO line-to-conversion relationship is incomplete or inconsistent.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_po_lines l
    JOIN public.wms_production_po_conversion_lines cl ON cl.po_line_id=l.id
    JOIN public.wms_production_po_conversion_orders co
      ON co.id=cl.conversion_order_id
    LEFT JOIN public.wms_production_operational_approval_lines al
      ON al.approval_id=v_approval_id
      AND al.source_review_line_id=cl.source_review_line_id
    WHERE l.po_id=p_po_id AND (
      al.id IS NULL
      OR cl.conversion_id IS DISTINCT FROM co.conversion_id
      OR co.vendor_id IS DISTINCT FROM v_order_vendor
      OR al.vendor_id IS DISTINCT FROM co.vendor_id
      OR l.variant_id IS DISTINCT FROM al.variant_id
      OR l.ordered_qty IS DISTINCT FROM cl.ordered_qty_snapshot
      OR cl.ordered_qty_snapshot IS DISTINCT FROM al.proposed_qty
      OR l.unit_hpp IS NOT NULL
      OR l.vendor_quote_id IS DISTINCT FROM cl.quote_id
      OR cl.quote_id IS DISTINCT FROM al.quote_id
      OR l.master_hpp_snapshot IS DISTINCT FROM cl.master_hpp_snapshot
      OR cl.master_hpp_snapshot IS DISTINCT FROM al.master_hpp_snapshot
      OR l.vendor_unit_price_snapshot IS DISTINCT FROM cl.vendor_unit_price_snapshot
      OR cl.vendor_unit_price_snapshot IS DISTINCT FROM al.vendor_unit_price_snapshot
      OR l.vendor_currency_snapshot IS DISTINCT FROM cl.currency_snapshot
      OR cl.currency_snapshot IS DISTINCT FROM al.currency_snapshot
      OR cl.currency_snapshot IS DISTINCT FROM 'IDR'
    )
  ) THEN
    RAISE EXCEPTION 'Generated PO financial or quantity snapshots do not match approval.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wms_po_lines l
    JOIN public.wms_production_po_conversion_lines cl ON cl.po_line_id=l.id
    JOIN public.wms_production_operational_approval_lines al
      ON al.approval_id=v_approval_id
      AND al.source_review_line_id=cl.source_review_line_id
    WHERE l.po_id=p_po_id
      AND (
        al.lifecycle_status_snapshot='Seasonal'
        OR EXISTS (
          SELECT 1 FROM public.wms_vendor_product_candidates c
          WHERE c.candidate_master_id=al.product_id
            AND c.review_status='VERIFIED' AND c.master_match_count=1
            AND c.lifecycle_status='Seasonal'
        )
      )
      AND l.seasonal_approved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Seasonal items require the existing Owner/Admin item approval.';
  END IF;

  UPDATE public.wms_po_orders
  SET status='FINAL',finalized_by=auth.uid(),finalized_at=now(),updated_at=now()
  WHERE id=p_po_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_guard_hpp_account()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    IF auth.role()='service_role' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'HPP Master update requires an authenticated active account.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active
  ) THEN
    RAISE EXCEPTION 'Inactive account cannot update HPP Master.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_guard_review_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_batch_id uuid;
BEGIN
  IF TG_TABLE_NAME='wms_production_review_lines'
     AND TG_OP='UPDATE'
     AND OLD.batch_id IS DISTINCT FROM NEW.batch_id THEN
    PERFORM 1 FROM public.wms_production_review_batches b
    WHERE b.id IN (OLD.batch_id,NEW.batch_id)
    ORDER BY b.id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.wms_production_operational_approvals a
      WHERE a.batch_id IN (OLD.batch_id,NEW.batch_id)
        AND a.status IN ('SUBMITTED','APPROVED')
    ) THEN
      RAISE EXCEPTION 'Review Draft is locked by operational submission.';
    END IF;
    RETURN NEW;
  END IF;
  v_batch_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  IF TG_TABLE_NAME='wms_production_review_lines' THEN
    v_batch_id:=CASE WHEN TG_OP='DELETE' THEN OLD.batch_id ELSE NEW.batch_id END;
  END IF;
  IF TG_OP<>'INSERT' THEN
    PERFORM 1 FROM public.wms_production_review_batches WHERE id=v_batch_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.wms_production_review_batches WHERE id=v_batch_id FOR UPDATE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.wms_production_operational_approvals a
    WHERE a.batch_id=v_batch_id AND a.status IN ('SUBMITTED','APPROVED')
  ) THEN
    RAISE EXCEPTION 'Review Draft is locked by operational submission.';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_guard_approval_lines()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Operational approval snapshots are immutable.';
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_guard_moq_confirmation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Supplier MOQ confirmations are immutable; create a new confirmation.';
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_guard_po_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_approval_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.wms_production_po_conversion_orders WHERE po_id=OLD.id) THEN
      RAISE EXCEPTION 'Generated PO cannot be deleted; use the secured PO workflow.';
    END IF;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.wms_production_po_conversion_orders WHERE po_id=OLD.id) THEN
    PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin']);
    IF (to_jsonb(NEW)-ARRAY['status','finalized_by','finalized_at','updated_at'])
       IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','finalized_by','finalized_at','updated_at']) THEN
      RAISE EXCEPTION 'Generated PO order details are frozen.';
    END IF;
    IF OLD.status='DRAFT' AND NEW.status='FINAL' THEN
      SELECT a.id INTO v_approval_id
      FROM public.wms_production_po_conversion_orders co
      JOIN public.wms_production_po_conversions c ON c.id=co.conversion_id
      JOIN public.wms_production_operational_approvals a ON a.id=c.operational_approval_id
      WHERE co.po_id=OLD.id AND c.status='COMPLETED' AND a.status='APPROVED';
      IF v_approval_id IS NULL THEN
        RAISE EXCEPTION 'Generated PO has no current operational approval.';
      END IF;
      PERFORM public.wms_v43c_validate_approval(v_approval_id);
    ELSIF NOT (
      OLD.status='DRAFT' AND NEW.status='CANCELLED'
      OR OLD.status='FINAL' AND NEW.status IN ('CANCELLED','CLOSED')
    ) THEN
      RAISE EXCEPTION 'Generated PO may only be finalized or changed by the secured cancel/close workflow.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_v43c_guard_po_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE
  v_po_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.po_id IS DISTINCT FROM OLD.po_id THEN
    IF EXISTS (
      SELECT 1 FROM public.wms_production_po_conversion_orders
      WHERE po_id IN (OLD.po_id,NEW.po_id)
    ) THEN
      RAISE EXCEPTION 'Generated PO lines cannot be moved between orders.';
    END IF;
    RETURN NEW;
  END IF;
  v_po_id:=CASE WHEN TG_OP='INSERT' THEN NEW.po_id ELSE OLD.po_id END;
  IF NOT EXISTS (
    SELECT 1 FROM public.wms_production_po_conversion_orders WHERE po_id=v_po_id
  ) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' OR TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Lines on generated PO cannot be inserted or deleted.';
  END IF;
  PERFORM public.wms_v43c_assert_role(ARRAY['owner','admin','warehouse_manager']);
  IF NEW.po_id IS DISTINCT FROM OLD.po_id
     OR (to_jsonb(NEW)-ARRAY[
          'cancelled_qty','progress','ready_date','shipped_date','eta_date','notes',
          'seasonal_approved_by','seasonal_approved_at'
        ])
        IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY[
          'cancelled_qty','progress','ready_date','shipped_date','eta_date','notes',
          'seasonal_approved_by','seasonal_approved_at'
        ]) THEN
    RAISE EXCEPTION 'Generated PO line quantities and financial snapshots are frozen.';
  END IF;
  RETURN NEW;
END;
$$;

-- Protect all HPP mutations, including writes performed inside the existing
-- RPC whose implementation is intentionally not replaced.
CREATE TRIGGER trg_wms_v43c_active_hpp_account
BEFORE UPDATE OF hpp,cost_price ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.wms_v43c_guard_hpp_account();

-- These guards freeze operationally submitted Review data. The existing
-- V4.3B.6 line guard remains; its missing batch/request guards were installed above.
CREATE TRIGGER trg_wms_v43c_lock_review_batch
BEFORE UPDATE OR DELETE ON public.wms_production_review_batches
FOR EACH ROW EXECUTE FUNCTION public.wms_v43c_guard_review_write();
CREATE TRIGGER trg_wms_v43c_lock_review_lines
BEFORE INSERT OR UPDATE OR DELETE ON public.wms_production_review_lines
FOR EACH ROW EXECUTE FUNCTION public.wms_v43c_guard_review_write();
CREATE TRIGGER trg_wms_v43c_immutable_approval_lines
BEFORE UPDATE OR DELETE ON public.wms_production_operational_approval_lines
FOR EACH ROW EXECUTE FUNCTION public.wms_v43c_guard_approval_lines();
CREATE TRIGGER trg_wms_v43c_immutable_moq_confirmation
BEFORE UPDATE OR DELETE ON public.wms_vendor_moq_confirmations
FOR EACH ROW EXECUTE FUNCTION public.wms_v43c_guard_moq_confirmation();
CREATE TRIGGER trg_wms_v43c_guard_po_order
BEFORE UPDATE OR DELETE ON public.wms_po_orders
FOR EACH ROW EXECUTE FUNCTION public.wms_v43c_guard_po_order();
CREATE TRIGGER trg_wms_v43c_guard_po_line
BEFORE INSERT OR UPDATE OR DELETE ON public.wms_po_lines
FOR EACH ROW EXECUTE FUNCTION public.wms_v43c_guard_po_line();

REVOKE ALL ON FUNCTION public.wms_v43c_assert_role(text[]),
  public.wms_v43c_scope_key(text,uuid,text,uuid),
  public.wms_v43c_review_fingerprint(uuid),
  public.wms_v43c_validate_batch(uuid),
  public.wms_v43c_validate_approval(uuid),
  public.wms_v43c_guard_hpp_account(),
  public.wms_v43c_guard_review_write(),
  public.wms_v43c_guard_approval_lines(),
  public.wms_v43c_guard_moq_confirmation(),
  public.wms_v43c_guard_po_order(),
  public.wms_v43c_guard_po_line()
FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wms_v43c_workflow_status(),
  public.wms_v43c_set_operational_enabled(boolean),
  public.wms_v43c_create_vendor_quote(uuid,uuid,numeric,text,text,text,timestamptz),
  public.wms_v43c_review_vendor_quote(uuid,text,text),
  public.wms_v43c_preview_operational_batch(uuid),
  public.wms_v43c_set_vendor_selection(uuid,uuid,uuid,uuid),
  public.wms_v43c_confirm_moq(uuid,integer,text,timestamptz),
  public.wms_v43c_submit_operational_batch(uuid),
  public.wms_v43c_decide_operational_approval(uuid,text,text),
  public.wms_v43c_generate_purchase_orders(uuid),
  public.wms_v43c_finalize_generated_po(uuid)
FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wms_v43c_workflow_status(),
  public.wms_v43c_set_operational_enabled(boolean),
  public.wms_v43c_create_vendor_quote(uuid,uuid,numeric,text,text,text,timestamptz),
  public.wms_v43c_review_vendor_quote(uuid,text,text),
  public.wms_v43c_preview_operational_batch(uuid),
  public.wms_v43c_set_vendor_selection(uuid,uuid,uuid,uuid),
  public.wms_v43c_confirm_moq(uuid,integer,text,timestamptz),
  public.wms_v43c_submit_operational_batch(uuid),
  public.wms_v43c_decide_operational_approval(uuid,text,text),
  public.wms_v43c_generate_purchase_orders(uuid),
  public.wms_v43c_finalize_generated_po(uuid)
TO authenticated;

DO $postcheck$
DECLARE
  v_stock_guard_count integer;
  v_trigger_count integer;
  v_review_guard_count integer;
  v_rls_count integer;
BEGIN
  SELECT count(*) INTO v_stock_guard_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('transfer_stock','receive_inbound_stock','outbound_stock',
      'adjust_stock_to_physical','receive_return_stock','return_stock_to_supplier')
    AND position('assert_wms_role' IN lower(p.prosrc))>0;
  IF v_stock_guard_count<>6 THEN
    RAISE EXCEPTION 'V4.3C postcheck failed: expected six role-guarded stock RPCs.';
  END IF;
  IF (SELECT enabled FROM public.wms_v43c_operational_config WHERE singleton) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'V4.3C postcheck failed: operational workflow must remain disabled.';
  END IF;
  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger t
  WHERE t.tgname IN (
    'trg_wms_v43c_active_hpp_account',
    'trg_wms_v43c_lock_review_batch',
    'trg_wms_v43c_lock_review_lines',
    'trg_wms_v43c_immutable_approval_lines',
    'trg_wms_v43c_immutable_moq_confirmation',
    'trg_wms_v43c_guard_po_order',
    'trg_wms_v43c_guard_po_line'
  ) AND NOT t.tgisinternal AND t.tgenabled IN ('O','A');
  IF v_trigger_count<>7 THEN
    RAISE EXCEPTION 'V4.3C postcheck failed: an expected guard trigger is missing or disabled.';
  END IF;
  SELECT count(*) INTO v_review_guard_count
  FROM pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgenabled IN ('O','A')
    AND (
      t.tgrelid='public.wms_production_review_batches'::regclass
      AND t.tgfoid='public.wms_v436_guard_review_batch()'::regprocedure
      AND t.tgtype=27
      OR t.tgrelid='public.wms_sim_approval_requests'::regclass
      AND t.tgfoid='public.wms_v436_lock_sim_request_batch()'::regprocedure
      AND t.tgtype=7
    );
  IF v_review_guard_count<>2 OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid='public.wms_production_review_lines'::regclass
      AND t.tgname='trg_guard_sim_review_lines_v42f'
      AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
  ) THEN
    RAISE EXCEPTION 'V4.3C postcheck failed: Review line/batch/request guards are incomplete.';
  END IF;
  IF has_function_privilege('anon','public.wms_v436_guard_review_batch()','EXECUTE')
     OR has_function_privilege('authenticated','public.wms_v436_guard_review_batch()','EXECUTE')
     OR has_function_privilege('anon','public.wms_v436_lock_sim_request_batch()','EXECUTE')
     OR has_function_privilege('authenticated','public.wms_v436_lock_sim_request_batch()','EXECUTE') THEN
    RAISE EXCEPTION 'V4.3C postcheck failed: trigger-only Review guard RPCs are executable by API roles.';
  END IF;
  SELECT count(*) INTO v_rls_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relrowsecurity
    AND c.relname IN (
      'wms_v43c_operational_config','wms_vendor_variant_quotes',
      'wms_vendor_variant_quote_events','wms_vendor_moq_confirmations',
      'wms_production_vendor_selections','wms_production_operational_approvals',
      'wms_production_operational_approval_lines',
      'wms_production_operational_approval_events',
      'wms_production_po_conversions','wms_production_po_conversion_orders',
      'wms_production_po_conversion_lines'
    );
  IF v_rls_count<>11 THEN
    RAISE EXCEPTION 'V4.3C postcheck failed: RLS is missing on a new workflow table.';
  END IF;
  IF has_table_privilege('authenticated','public.wms_v43c_operational_config','UPDATE')
     OR has_table_privilege('authenticated','public.wms_production_operational_approvals','INSERT')
     OR has_table_privilege('authenticated','public.wms_vendor_variant_quotes','UPDATE') THEN
    RAISE EXCEPTION 'V4.3C postcheck failed: direct API write privilege remains.';
  END IF;
END;
$postcheck$;

COMMIT;
