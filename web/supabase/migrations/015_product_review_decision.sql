-- ============================================================
-- HI.PRIMA WMS
-- MIGRATION 015 — PRODUCT REVIEW & DECISION FOUNDATION
-- SAFE / IDEMPOTENT
-- TIDAK MENGHAPUS DATA
-- ============================================================

BEGIN;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS first_stock_in_date date,
    ADD COLUMN IF NOT EXISTS first_sale_date date,
    ADD COLUMN IF NOT EXISTS last_stock_in_date date,
    ADD COLUMN IF NOT EXISTS last_sale_date date,
    ADD COLUMN IF NOT EXISTS last_review_date date,
    ADD COLUMN IF NOT EXISTS next_review_date date,
    ADD COLUMN IF NOT EXISTS review_status text,
    ADD COLUMN IF NOT EXISTS review_notes text,
    ADD COLUMN IF NOT EXISTS reviewed_by uuid,
    ADD COLUMN IF NOT EXISTS decision_signal text,
    ADD COLUMN IF NOT EXISTS owner_decision text,
    ADD COLUMN IF NOT EXISTS owner_decision_at timestamptz,
    ADD COLUMN IF NOT EXISTS owner_decision_by uuid,
    ADD COLUMN IF NOT EXISTS owner_decision_note text;

ALTER TABLE public.product_variants
    ADD COLUMN IF NOT EXISTS lifecycle_status text,
    ADD COLUMN IF NOT EXISTS development_date date,
    ADD COLUMN IF NOT EXISTS launch_date date,
    ADD COLUMN IF NOT EXISTS planned_discontinue_date date,
    ADD COLUMN IF NOT EXISTS discontinue_date date,
    ADD COLUMN IF NOT EXISTS discontinue_reason text,
    ADD COLUMN IF NOT EXISTS first_stock_in_date date,
    ADD COLUMN IF NOT EXISTS first_sale_date date,
    ADD COLUMN IF NOT EXISTS last_stock_in_date date,
    ADD COLUMN IF NOT EXISTS last_sale_date date,
    ADD COLUMN IF NOT EXISTS last_review_date date,
    ADD COLUMN IF NOT EXISTS next_review_date date,
    ADD COLUMN IF NOT EXISTS review_status text,
    ADD COLUMN IF NOT EXISTS review_notes text,
    ADD COLUMN IF NOT EXISTS reviewed_by uuid,
    ADD COLUMN IF NOT EXISTS decision_signal text,
    ADD COLUMN IF NOT EXISTS owner_decision text,
    ADD COLUMN IF NOT EXISTS owner_decision_at timestamptz,
    ADD COLUMN IF NOT EXISTS owner_decision_by uuid,
    ADD COLUMN IF NOT EXISTS owner_decision_note text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'products_decision_signal_check'
    ) THEN
        ALTER TABLE public.products
        ADD CONSTRAINT products_decision_signal_check
        CHECK (
            decision_signal IS NULL OR
            decision_signal IN (
                'continue',
                'review',
                'clearance',
                'discontinue'
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'products_owner_decision_check'
    ) THEN
        ALTER TABLE public.products
        ADD CONSTRAINT products_owner_decision_check
        CHECK (
            owner_decision IS NULL OR
            owner_decision IN (
                'continue',
                'improve',
                'clearance',
                'discontinue'
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'product_variants_lifecycle_status_check'
    ) THEN
        ALTER TABLE public.product_variants
        ADD CONSTRAINT product_variants_lifecycle_status_check
        CHECK (
            lifecycle_status IS NULL OR
            lifecycle_status IN (
                'draft',
                'development',
                'active',
                'slow_moving',
                'clearance',
                'discontinued',
                'archived'
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'product_variants_decision_signal_check'
    ) THEN
        ALTER TABLE public.product_variants
        ADD CONSTRAINT product_variants_decision_signal_check
        CHECK (
            decision_signal IS NULL OR
            decision_signal IN (
                'continue',
                'review',
                'clearance',
                'discontinue'
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'product_variants_owner_decision_check'
    ) THEN
        ALTER TABLE public.product_variants
        ADD CONSTRAINT product_variants_owner_decision_check
        CHECK (
            owner_decision IS NULL OR
            owner_decision IN (
                'continue',
                'improve',
                'clearance',
                'discontinue'
            )
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_launch_date
    ON public.products (launch_date);

CREATE INDEX IF NOT EXISTS idx_products_lifecycle_status
    ON public.products (lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_products_next_review_date
    ON public.products (next_review_date);

CREATE INDEX IF NOT EXISTS idx_products_owner_decision
    ON public.products (owner_decision);

CREATE INDEX IF NOT EXISTS idx_product_variants_lifecycle_status
    ON public.product_variants (lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_product_variants_next_review_date
    ON public.product_variants (next_review_date);

CREATE INDEX IF NOT EXISTS idx_product_variants_owner_decision
    ON public.product_variants (owner_decision);

COMMIT;
