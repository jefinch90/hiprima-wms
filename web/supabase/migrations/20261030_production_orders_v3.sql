-- Hi.PRIMA WMS | Production Order V3 Phase 1
-- Run in Supabase SQL Editor, once BEFORE installing UI.
-- Creates only new tables/RPC. No changes to inventory, sales, stock_movements, PO history.
-- Historical Excel rows are placed in REVIEW staging, not Final PO/incoming.
BEGIN;

CREATE TABLE IF NOT EXISTS public.wms_po_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE CHECK (length(btrim(po_number)) BETWEEN 3 AND 80),
  vendor_id uuid NOT NULL REFERENCES public.wms_vendor_master(id) ON DELETE RESTRICT,
  order_date date NOT NULL,
  eta_date date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL','CLOSED','CANCELLED')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  finalized_by uuid REFERENCES auth.users(id),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wms_po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.wms_po_orders(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  source_sku text NOT NULL,
  source_product_name text,
  ordered_qty integer NOT NULL CHECK (ordered_qty > 0),
  cancelled_qty integer NOT NULL DEFAULT 0 CHECK (cancelled_qty >= 0 AND cancelled_qty <= ordered_qty),
  unit_hpp numeric(14,2) CHECK (unit_hpp IS NULL OR unit_hpp >= 0),
  progress text NOT NULL DEFAULT 'UNCONFIRMED'
    CHECK (progress IN ('UNCONFIRMED','IN_PRODUCTION','READY_AT_VENDOR','IN_TRANSIT')),
  ready_date date,
  shipped_date date,
  eta_date date,
  notes text,
  seasonal_approved_by uuid REFERENCES auth.users(id),
  seasonal_approved_at timestamptz,
  source_import_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_po_lines_po_idx ON public.wms_po_lines(po_id);
CREATE INDEX IF NOT EXISTS wms_po_lines_variant_idx ON public.wms_po_lines(variant_id);

CREATE TABLE IF NOT EXISTS public.wms_po_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_line_id uuid NOT NULL REFERENCES public.wms_po_lines(id) ON DELETE RESTRICT,
  stock_movement_id uuid NOT NULL UNIQUE REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  qty_received integer NOT NULL CHECK(qty_received > 0),
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by uuid REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS wms_po_receipts_line_idx ON public.wms_po_receipts(po_line_id);

CREATE TABLE IF NOT EXISTS public.wms_po_excel_initial (
  source_key text NOT NULL,
  source_row integer NOT NULL CHECK(source_row > 0),
  source_date date NOT NULL,
  vendor_raw text NOT NULL,
  product_name text,
  sku_raw text NOT NULL,
  ordered_qty integer NOT NULL CHECK(ordered_qty > 0),
  unit_hpp numeric(14,2),
  source_note text,
  progress text NOT NULL CHECK(progress IN ('UNCONFIRMED','READY_AT_VENDOR')),
  imported_po_id uuid REFERENCES public.wms_po_orders(id),
  PRIMARY KEY(source_key,source_row)
);
CREATE INDEX IF NOT EXISTS wms_po_excel_unimported_idx ON public.wms_po_excel_initial(imported_po_id);

-- No direct inserts or updates from the browser. All changes go via secure RPC.
ALTER TABLE public.wms_po_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_po_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_po_excel_initial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_po_orders,public.wms_po_lines,
  public.wms_po_receipts,public.wms_po_excel_initial FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wms_po_orders,public.wms_po_lines,
  public.wms_po_receipts,public.wms_po_excel_initial TO authenticated;

DROP POLICY IF EXISTS po_v3_read_orders ON public.wms_po_orders;
CREATE POLICY po_v3_read_orders ON public.wms_po_orders FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active
 AND p.role IN ('owner','admin','warehouse_manager')));
DROP POLICY IF EXISTS po_v3_read_lines ON public.wms_po_lines;
CREATE POLICY po_v3_read_lines ON public.wms_po_lines FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active
 AND p.role IN ('owner','admin','warehouse_manager')));
DROP POLICY IF EXISTS po_v3_read_receipts ON public.wms_po_receipts;
CREATE POLICY po_v3_read_receipts ON public.wms_po_receipts FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active
 AND p.role IN ('owner','admin','warehouse_manager')));
DROP POLICY IF EXISTS po_v3_read_excel ON public.wms_po_excel_initial;
CREATE POLICY po_v3_read_excel ON public.wms_po_excel_initial FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active
 AND p.role IN ('owner','admin','warehouse_manager')));

CREATE OR REPLACE FUNCTION public.wms_po_require_role(p_final boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active
   AND (CASE WHEN p_final THEN role IN ('owner','admin')
             ELSE role IN ('owner','admin','warehouse_manager') END)
 ) THEN RAISE EXCEPTION 'Tidak berwenang mengelola PO Produksi.'; END IF;
END $$;

-- Manual creation. Never auto-finalize.
CREATE OR REPLACE FUNCTION public.wms_po_create(
  p_po_number text,p_vendor_id uuid,p_order_date date,p_eta_date date DEFAULT NULL,p_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM public.wms_po_require_role(false);
 IF nullif(btrim(p_po_number),'') IS NULL THEN RAISE EXCEPTION 'Nomor PO wajib diisi.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.wms_vendor_master WHERE id=p_vendor_id AND is_active)
  THEN RAISE EXCEPTION 'Vendor belum aktif/terdaftar.'; END IF;
 INSERT INTO public.wms_po_orders(po_number,vendor_id,order_date,eta_date,notes,created_by)
 VALUES(btrim(p_po_number),p_vendor_id,p_order_date,p_eta_date,p_notes,auth.uid())
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;

-- Add by exact master variant ID; avoids accidental product-color-size mismatch.
CREATE OR REPLACE FUNCTION public.wms_po_add_line(
 p_po_id uuid,p_variant_id uuid,p_qty integer,p_unit_hpp numeric DEFAULT NULL,p_eta_date date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status text;v_sku text;v_product text;v_id uuid;
BEGIN
 PERFORM public.wms_po_require_role(false);
 SELECT status INTO v_status FROM public.wms_po_orders WHERE id=p_po_id FOR UPDATE;
 IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Hanya PO Draft dapat ditambah item.'; END IF;
 IF p_qty IS NULL OR p_qty<=0 THEN RAISE EXCEPTION 'Qty harus lebih dari nol.'; END IF;
 SELECT pv.sku,p.name INTO v_sku,v_product FROM public.product_variants pv
 JOIN public.products p ON p.id=pv.product_id WHERE pv.id=p_variant_id AND pv.is_active;
 IF v_sku IS NULL THEN RAISE EXCEPTION 'Master SKU tidak ditemukan/aktif.'; END IF;
 INSERT INTO public.wms_po_lines(po_id,variant_id,source_sku,source_product_name,ordered_qty,unit_hpp,eta_date)
 VALUES(p_po_id,p_variant_id,v_sku,v_product,p_qty,p_unit_hpp,p_eta_date) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

-- Convert a WHOLE vendor/date group from the uploaded 143-row Excel into ONE Draft.
-- Operator must enter official PO number and choose vendor. This grouping is provisional.
-- Unmatched SKU remains NULL -> cannot Final until reconciled.
CREATE OR REPLACE FUNCTION public.wms_po_import_group(
 p_vendor_raw text,p_source_date date,p_vendor_id uuid,p_po_number text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_po uuid;v_count integer;v_unmapped integer;
BEGIN
 PERFORM public.wms_po_require_role(false);
 IF NOT EXISTS(SELECT 1 FROM public.wms_po_excel_initial e
  WHERE e.source_key='HIPRIMA-PO-20261030' AND e.vendor_raw=p_vendor_raw
    AND e.source_date=p_source_date AND e.imported_po_id IS NULL)
  THEN RAISE EXCEPTION 'Tidak ada data Draft yang belum dipindahkan.'; END IF;
 -- group vendor must match a manually reviewed mapping, not an automatic guess
 IF NOT EXISTS(SELECT 1 FROM public.wms_vendor_master WHERE id=p_vendor_id AND is_active)
  THEN RAISE EXCEPTION 'Vendor tidak ditemukan.'; END IF;
 v_po:=public.wms_po_create(p_po_number,p_vendor_id,p_source_date,NULL,'DRAFT IMPORT Excel; nomor PO dan vendor wajib diverifikasi sebelum final.');
 WITH moved AS (
  INSERT INTO public.wms_po_lines(po_id,variant_id,source_sku,source_product_name,
    ordered_qty,unit_hpp,progress,notes,source_import_key)
  SELECT v_po,
   (SELECT CASE WHEN count(*)=1 THEN (array_agg(pv.id))[1] ELSE NULL END
    FROM public.product_variants pv WHERE upper(btrim(pv.sku))=upper(btrim(e.sku_raw)) AND pv.is_active),
   e.sku_raw,e.product_name,e.ordered_qty,e.unit_hpp,e.progress,e.source_note,
   e.source_key||'/'||e.source_row::text
  FROM public.wms_po_excel_initial e
  WHERE e.source_key='HIPRIMA-PO-20261030' AND e.vendor_raw=p_vendor_raw
    AND e.source_date=p_source_date AND e.imported_po_id IS NULL
  RETURNING variant_id
 ) SELECT count(*),count(*) FILTER (WHERE variant_id IS NULL) INTO v_count,v_unmapped FROM moved;
 UPDATE public.wms_po_excel_initial SET imported_po_id=v_po
 WHERE source_key='HIPRIMA-PO-20261030' AND vendor_raw=p_vendor_raw
 AND source_date=p_source_date AND imported_po_id IS NULL;
 RETURN jsonb_build_object('po_id',v_po,'lines',v_count,'unmapped',v_unmapped);
END $$;

CREATE OR REPLACE FUNCTION public.wms_po_map_line(p_line_id uuid,p_variant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status text;v_sku text;
BEGIN
 PERFORM public.wms_po_require_role(false);
 SELECT o.status INTO v_status FROM public.wms_po_lines l JOIN public.wms_po_orders o ON o.id=l.po_id
 WHERE l.id=p_line_id FOR UPDATE OF o;
 IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Mapping hanya bisa di PO Draft.'; END IF;
 SELECT sku INTO v_sku FROM public.product_variants WHERE id=p_variant_id AND is_active;
 IF v_sku IS NULL THEN RAISE EXCEPTION 'SKU Master tidak aktif/tidak ditemukan.'; END IF;
 UPDATE public.wms_po_lines SET variant_id=p_variant_id WHERE id=p_line_id;
END $$;

CREATE OR REPLACE FUNCTION public.wms_po_set_draft_qty(p_line_id uuid,p_qty integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status text;
BEGIN
 PERFORM public.wms_po_require_role(false);
 SELECT o.status INTO v_status FROM public.wms_po_lines l JOIN public.wms_po_orders o ON o.id=l.po_id
 WHERE l.id=p_line_id FOR UPDATE OF o;
 IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Qty hanya boleh diubah pada PO Draft.'; END IF;
 IF p_qty IS NULL OR p_qty<=0 THEN RAISE EXCEPTION 'Qty harus positif.'; END IF;
 UPDATE public.wms_po_lines SET ordered_qty=p_qty,cancelled_qty=least(cancelled_qty,p_qty) WHERE id=p_line_id;
END $$;

CREATE OR REPLACE FUNCTION public.wms_po_approve_seasonal(p_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status text;
BEGIN
 PERFORM public.wms_po_require_role(true);
 SELECT o.status INTO v_status FROM public.wms_po_lines l JOIN public.wms_po_orders o ON o.id=l.po_id
 WHERE l.id=p_line_id FOR UPDATE OF o;
 IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Approval Seasonal hanya sebelum Final.'; END IF;
 UPDATE public.wms_po_lines SET seasonal_approved_by=auth.uid(),seasonal_approved_at=now() WHERE id=p_line_id;
END $$;

CREATE OR REPLACE FUNCTION public.wms_po_finalize(p_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_order public.wms_po_orders%ROWTYPE;
BEGIN
 PERFORM public.wms_po_require_role(true);
 SELECT * INTO v_order FROM public.wms_po_orders WHERE id=p_po_id FOR UPDATE;
 IF v_order.status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Hanya PO Draft bisa Final.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.wms_po_lines WHERE po_id=p_po_id) THEN RAISE EXCEPTION 'PO belum punya SKU.'; END IF;
 IF EXISTS(SELECT 1 FROM public.wms_po_lines WHERE po_id=p_po_id AND variant_id IS NULL)
 THEN RAISE EXCEPTION 'Masih ada SKU yang belum terhubung Master.'; END IF;
 -- Existing vendor parameter: prohibit Hold / Discontinue. Seasonal requires explicit approval.
 IF EXISTS (
  SELECT 1 FROM public.wms_po_lines l JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.products prod ON prod.id=pv.product_id
  JOIN public.wms_vendor_product_candidates c
   ON upper(btrim(c.product_code))=upper(btrim(prod.product_code))
   AND c.review_status='VERIFIED' AND c.master_match_count=1
  WHERE l.po_id=p_po_id AND c.lifecycle_status IN ('Hold','Discontinue')
 ) THEN RAISE EXCEPTION 'PO memuat produk Hold/Discontinue. Final diblokir.'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.wms_po_lines l JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.products prod ON prod.id=pv.product_id
  JOIN public.wms_vendor_product_candidates c
   ON upper(btrim(c.product_code))=upper(btrim(prod.product_code))
   AND c.review_status='VERIFIED' AND c.master_match_count=1
  WHERE l.po_id=p_po_id AND c.lifecycle_status='Seasonal' AND l.seasonal_approved_at IS NULL
 ) THEN RAISE EXCEPTION 'PO Seasonal memerlukan approval owner/admin per item.'; END IF;
 -- Vendor verified must be the same vendor as PO header when a verified parameter exists.
 IF EXISTS (
  SELECT 1 FROM public.wms_po_lines l JOIN public.product_variants pv ON pv.id=l.variant_id
  JOIN public.products prod ON prod.id=pv.product_id
  JOIN public.wms_vendor_product_candidates c
   ON upper(btrim(c.product_code))=upper(btrim(prod.product_code))
   AND c.review_status='VERIFIED' AND c.master_match_count=1
  JOIN public.wms_vendor_master vm ON vm.id=v_order.vendor_id
  WHERE l.po_id=p_po_id AND upper(btrim(c.vendor_name))<>upper(btrim(vm.vendor_name))
 ) THEN RAISE EXCEPTION 'Vendor PO tidak sama dengan Vendor Verified produk.'; END IF;
 UPDATE public.wms_po_orders SET status='FINAL',finalized_by=auth.uid(),finalized_at=now(),updated_at=now()
 WHERE id=p_po_id;
END $$;

-- Cancel PO only before any stock receipt has been linked.
CREATE OR REPLACE FUNCTION public.wms_po_cancel_order(p_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status text;
BEGIN
 PERFORM public.wms_po_require_role(true);
 SELECT status INTO v_status FROM public.wms_po_orders WHERE id=p_po_id FOR UPDATE;
 IF v_status NOT IN ('DRAFT','FINAL') OR v_status IS NULL THEN
  RAISE EXCEPTION 'PO tidak dapat dibatalkan pada status ini.'; END IF;
 IF EXISTS (SELECT 1 FROM public.wms_po_receipts r JOIN public.wms_po_lines l ON l.id=r.po_line_id
  WHERE l.po_id=p_po_id) THEN RAISE EXCEPTION 'PO sudah ada penerimaan. Selesaikan rekonsiliasi dahulu.'; END IF;
 UPDATE public.wms_po_orders SET status='CANCELLED',updated_at=now() WHERE id=p_po_id;
END $$;

-- Close only when every line has zero outstanding, including cancellations.
CREATE OR REPLACE FUNCTION public.wms_po_close(p_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status text;
BEGIN
 PERFORM public.wms_po_require_role(true);
 SELECT status INTO v_status FROM public.wms_po_orders WHERE id=p_po_id FOR UPDATE;
 IF v_status IS DISTINCT FROM 'FINAL' THEN RAISE EXCEPTION 'Hanya PO Final dapat ditutup.'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.wms_po_lines l
  LEFT JOIN (SELECT po_line_id,sum(qty_received) q FROM public.wms_po_receipts GROUP BY po_line_id) r
  ON r.po_line_id=l.id
  WHERE l.po_id=p_po_id AND l.ordered_qty-l.cancelled_qty-COALESCE(r.q,0)>0
 ) THEN RAISE EXCEPTION 'Masih ada qty belum datang. PO belum bisa ditutup.'; END IF;
 UPDATE public.wms_po_orders SET status='CLOSED',updated_at=now() WHERE id=p_po_id;
END $$;

CREATE OR REPLACE FUNCTION public.wms_po_set_progress(p_line_id uuid,p_progress text,p_eta_date date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status text;
BEGIN
 PERFORM public.wms_po_require_role(false);
 IF p_progress NOT IN ('UNCONFIRMED','IN_PRODUCTION','READY_AT_VENDOR','IN_TRANSIT') OR p_progress IS NULL
 THEN RAISE EXCEPTION 'Status progres tidak valid.'; END IF;
 SELECT o.status INTO v_status FROM public.wms_po_lines l JOIN public.wms_po_orders o ON o.id=l.po_id
 WHERE l.id=p_line_id FOR UPDATE OF o;
 IF v_status NOT IN ('DRAFT','FINAL') THEN RAISE EXCEPTION 'PO tidak aktif.'; END IF;
 UPDATE public.wms_po_lines SET progress=p_progress,
  ready_date=CASE WHEN p_progress='READY_AT_VENDOR' THEN COALESCE(ready_date,current_date) ELSE ready_date END,
  shipped_date=CASE WHEN p_progress='IN_TRANSIT' THEN COALESCE(shipped_date,current_date) ELSE shipped_date END,
  eta_date=COALESCE(p_eta_date,eta_date)
 WHERE id=p_line_id;
END $$;

CREATE OR REPLACE FUNCTION public.wms_po_cancel_qty(p_line_id uuid,p_cancel_qty integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_line public.wms_po_lines%ROWTYPE;v_status text;v_received integer;
BEGIN
 PERFORM public.wms_po_require_role(true);
 SELECT * INTO v_line FROM public.wms_po_lines WHERE id=p_line_id FOR UPDATE;
 SELECT status INTO v_status FROM public.wms_po_orders WHERE id=v_line.po_id FOR UPDATE;
 IF v_status NOT IN ('DRAFT','FINAL') THEN RAISE EXCEPTION 'Status PO tidak aktif.'; END IF;
 SELECT COALESCE(sum(qty_received),0) INTO v_received FROM public.wms_po_receipts WHERE po_line_id=p_line_id;
 IF p_cancel_qty IS NULL OR p_cancel_qty<0 OR p_cancel_qty>v_line.ordered_qty-v_received
  THEN RAISE EXCEPTION 'Qty dibatalkan melebihi sisa yang belum diterima.'; END IF;
 UPDATE public.wms_po_lines SET cancelled_qty=p_cancel_qty WHERE id=p_line_id;
END $$;

-- Linking only to a posted inbound movement with matching SKU and PO reference.
-- Does NOT create a new inbound, and therefore cannot double-increase stock.
CREATE OR REPLACE FUNCTION public.wms_po_link_inbound(p_line_id uuid,p_movement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_l public.wms_po_lines%ROWTYPE;v_order public.wms_po_orders%ROWTYPE;
 v_mv public.stock_movements%ROWTYPE;v_received integer;
BEGIN
 PERFORM public.wms_po_require_role(false);
 SELECT * INTO v_l FROM public.wms_po_lines WHERE id=p_line_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Item PO tidak ditemukan.'; END IF;
 SELECT * INTO v_order FROM public.wms_po_orders WHERE id=v_l.po_id FOR UPDATE;
 IF v_order.status IS DISTINCT FROM 'FINAL' THEN RAISE EXCEPTION 'Penerimaan hanya untuk PO Final.'; END IF;
 SELECT * INTO v_mv FROM public.stock_movements WHERE id=p_movement_id FOR UPDATE;
 IF NOT FOUND OR lower(v_mv.movement_type::text) <> 'inbound' THEN RAISE EXCEPTION 'Perlu transaksi Inbound WMS yang sudah diposting.'; END IF;
 IF v_mv.variant_id IS DISTINCT FROM v_l.variant_id THEN RAISE EXCEPTION 'SKU inbound tidak sesuai item PO.'; END IF;
 IF upper(btrim(coalesce(v_mv.reference_no,''))) <> upper(btrim(v_order.po_number))
 THEN RAISE EXCEPTION 'Nomor referensi Inbound harus sama dengan nomor PO.'; END IF;
 SELECT COALESCE(sum(qty_received),0) INTO v_received FROM public.wms_po_receipts WHERE po_line_id=p_line_id;
 IF v_received+v_mv.quantity > v_l.ordered_qty-v_l.cancelled_qty
  THEN RAISE EXCEPTION 'Penerimaan melebihi sisa PO.'; END IF;
 INSERT INTO public.wms_po_receipts(po_line_id,stock_movement_id,qty_received,linked_by)
 VALUES(p_line_id,p_movement_id,v_mv.quantity,auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.wms_po_inbound_candidates(p_line_id uuid)
RETURNS TABLE(movement_id uuid,movement_no bigint,quantity integer,received_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.wms_po_require_role(false);
 RETURN QUERY SELECT sm.id,sm.movement_no,sm.quantity,sm.created_at
 FROM public.stock_movements sm
 JOIN public.wms_po_lines l ON l.variant_id=sm.variant_id
 JOIN public.wms_po_orders o ON o.id=l.po_id
 LEFT JOIN public.wms_po_receipts r ON r.stock_movement_id=sm.id
 WHERE l.id=p_line_id AND lower(sm.movement_type::text)='inbound'
 AND upper(btrim(coalesce(sm.reference_no,'')))=upper(btrim(o.po_number))
 AND r.id IS NULL ORDER BY sm.created_at DESC LIMIT 100;
END $$;

-- Read-only per-line calculations. Incoming includes ONLY Final order balance.
CREATE OR REPLACE VIEW public.wms_po_line_overview WITH (security_invoker=true) AS
SELECT l.id,l.po_id,o.po_number,o.order_date,o.status AS po_status,
 v.vendor_name,l.variant_id,l.source_sku,l.source_product_name,
 l.ordered_qty,l.cancelled_qty,l.unit_hpp,l.progress,l.eta_date,
 l.ready_date,l.shipped_date,l.seasonal_approved_at,
 COALESCE(r.received_qty,0)::integer AS received_qty,
 GREATEST(0,l.ordered_qty-l.cancelled_qty-COALESCE(r.received_qty,0))::integer AS remaining_qty,
 CASE WHEN o.status='FINAL'
 THEN GREATEST(0,l.ordered_qty-l.cancelled_qty-COALESCE(r.received_qty,0))::integer
 ELSE 0 END AS confirmed_incoming_qty,
 CASE WHEN l.variant_id IS NULL THEN 'SKU_BELUM_MAPPING'
 WHEN o.status='DRAFT' THEN 'DRAFT_BELUM_FINAL'
 WHEN o.status='FINAL' AND l.ordered_qty-l.cancelled_qty-COALESCE(r.received_qty,0)=0 THEN 'SUDAH_DITERIMA'
 WHEN o.status='FINAL' AND COALESCE(r.received_qty,0)>0 THEN 'PARTIAL_RECEIVED'
 WHEN o.status='FINAL' THEN l.progress ELSE o.status END AS tracking_status
FROM public.wms_po_lines l
JOIN public.wms_po_orders o ON o.id=l.po_id
JOIN public.wms_vendor_master v ON v.id=o.vendor_id
LEFT JOIN (SELECT po_line_id,sum(qty_received) AS received_qty FROM public.wms_po_receipts GROUP BY po_line_id) r
 ON r.po_line_id=l.id;
REVOKE ALL ON public.wms_po_line_overview FROM PUBLIC,anon;
GRANT SELECT ON public.wms_po_line_overview TO authenticated;

-- Deploy safe RPC privileges, not broad table-write privileges.
REVOKE ALL ON FUNCTION public.wms_po_require_role(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_create(text,uuid,date,date,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_add_line(uuid,uuid,integer,numeric,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_import_group(text,date,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_map_line(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_set_draft_qty(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_approve_seasonal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_finalize(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_close(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_cancel_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_set_progress(uuid,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_cancel_qty(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_link_inbound(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wms_po_inbound_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wms_po_require_role(boolean),public.wms_po_create(text,uuid,date,date,text),
 public.wms_po_add_line(uuid,uuid,integer,numeric,date),public.wms_po_import_group(text,date,uuid,text),
 public.wms_po_map_line(uuid,uuid),public.wms_po_set_draft_qty(uuid,integer),public.wms_po_approve_seasonal(uuid),public.wms_po_finalize(uuid),
 public.wms_po_set_progress(uuid,text,date),public.wms_po_close(uuid),public.wms_po_cancel_order(uuid),public.wms_po_cancel_qty(uuid,integer),
 public.wms_po_link_inbound(uuid,uuid),public.wms_po_inbound_candidates(uuid) TO authenticated;

-- INSERT historical staging rows below, idempotent and NOT counted as incoming.

INSERT INTO public.wms_po_excel_initial
(source_key,source_row,source_date,vendor_raw,product_name,sku_raw,ordered_qty,unit_hpp,source_note,progress) VALUES
    ('HIPRIMA-PO-20261030', 1, '2026-06-15'::date, 'CVMitra', 'BZ17-Ava Cropped Blazer', 'BZ17-Ash', 14, 165000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 2, '2026-06-15'::date, 'CVMitra', 'BZ17-Ava Cropped Blazer', 'BZ17-Black', 10, 165000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 3, '2026-06-15'::date, 'CVMitra', 'BZ17-Ava Cropped Blazer', 'BZ17-Creme', 8, 165000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 4, '2026-06-15'::date, 'CVMitra', 'BZ17-Ava Cropped Blazer', 'BZ17-Darkgrey', 15, 165000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 5, '2026-06-15'::date, 'CVMitra', 'BZ17-Ava Cropped Blazer', 'BZ17-Khaki', 10, 165000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 6, '2026-06-15'::date, 'CVMitra', 'BZ17-Ava Cropped Blazer', 'BZ17-Oat', 14, 165000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 7, '2026-06-15'::date, 'CVMitra', 'BZ17-Ava Cropped Blazer', 'BZ17-Sand', 10, 165000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 8, '2026-06-15'::date, 'CVMitra', 'BZ17-Ava Cropped Blazer', 'BZ17-White', 4, 165000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 9, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Black', 16, 125000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 10, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Creme', 10, 125000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 11, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Darkgrey', 16, 125000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 12, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Khaki', 6, 125000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 13, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Oat', 7, 125000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 14, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Sand', 5, 125000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 15, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Black/Long', 21, 133000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 16, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Creme/Long', 10, 133000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 17, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Darkgrey/Long', 13, 133000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 18, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Oat/Long', 11, 133000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 19, '2026-06-26'::date, 'CVMitra', '4636 Meira Skirt - Hi Prima', '4636-Sand/Long', 10, 133000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 20, '2026-06-26'::date, 'CVMitra', 'BZ11-Troy Blazer', 'BZ11-Ash/Furing', 20, 190000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 21, '2026-06-26'::date, 'CVMitra', 'BZ11-Troy Blazer', 'BZ11-Black/Furing', 15, 190000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 22, '2026-06-26'::date, 'CVMitra', 'BZ11-Troy Blazer', 'BZ11-Darkgrey/Furing', 26, 190000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 23, '2026-06-26'::date, 'CVMitra', 'BZ11-Troy Blazer', 'BZ11-Khaki/Furing', 5, 190000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 24, '2026-06-26'::date, 'CVMitra', 'BZ11-Troy Blazer', 'BZ11-Sand/Furing', 25, 190000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 25, '2026-06-26'::date, 'CVMitra', 'BZ40-Shanon Assymetric Blazer', 'BZ40-Creme', 26, 135000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 26, '2026-06-26'::date, 'CVMitra', 'BZ40-Shanon Assymetric Blazer', 'BZ40-Darkgrey', 2, 135000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 27, '2026-06-26'::date, 'CVMitra', 'BZ40-Shanon Assymetric Blazer', 'BZ40-Oat', 1, 135000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 28, '2026-06-26'::date, 'CVMitra', 'BZ40-Shanon Assymetric Blazer', 'BZ40-Sand', 49, 135000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 29, '2026-06-26'::date, 'CVMitra', 'BZ40-Shanon Assymetric Blazer', 'BZ40-White', 2, 135000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 30, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-Ashfr/SM', 2, 205000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 31, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-BlackFuring/SM', 12, 205000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 32, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-CremeFuring/SM', 5, 205000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 33, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-DarkgreyFuring/SM', 12, 205000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 34, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-KhakiFuring/SM', 7, 205000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 35, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16OatFuringSM', 6, 205000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 36, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-SandFuring/SM', 12, 205000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 37, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-WhiteFuring/SM', 4, 205000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 38, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-Ashfr/LXL', 7, 210000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 39, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-BlackFuring/LXL', 7, 210000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 40, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-CremeFuring/LXL', 4, 210000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 41, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-DarkgreyFuring/LXL', 6, 210000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 42, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-KhakiFuring/LXL', 2, 210000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 43, '2026-06-26'::date, 'CVMitra', 'BZ16-Eve Long Blazer', 'BZ16-WhiteFuring/LXL', 3, 210000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 44, '2026-06-26'::date, 'CVMitra', 'BZ42 Aghnia Cropped Blazer', 'Bz42-Ash', 9, 160000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 45, '2026-06-26'::date, 'CVMitra', 'BZ42 Aghnia Cropped Blazer', 'BZ42-Black', 15, 160000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 46, '2026-06-26'::date, 'CVMitra', 'BZ42 Aghnia Cropped Blazer', 'BZ42-Darkgrey', 10, 160000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 47, '2026-06-26'::date, 'CVMitra', 'BZ42 Aghnia Cropped Blazer', 'BZ42-Khaki', 5, 160000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 48, '2026-06-26'::date, 'CVMitra', 'BZ42 Aghnia Cropped Blazer', 'BZ42-Oat', 7, 160000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 49, '2026-06-26'::date, 'CVMitra', 'BZ42 Aghnia Cropped Blazer', 'BZ42-Sand', 15, 160000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 50, '2026-06-26'::date, 'CVMitra', 'BZ42 Aghnia Cropped Blazer', 'BZ42-White', 7, 160000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 51, '2026-06-26'::date, 'CVMitra', 'V37 - Shereen Vest', 'V37-Ash', 5, 140000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 52, '2026-06-26'::date, 'CVMitra', 'V37 - Shereen Vest', 'V37-Black', 8, 140000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 53, '2026-06-26'::date, 'CVMitra', 'V37 - Shereen Vest', 'V37-Creme', 2, 140000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 54, '2026-06-26'::date, 'CVMitra', 'V37 - Shereen Vest', 'V37-Darkgrey', 10, 140000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 55, '2026-06-26'::date, 'CVMitra', 'V37 - Shereen Vest', 'V37-Oat', 5, 140000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 56, '2026-06-26'::date, 'CVMitra', 'V37 - Shereen Vest', 'V37-Sand', 10, 140000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 57, '2026-06-26'::date, 'CVMitra', 'V37 - Shereen Vest', 'V37-White', 4, 140000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 58, '2026-07-13'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49-Darkgrey', 10, 138000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 59, '2026-07-13'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49-Khaki', 1, 138000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 60, '2026-07-13'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49-Oat/LXL', 1, 138000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 61, '2026-07-13'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49-Whitefuring/LXL', 1, 166000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 62, '2026-07-13'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49-Black/SM', 1, 133000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 63, '2026-07-13'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49-Cream/SM', 3, 133000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 64, '2026-08-10'::date, 'CVMitra', 'R19-SHENNA SKIRT', 'R19Brown', 2, 158000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 65, '2026-08-10'::date, 'CVMitra', 'V65 Elena Vest Cotton Eve', 'V65SandSM', 1, 115000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 66, '2026-08-10'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49BrownSM', 1, 133000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 67, '2026-08-10'::date, 'CVMitra', 'OT32-Nara Long Outer Hi Prima', 'OT32-Black', 93, 155000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 68, '2026-08-10'::date, 'CVMitra', 'OT32-Nara Long Outer Hi Prima', 'OT32-Creme', 55, 155000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 69, '2026-08-10'::date, 'CVMitra', 'OT32-Nara Long Outer Hi Prima', 'OT32-Darkgrey', 191, 155000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 70, '2026-08-10'::date, 'CVMitra', 'OT32-Nara Long Outer Hi Prima', 'OT32-Khaki', 27, 155000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 71, '2026-08-10'::date, 'CVMitra', 'OT32-Nara Long Outer Hi Prima', 'OT32-Oat', 80, 155000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 72, '2026-08-10'::date, 'CVMitra', 'OT32-Nara Long Outer Hi Prima', 'OT32-Sand', 70, 155000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 73, '2026-08-10'::date, 'CVMitra', 'OT32-Nara Long Outer Hi Prima', 'OT32-White', 14, 155000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 74, '2026-08-10'::date, 'CVMitra', 'OT32-Nara Long Outer Hi Prima', 'OT32Brown', 89, 155000.0, 'Barang Ready', 'READY_AT_VENDOR'),
    ('HIPRIMA-PO-20261030', 75, '2026-10-10'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49-ASH', 10, 138000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 76, '2026-10-10'::date, 'CVMitra', 'R19-SHENNA SKIRT', 'R19-SAND', 100, 158000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 77, '2026-10-10'::date, 'CVMitra', 'R19-SHENNA SKIRT', 'R19-Darkgrey', 150, 158000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 78, '2026-10-10'::date, 'CVMitra', 'R19-SHENNA SKIRT', 'R19-BLACK', 150, 158000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 79, '2026-10-10'::date, 'CVMitra', 'BZ11-Troy Blazer', 'BZ11-Black/Furing', 20, 190000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 80, '2026-10-10'::date, 'CVMitra', 'BZ40-Shanon Assymetric Blazer', 'BZ40-Black', 50, 135000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 81, '2026-10-10'::date, 'CVMitra', 'BZ40-Shanon Assymetric Blazer', 'BZ40-Oat', 25, 135000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 82, '2026-10-10'::date, 'CVMitra', 'V65-Elena Vest Cotton Eve', 'V65BrownSM', 25, 115000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 83, '2026-10-10'::date, 'CVMitra', 'V65-Elena Vest Cotton Eve', 'V65OatSM', 10, 115000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 84, '2026-10-10'::date, 'CVMitra', 'V65-Elena Vest Cotton Eve', 'V65AshSM', 10, 115000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 85, '2026-10-10'::date, 'CVMitra', 'V65-Elena Vest Cotton Eve', 'V65DarkgreySM', 20, 115000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 86, '2026-10-10'::date, 'CVMitra', 'V65-Elena Vest Cotton Eve', 'V65AshLXL', 10, 115000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 87, '2026-10-10'::date, 'CVMitra', 'V65-Elena Vest Cotton Eve', 'V65DarkgreyLXL', 20, 115000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 88, '2026-10-10'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49BrownSM', 15, 133000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 89, '2026-10-10'::date, 'CVMitra', 'C49-Basic Highwaisted Culottes (JILL)', 'C49BrownLXL', 15, 138000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 90, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114MarblegreyLXL', 105, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 91, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114MarblegreySM', 105, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 92, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114ConcreteSM', 20, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 93, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114ConcreteLXL', 20, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 94, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114BarkSM', 15, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 95, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114BarkLXL', 15, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 96, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114CinnamonSM', 15, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 97, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114CinnamonLXL', 15, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 98, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114CaramelSM', 15, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 99, '2026-10-12'::date, 'Ada Jahit', 'C114 Barrel Suede Trousers', 'C114CaramelLXL', 15, 140000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 100, '2026-10-12'::date, 'Ada Jahit', 'T284 Barrel Sleeved Jacket (Cropped)', 'T284Caramel', 75, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 101, '2026-10-12'::date, 'Ada Jahit', 'T286 Barrel Sleeved Jacket', 'T286Caramel', 75, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 102, '2026-10-12'::date, 'Ada Jahit', 'T284 Barrel Sleeved Jacket (Cropped)', 'T284Cinnamon', 12, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 103, '2026-10-12'::date, 'Ada Jahit', 'T286 Barrel Sleeved Jacket', 'T286Cinnamon', 12, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 104, '2026-10-12'::date, 'Ada Jahit', 'T284 Barrel Sleeved Jacket (Cropped)', 'T284Bark', 12, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 105, '2026-10-12'::date, 'Ada Jahit', 'T286 Barrel Sleeved Jacket', 'T286Bark', 12, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 106, '2026-10-12'::date, 'Ada Jahit', 'T284 Barrel Sleeved Jacket (Cropped)', 'T284Concrete', 12, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 107, '2026-10-12'::date, 'Ada Jahit', 'T286 Barrel Sleeved Jacket', 'T286Concrete', 12, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 108, '2026-10-12'::date, 'Ada Jahit', 'T284 Barrel Sleeved Jacket (Cropped)', 'T284Marblegrey', 10, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 109, '2026-10-12'::date, 'Ada Jahit', 'T286 Barrel Sleeved Jacket', 'T286Marblegrey', 10, 160000.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 110, '2026-10-12'::date, 'Ada Jahit', 'C105 Slit Suede Culottes', 'C105Caramel', 75, 164700.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 111, '2026-10-12'::date, 'Ada Jahit', 'C105 Slit Suede Culottes', 'C105Cinnamon', 22, 164700.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 112, '2026-10-12'::date, 'Ada Jahit', 'C105 Slit Suede Culottes', 'C105Bark', 22, 164700.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 113, '2026-10-12'::date, 'Ada Jahit', 'C105 Slit Suede Culottes', 'C105Concrete', 22, 164700.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 114, '2026-10-12'::date, 'Ada Jahit', 'C105 Slit Suede Culottes', 'C105Marblegrey', 20, 164700.0, 'Est Kiriman minggu ke 3 november', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 115, '2026-10-27'::date, 'Indri Sutisna', 'T142-Venisha Rib Turtleneck Tops', 'T142-Black', 80, 85000.0, 'Est Kiriman 10 hari lagi', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 116, '2026-10-27'::date, 'Indri Sutisna', 'T142-Venisha Rib Turtleneck Tops', 'T142-White', 50, 85000.0, 'Est Kiriman 10 hari lagi', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 117, '2026-10-27'::date, 'Indri Sutisna', 'T142-Venisha Rib Turtleneck Tops', 'T142-Maroon', 50, 85000.0, 'Est Kiriman 10 hari lagi', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 118, '2026-10-27'::date, 'Indri Sutisna', 'T142-Venisha Rib Turtleneck Tops', 'T142-Deepbrown', 40, 85000.0, 'Est Kiriman 10 hari lagi', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 119, '2026-10-27'::date, 'Indri Sutisna', 'T142-Venisha Rib Turtleneck Tops', 'T142-Coffee', 40, 85000.0, 'Est Kiriman 10 hari lagi', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 120, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298BlackS', 30, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 121, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298BlackM', 30, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 122, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298BlackL', 30, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 123, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298BlackXL', 30, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 124, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298BarkS', 15, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 125, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298BarkM', 15, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 126, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298BarkL', 15, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 127, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298BarkXL', 15, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 128, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298MaroonS', 30, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 129, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298MaroonM', 30, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 130, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298MaroonL', 30, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 131, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298MaroonXL', 30, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 132, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298EspressoS', 15, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 133, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298EspressoM', 15, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 134, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298EspressoL', 15, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 135, '2026-10-21'::date, 'Fem Garment', 'T298 Comfy Silk Shirt', 'T298EspressoXL', 15, 91500.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 136, '2026-10-21'::date, 'Fem Garment', 'C118 Silk Culottes', 'C118BlackSM', 10, 99000.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 137, '2026-10-21'::date, 'Fem Garment', 'C118 Silk Culottes', 'C118BlackLXL', 10, 99000.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 138, '2026-10-21'::date, 'Fem Garment', 'C118 Silk Culottes', 'C118BarkSM', 5, 99000.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 139, '2026-10-21'::date, 'Fem Garment', 'C118 Silk Culottes', 'C118BarkLXL', 5, 99000.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 140, '2026-10-21'::date, 'Fem Garment', 'C118 Silk Culottes', 'C118MaroonSM', 10, 99000.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 141, '2026-10-21'::date, 'Fem Garment', 'C118 Silk Culottes', 'C118MaroonLXL', 10, 99000.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 142, '2026-10-21'::date, 'Fem Garment', 'C118 Silk Culottes', 'C118EspressoSM', 5, 99000.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED'),
    ('HIPRIMA-PO-20261030', 143, '2026-10-21'::date, 'Fem Garment', 'C118 Silk Culottes', 'C118EspressoLXL', 5, 99000.0, 'Est Kiriman Minggu ke 2 November', 'UNCONFIRMED')
ON CONFLICT (source_key,source_row) DO NOTHING;

COMMIT;

SELECT count(*) AS staged_rows,coalesce(sum(ordered_qty),0) AS po_units,
 coalesce(sum(ordered_qty) FILTER(WHERE progress='READY_AT_VENDOR'),0) AS ready_at_vendor
FROM public.wms_po_excel_initial WHERE source_key='HIPRIMA-PO-20261030';
