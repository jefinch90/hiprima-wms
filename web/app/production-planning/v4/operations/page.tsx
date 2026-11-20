"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

type WorkflowStatus = {
  enabled: boolean;
  ready: boolean;
  hpp_active_account_guard: boolean;
  secured_stock_rpc_count: number;
};
type Batch = { id: string; status: string; created_at: string };
type Vendor = { id: string; vendor_name: string; is_active: boolean };
type VariantDetail = { product_id: string; color: string | null; is_active: boolean };
type MoqConfirmation = {
  id: string;
  batch_id: string;
  vendor_id: string;
  parameter_id: string;
  scope_key: string;
  requested_qty: number;
  confirmed_minimum_qty: number | null;
  valid_until: string | null;
  confirmed_at: string;
};
type Quote = {
  id: string;
  vendor_id: string;
  variant_id: string;
  unit_price: number;
  currency: string;
  source_type: string;
  evidence_ref: string;
  created_by: string;
  created_at: string;
  bulk_batch_id?: string | null;
  scope_batch_id?: string | null;
  change_reason?: string | null;
  previous_unit_price?: number | null;
  vendor_name?: string;
  sku?: string;
};
type PreviewLine = {
  batch_id: string;
  line_id: string;
  variant_id: string;
  sku: string;
  product_code: string;
  decision: string;
  proposed_qty: number;
  hpp_master: number | null;
  cost_price: number | null;
  hpp_history: number | null;
  hpp_history_at: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  parameter_id: string | null;
  lead_time_days: number | null;
  lifecycle_status: string | null;
  moq_type: string | null;
  moq_quantity: number | null;
  review_status: string | null;
  quote_id: string | null;
  vendor_unit_price: number | null;
  currency: string | null;
  quote_valid_until: string | null;
  selected: boolean;
  moq_confirmation_id: string | null;
};
type AutoVendor = {
  line_id: string;
  vendor_id: string;
  parameter_id: string;
  quote_id: string | null;
};
function automaticChoice(rows: PreviewLine[], autoVendors: AutoVendor[]) {
  return rows.find((row) => autoVendors.some((item) =>
    item.line_id === row.line_id && item.vendor_id === row.vendor_id &&
    item.parameter_id === row.parameter_id && item.quote_id === row.quote_id &&
    Number(row.vendor_unit_price) > 0 && row.currency === "IDR"
  ));
}
function eligibleVendor(line: PreviewLine) {
  return !!line.vendor_id && !!line.parameter_id && Number(line.vendor_unit_price) > 0 &&
    line.review_status === "VERIFIED" && line.currency === "IDR" &&
    ["On Produksi", "Seasonal"].includes(String(line.lifecycle_status)) &&
    Number(line.lead_time_days) >= 1 && Number(line.lead_time_days) <= 365 &&
    (line.moq_type === "BY_REQUEST" ||
      (["PER_PRODUCT", "PER_COLOR"].includes(String(line.moq_type)) && Number(line.moq_quantity) > 0));
}
type Approval = {
  id: string;
  batch_id: string;
  status: string;
  submitted_by: string;
  submitted_role: string;
  submitted_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
};
type ApprovalLine = {
  id: string;
  sku_snapshot: string;
  product_code_snapshot: string;
  product_name_snapshot: string;
  proposed_qty: number;
  vendor_id: string;
  master_hpp_snapshot: number;
  vendor_unit_price_snapshot: number;
  currency_snapshot: string;
  lead_time_days_snapshot: number;
  lifecycle_status_snapshot: string;
  moq_type_snapshot: string;
};
type GeneratedPO = {
  approval_id: string;
  po_id: string;
  po_number: string;
  status: string;
};

const money = (value: number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(value));
function formatError(cause: unknown, context?: string) {
  const error =
    cause !== null && typeof cause === "object"
      ? (cause as Record<string, unknown>)
      : null;
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : typeof error?.message === "string"
          ? error.message
          : "Terjadi kesalahan tanpa pesan.";
  const code =
    typeof error?.code === "string" || typeof error?.code === "number"
      ? String(error.code)
      : "";
  const details = typeof error?.details === "string" ? error.details : "";
  const hint = typeof error?.hint === "string" ? error.hint : "";
  const nextStep =
    code === "PGRST202"
      ? "Pastikan RPC tersedia setelah migration terkait diterapkan; jika sudah, periksa schema cache PostgREST."
      : code === "PGRST205" || code === "42P01"
        ? "Pastikan tabel yang disebut tersedia dan migration yang membuatnya sudah diterapkan."
        : code === "42501"
          ? "Periksa privilege dan policy RLS untuk role akun ini."
          : "";

  return [
    context,
    message,
    code ? `Kode: ${code}` : "",
    details ? `Rincian: ${details}` : "",
    hint ? `Petunjuk backend: ${hint}` : "",
    nextStep ? `Tindakan: ${nextStep}` : "",
  ]
    .filter(Boolean)
    .join(" — ");
}

function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.enabled === "boolean" &&
    typeof status.ready === "boolean" &&
    typeof status.hpp_active_account_guard === "boolean" &&
    typeof status.secured_stock_rpc_count === "number"
  );
}

export default function ProductionOperationsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [role, setRole] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [identityError, setIdentityError] = useState("");
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<WorkflowStatus | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [generatedOrders, setGeneratedOrders] = useState<GeneratedPO[]>([]);
  const [selectedBatch, setSelectedBatch] = useState("");
  const [preview, setPreview] = useState<PreviewLine[]>([]);
  const [autoVendors, setAutoVendors] = useState<AutoVendor[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [variantDetails, setVariantDetails] = useState<Record<string, VariantDetail>>({});
  const [moqConfirmations, setMoqConfirmations] = useState<Record<string, MoqConfirmation>>({});
  const [selectedApproval, setSelectedApproval] = useState("");
  const [approvalLines, setApprovalLines] = useState<ApprovalLine[]>([]);
  const [quoteVendor, setQuoteVendor] = useState("");
  const [quoteVariant, setQuoteVariant] = useState("");
  const [quotePrice, setQuotePrice] = useState("");
  const [quoteScope, setQuoteScope] = useState("STANDARD");
  const [quoteReason, setQuoteReason] = useState("");
  const [quoteSource, setQuoteSource] = useState("DOCUMENT");
  const [quoteEvidence, setQuoteEvidence] = useState("");
  const [quoteExpiry, setQuoteExpiry] = useState("");
  const [moqMinimum, setMoqMinimum] = useState<Record<string, string>>({});
  const [moqEvidence, setMoqEvidence] = useState<Record<string, string>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [enableSignoff, setEnableSignoff] = useState(false);

  const refresh = useCallback(async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) {
      throw new Error(formatError(authError, "Gagal memeriksa sesi akun (auth.getUser)"));
    }
    if (!authData.user) {
      router.replace("/login");
      return;
    }
    setCurrentUserId(authData.user.id);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role,is_active")
      .eq("id", authData.user.id)
      .single();
    if (profileError) {
      throw new Error(formatError(profileError, "Gagal memuat profil akun (profiles)"));
    }
    if (
      !profile?.is_active ||
      !["owner", "admin", "warehouse_manager"].includes(String(profile.role))
    ) {
      throw new Error("Akun aktif tidak memiliki akses Production Planning.");
    }
    setRole(String(profile.role));

    const [
      statusResult,
      vendorResult,
      batchResult,
      approvalResult,
      conversionResult,
      conversionOrderResult,
    ] =
      await Promise.all([
        supabase.rpc("wms_v43c_workflow_status"),
        supabase
          .from("wms_vendor_master")
          .select("id,vendor_name,is_active")
          .eq("is_active", true)
          .order("vendor_name"),
        supabase
          .from("wms_production_review_batches")
          .select("id,status,created_at")
          .eq("status", "DRAFT")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("wms_production_operational_approvals")
          .select(
            "id,batch_id,status,submitted_by,submitted_role,submitted_at,decided_by,decided_at,decision_notes"
          )
          .order("submitted_at", { ascending: false })
          .limit(100),
        supabase
          .from("wms_production_po_conversions")
          .select("id,operational_approval_id,status"),
        supabase
          .from("wms_production_po_conversion_orders")
          .select("conversion_id,po_id"),
      ]);
    const initialQueryErrors = [
      { label: "Status workflow (RPC wms_v43c_workflow_status)", error: statusResult.error },
      { label: "Daftar vendor aktif (wms_vendor_master)", error: vendorResult.error },
      { label: "Draft produksi (wms_production_review_batches)", error: batchResult.error },
      {
        label: "Persetujuan operasional (wms_production_operational_approvals)",
        error: approvalResult.error,
      },
      { label: "Konversi PO (wms_production_po_conversions)", error: conversionResult.error },
      {
        label: "Relasi PO hasil konversi (wms_production_po_conversion_orders)",
        error: conversionOrderResult.error,
      },
    ];
    for (const { label, error: queryError } of initialQueryErrors) {
      if (queryError) throw new Error(formatError(queryError, label));
    }

    if (!isWorkflowStatus(statusResult.data)) {
      throw new Error(
        "Respons RPC status workflow tidak sesuai. Periksa versi RPC wms_v43c_workflow_status."
      );
    }
    setStatus(statusResult.data);
    setVendors((vendorResult.data ?? []) as Vendor[]);
    const approvalRows = (approvalResult.data ?? []) as Approval[];
    setApprovals(approvalRows);
    const submittedBatchIds = new Set(approvalRows.map((approval) => approval.batch_id));
    setBatches(
      ((batchResult.data ?? []) as Batch[]).filter(
        (batch) => !submittedBatchIds.has(batch.id)
      )
    );

    const conversionById = new Map(
      (conversionResult.data ?? []).map((conversion) => [
        conversion.id,
        conversion.operational_approval_id,
      ])
    );
    const conversionLinks = conversionOrderResult.data ?? [];
    if (conversionLinks.length) {
      const { data: poRows, error: poError } = await supabase
        .from("wms_po_orders")
        .select("id,po_number,status")
        .in("id", conversionLinks.map((link) => link.po_id));
      if (poError) {
        throw new Error(formatError(poError, "Gagal memuat PO hasil konversi (wms_po_orders)"));
      }
      const poById = new Map((poRows ?? []).map((po) => [po.id, po]));
      const generated: GeneratedPO[] = conversionLinks.map((link) => {
        const po = poById.get(link.po_id);
        const approvalId = conversionById.get(link.conversion_id);
        if (!po || !approvalId) {
          throw new Error("Generated PO conversion data is inconsistent.");
        }
        return {
          approval_id: approvalId,
          po_id: link.po_id,
          po_number: po.po_number,
          status: po.status,
        };
      });
      setGeneratedOrders(generated);
    } else {
      setGeneratedOrders([]);
    }

    const actorIds = [
      ...new Set(
        [
          ...approvalRows.flatMap((approval) => [
            approval.submitted_by,
            approval.decided_by,
          ]),
        ].filter((id): id is string => !!id)
      ),
    ];
    setIdentityError("");
    if (actorIds.length > 0) {
      const { data: actors, error: actorsError } = await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", actorIds);
      if (actorsError) {
        setActorNames({});
        setIdentityError(formatError(actorsError, "Gagal memuat nama pengguna (profiles)"));
      } else {
        setActorNames(
          Object.fromEntries(
            (actors ?? []).map((actor) => [
              actor.id,
              actor.full_name?.trim() || "Nama tidak tersedia",
            ])
          )
        );
      }
    } else {
      setActorNames({});
    }
  }, [router, supabase]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void refresh()
        .catch((cause: unknown) => {
          if (active) setError(formatError(cause));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const updateTime = () => setCurrentTimeMs(Date.now());
    updateTime();
    const timer = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const run = async (
    label: string,
    action: () => Promise<unknown>,
    afterRefresh?: () => Promise<void>
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      if (afterRefresh) await afterRefresh();
      setNotice(label);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async (batchId: string) => {
    setPreviewBusy(true);
    try {
    setAutoVendors([]);
    setError("");
    setNotice("");
    setSelectedBatch(batchId);
    setPreview([]);
    setQuotes([]);
    setVariantDetails({});
    setMoqConfirmations({});
    setQuoteVariant("");
    setQuoteVendor("");
    setQuotePrice("");
    setQuoteReason("");
    setQuoteEvidence("");
    setQuoteExpiry("");
    if (approvals.some((approval) => approval.batch_id === batchId)) {
      setError("Draft ini sudah memiliki keputusan operasional. Buat Draft Review baru untuk rework.");
      return;
    }
    const autoResult = await supabase.rpc("wms_v43e_auto_select_vendors", {
      p_batch_id: batchId,
      p_apply: status?.enabled === true,
    });
    if (autoResult.error) {
      setError(formatError(autoResult.error, "Gagal menentukan vendor otomatis"));
      return;
    }
    if (!Array.isArray(autoResult.data)) {
      setError("Respons vendor otomatis tidak valid.");
      return;
    }
    setAutoVendors(autoResult.data as AutoVendor[]);
    const { data, error: rpcError } = await supabase.rpc(
      "wms_v43c_preview_operational_batch",
      { p_batch_id: batchId }
    );
    if (rpcError) {
      setError(
        formatError(rpcError, "Gagal memuat pratinjau Draft (RPC wms_v43c_preview_operational_batch)")
      );
      return;
    }
    const lines = (data ?? []) as PreviewLine[];
    setPreview(lines);
    const variantIds = [...new Set(lines.map((line) => line.variant_id))];
    const confirmationIds = [
      ...new Set(
        lines
          .map((line) => line.moq_confirmation_id)
          .filter((id): id is string => !!id)
      ),
    ];
    const [variantResult, confirmationResult, quoteResult] = await Promise.all([
      variantIds.length
        ? supabase
            .from("product_variants")
            .select("id,product_id,color,is_active")
            .in("id", variantIds)
        : Promise.resolve({ data: [], error: null }),
      confirmationIds.length
        ? supabase
            .from("wms_vendor_moq_confirmations")
            .select(
              "id,batch_id,vendor_id,parameter_id,scope_key,requested_qty,confirmed_minimum_qty,valid_until,confirmed_at"
            )
            .in("id", confirmationIds)
        : Promise.resolve({ data: [], error: null }),
      variantIds.length
        ? supabase
            .from("wms_vendor_variant_quotes")
            .select(
              "id,vendor_id,variant_id,unit_price,currency,source_type,evidence_ref,created_by,created_at,bulk_batch_id,scope_batch_id,change_reason,previous_unit_price"
            )
            .in("variant_id", variantIds)
            .eq("status", "PENDING")
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (variantResult.error || confirmationResult.error || quoteResult.error) {
      setError(
        variantResult.error
          ? formatError(variantResult.error, "Gagal memuat detail SKU Draft")
          : confirmationResult.error
            ? formatError(confirmationResult.error, "Gagal memuat konfirmasi MOQ Draft")
            : formatError(quoteResult.error, "Gagal memuat quote tertunda untuk Draft")
      );
      return;
    }
    setVariantDetails(
      Object.fromEntries(
        (variantResult.data ?? []).map((variant) => [
          variant.id,
          {
            product_id: variant.product_id,
            color: variant.color,
            is_active: variant.is_active,
          },
        ])
      )
    );
    setMoqConfirmations(
      Object.fromEntries(
        ((confirmationResult.data ?? []) as MoqConfirmation[]).map((confirmation) => [
          confirmation.id,
          confirmation,
        ])
      )
    );
    const vendorNames = new Map(
      vendors.map((vendor) => [vendor.id, vendor.vendor_name])
    );
    const skuByVariant = new Map(lines.map((line) => [line.variant_id, line.sku]));
    const pendingQuotes = (quoteResult.data ?? []) as Quote[];
    setQuotes(
      pendingQuotes.map((quote) => ({
        ...quote,
        vendor_name: vendorNames.get(quote.vendor_id),
        sku: skuByVariant.get(quote.variant_id),
      }))
    );
    const quoteCreatorIds = [...new Set(pendingQuotes.map((quote) => quote.created_by))];
    if (quoteCreatorIds.length) {
      const { data: quoteActors, error: quoteActorsError } = await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", quoteCreatorIds);
      if (quoteActorsError) {
        setIdentityError(formatError(quoteActorsError, "Gagal memuat nama pembuat quote"));
      } else {
        setActorNames((current) => ({
          ...current,
          ...Object.fromEntries(
            (quoteActors ?? []).map((actor) => [
              actor.id,
              actor.full_name?.trim() || "Nama tidak tersedia",
            ])
          ),
        }));
      }
    }
    } catch (cause) {
      setError(formatError(cause, "Gagal memuat Draft"));
    } finally {
      setPreviewBusy(false);
    }
  };

  const loadApprovalLines = async (approvalId: string) => {
    setSelectedApproval(approvalId);
    setApprovalLines([]);
    const { data, error: queryError } = await supabase
      .from("wms_production_operational_approval_lines")
      .select(
        "id,sku_snapshot,product_code_snapshot,product_name_snapshot,proposed_qty,vendor_id,master_hpp_snapshot,vendor_unit_price_snapshot,currency_snapshot,lead_time_days_snapshot,lifecycle_status_snapshot,moq_type_snapshot"
      )
      .eq("approval_id", approvalId)
      .order("sku_snapshot");
    if (queryError) {
      setError(
        formatError(queryError, "Gagal memuat baris persetujuan operasional")
      );
      return;
    }
    setApprovalLines((data ?? []) as ApprovalLine[]);
  };

  const lineGroups = useMemo(() => {
    const groups = new Map<string, PreviewLine[]>();
    for (const line of preview) {
      if (line.decision !== "PROPOSE" || Number(line.proposed_qty) <= 0) continue;
      groups.set(line.line_id, [...(groups.get(line.line_id) ?? []), line]);
    }
    return [...groups.values()];
  }, [preview]);

  const readiness = useMemo(() => {
    const selected = lineGroups.map((rows) => ({
      rows,
      line: rows[0],
      choice: rows.find((row) => row.selected) ??
        (!status?.enabled ? automaticChoice(rows, autoVendors) : undefined),
    }));
    const totals = new Map<string, number>();
    for (const item of selected) {
      const choice = item.choice;
      if (!choice?.vendor_id || !choice.parameter_id || !choice.moq_type) continue;
      const variant = variantDetails[choice.variant_id];
      const scope =
        choice.moq_type === "PER_PRODUCT"
          ? variant?.product_id
          : choice.moq_type === "PER_COLOR"
            ? `${variant?.product_id}:${variant?.color ?? "<NULL>"}`
            : choice.variant_id;
      if (scope) {
        const key = `${choice.vendor_id}|${choice.parameter_id}|${choice.moq_type}|${scope}`;
        totals.set(key, (totals.get(key) ?? 0) + Number(item.line.proposed_qty));
      }
    }

    const statusByLine: Record<string, string> = {};
    for (const item of selected) {
      const { line, choice } = item;
      let message = "Pilih vendor dan harga terverifikasi";
      if (
        line.hpp_master == null ||
        line.hpp_master <= 0 ||
        line.hpp_master !== line.cost_price ||
        line.hpp_master !== line.hpp_history
      ) {
        message = "Perlu pemeriksaan HPP";
      } else if (!variantDetails[line.variant_id]?.is_active) {
        message = "SKU tidak aktif atau belum dapat diperiksa";
      } else if (!choice) {
        const mappedRows = item.rows.filter(
          (row) => row.vendor_id && row.parameter_id
        );
        const verifiedMappings = mappedRows.filter((row) => row.review_status === "VERIFIED");
        const priced = verifiedMappings.filter((row) => Number(row.vendor_unit_price) > 0 && row.currency === "IDR");
        const pending = mappedRows.some((row) => quotes.some((quote) => quote.variant_id === row.variant_id && quote.vendor_id === row.vendor_id && (!quote.scope_batch_id || quote.scope_batch_id === selectedBatch)));
        message = mappedRows.length === 0 ? "Belum ada mapping vendor untuk SKU ini"
          : !verifiedMappings.length ? "Mapping vendor belum diverifikasi"
          : priced.length ? "Pilih vendor — harga tersedia otomatis"
          : pending ? "Menunggu verifikasi perubahan harga"
          : "Mapping, lifecycle atau harga perlu diperiksa";
      } else if (
        !choice.vendor_id ||
        !choice.parameter_id ||
        choice.review_status !== "VERIFIED" ||
        !["On Produksi", "Seasonal"].includes(String(choice.lifecycle_status)) ||
        choice.currency !== "IDR" ||
        !(Number(choice.vendor_unit_price) > 0) ||
        !(Number(choice.lead_time_days) > 0) ||
        (choice.quote_valid_until != null &&
          (currentTimeMs == null ||
            !Number.isFinite(new Date(choice.quote_valid_until).getTime()) ||
            new Date(choice.quote_valid_until).getTime() <= currentTimeMs))
      ) {
        message = "Data vendor atau harga perlu diperiksa";
      } else if (choice.moq_type === "PER_PRODUCT" || choice.moq_type === "PER_COLOR") {
        const variant = variantDetails[choice.variant_id];
        const scope =
          choice.moq_type === "PER_PRODUCT"
            ? variant?.product_id
            : `${variant?.product_id}:${variant?.color ?? "<NULL>"}`;
        const key = `${choice.vendor_id}|${choice.parameter_id}|${choice.moq_type}|${scope}`;
        const ordered = totals.get(key) ?? 0;
        if (!(Number(choice.moq_quantity) > 0) || ordered < Number(choice.moq_quantity)) {
          message = "Jumlah belum memenuhi MOQ";
        } else {
          message = "Siap diajukan";
        }
      } else if (choice.moq_type === "BY_REQUEST") {
        const confirmation = choice.moq_confirmation_id
          ? moqConfirmations[choice.moq_confirmation_id]
          : undefined;
        const ordered = totals.get(
          `${choice.vendor_id}|${choice.parameter_id}|BY_REQUEST|${choice.variant_id}`
        ) ?? 0;
        if (
          !confirmation ||
          confirmation.batch_id !== selectedBatch ||
          confirmation.vendor_id !== choice.vendor_id ||
          confirmation.parameter_id !== choice.parameter_id ||
          confirmation.scope_key !== choice.variant_id ||
          confirmation.requested_qty !== ordered ||
          (confirmation.confirmed_minimum_qty != null &&
            confirmation.confirmed_minimum_qty > ordered) ||
          (confirmation.valid_until != null &&
            (currentTimeMs == null ||
              !Number.isFinite(new Date(confirmation.valid_until).getTime()) ||
              new Date(confirmation.valid_until).getTime() <= currentTimeMs))
        ) {
          message = "Menunggu konfirmasi MOQ Owner/Admin";
        } else {
          message = "Siap diajukan";
        }
      } else {
        message = "Jenis MOQ belum dapat dipastikan";
      }
      statusByLine[line.line_id] = message;
    }
    return {
      statusByLine,
      canSubmit:
        selected.length > 0 &&
        selected.every((item) => statusByLine[item.line.line_id] === "Siap diajukan"),
    };
  }, [currentTimeMs, lineGroups, moqConfirmations, quotes, selectedBatch, variantDetails, autoVendors, status?.enabled]);

  const button =
    "rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";
  const secondary =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
  const input =
    "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  const isOwner = role === "owner";
  const isApprover = role === "owner" || role === "admin";
  const draftVariants = [
    ...new Map(
      preview
        .filter((line) => line.decision === "PROPOSE" && line.proposed_qty > 0)
        .map((line) => [
          line.variant_id,
          { id: line.variant_id, sku: line.sku, hpp: line.hpp_master },
        ])
    ).values(),
  ];
  const draftQuoteVendors = preview.filter((line) =>
    line.variant_id === quoteVariant && line.vendor_id && line.parameter_id &&
    line.review_status === "VERIFIED" && ["On Produksi", "Seasonal"].includes(String(line.lifecycle_status))
  );
  const draftQuoteVendorOptions = draftQuoteVendors.filter((line) =>
    draftQuoteVendors.filter((other) => other.vendor_id === line.vendor_id).length === 1);
  const selectedPriceLine = draftQuoteVendorOptions.find((line) => line.vendor_id === quoteVendor);
  const selectedHasPendingQuote = quotes.some((quote) => quote.vendor_id === quoteVendor && quote.variant_id === quoteVariant);
  const priceBefore = selectedPriceLine?.vendor_unit_price ?? selectedPriceLine?.hpp_master ?? null;
  if (loading) {
    return <main className="p-6 text-sm text-slate-600">Memuat Production Planning…</main>;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-700">HI.PRIMA WMS · V4.3C</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Review &amp; Persetujuan
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Periksa kesiapan Draft, ajukan persetujuan operasional, lalu buat PO.
          </p>
        </div>
        <a
          className={secondary}
          href="/production-planning/orders/"
        >
          Purchase Order
        </a>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">Status perencanaan</h2>
            <p className="mt-1 text-sm text-slate-600">
              Approval operasional dan pembuatan PO otomatis tetap nonaktif sampai disetujui Owner.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold ${
              status?.enabled
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {status?.enabled ? "AKTIF" : "NONAKTIF"}
          </span>
        </div>
        {isApprover && (
          <details className="mt-4 rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              Pengaturan lanjutan
            </summary>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <p>Guard akun aktif HPP: {status?.hpp_active_account_guard ? "Siap" : "Belum siap"}</p>
              <p>RPC stok terjaga: {status?.secured_stock_rpc_count ?? 0}/6</p>
              <p>Pemeriksaan backend: {status?.ready ? "Lulus" : "Belum lulus"}</p>
            </div>
            {isOwner && !status?.enabled && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <label className="flex items-start gap-2 text-sm text-amber-950">
                  <input
                    type="checkbox"
                    checked={enableSignoff}
                    onChange={(event) => setEnableSignoff(event.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Saya mengonfirmasi backend telah diuji end-to-end melalui transaksi rollback pada database saat ini, Owner telah menyetujui aktivasi, dan prosedur Go Live sudah dipenuhi. Jangan centang sebelum seluruh bukti tersebut tersedia.
                  </span>
                </label>
                <button
                  className={`${button} mt-3`}
                  disabled={busy || !status?.ready || !enableSignoff}
                  onClick={() => {
                    if (!window.confirm("Aktifkan Approval Operasional dan Generate PO?")) return;
                    void run("Workflow operasional diaktifkan.", async () => {
                      const { error: rpcError } = await supabase.rpc(
                        "wms_v43c_set_operational_enabled",
                        { p_enabled: true }
                      );
                      if (rpcError) throw rpcError;
                      setEnableSignoff(false);
                    });
                  }}
                >
                  Aktifkan workflow setelah sign-off
                </button>
              </div>
            )}
          </details>
        )}
      </section>

      {isApprover && (
      <details className="rounded-xl border bg-white p-4">
        <summary className="cursor-pointer font-bold text-slate-900">
          Pengaturan lanjutan · Harga vendor
        </summary>
        <div className="mt-4 space-y-4">
          <div>
            <h2 className="text-lg font-bold">Harga vendor untuk Draft terpilih</h2>
            <p className="mt-1 text-sm text-slate-600">
              Harga standar otomatis dari HPP Master yang valid, atau harga vendor terakhir yang disetujui.
              Ajukan perubahan hanya jika harga berubah atau perlu diperbarui.
            </p>
          </div>

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-semibold">
              Ajukan perubahan harga vendor
            </summary>
            <p className="mt-2 text-sm text-slate-600">
              Pilih SKU dan vendor dari Draft terpilih. Harga sebelumnya tetap tersimpan; perubahan
              memerlukan bukti dan pemeriksa Owner/Admin lain.
            </p>
            <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <select
                className={input}
                value={quoteVariant}
                disabled={!selectedBatch}
                onChange={(event) => {
                  setQuoteVendor("");
                  setQuotePrice("");
                  setQuoteVariant(event.target.value);
                }}
                aria-label="SKU pada Draft terpilih"
              >
                <option value="">Pilih SKU pada Draft terpilih</option>
                {draftVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku} · HPP {money(variant.hpp)} IDR
                  </option>
                ))}
              </select>
              <select
                className={input}
                value={quoteVendor}
                disabled={!quoteVariant}
                onChange={(event) => {
                  setQuotePrice("");
                  setQuoteVendor(event.target.value);
                }}
                aria-label="Vendor pada Draft terpilih"
              >
                <option value="">Pilih vendor dengan mapping terverifikasi</option>
                {draftQuoteVendorOptions.map((vendor) => (
                  <option key={vendor.vendor_id ?? ""} value={vendor.vendor_id ?? ""}>{vendor.vendor_name}</option>
                ))}
              </select>
              <p className="text-sm text-slate-600 md:col-span-2 xl:col-span-3">
                {selectedPriceLine ? (selectedPriceLine.vendor_unit_price != null
                  ? `Harga aktif: ${money(priceBefore)} IDR · ${selectedPriceLine.quote_id ? "Harga vendor terverifikasi" : "HPP Master otomatis"}`
                  : "Harga efektif belum tersedia; periksa mapping, HPP atau harga kedaluwarsa.") : "Pilih SKU dan vendor pada Draft."}
                {selectedHasPendingQuote && " · Ada perubahan harga PENDING untuk pasangan ini."}
              </p>
              <select className={input} value={quoteScope} onChange={(event) => setQuoteScope(event.target.value)} aria-label="Jenis perubahan harga">
                <option value="STANDARD">Harga standar vendor (permanen)</option>
                <option value="THIS_PO">Khusus PO dari Draft ini</option>
              </select>
              <input className={input} value={quoteReason} maxLength={400} onChange={(event) => setQuoteReason(event.target.value)} placeholder="Alasan perubahan harga" aria-label="Alasan perubahan harga" />
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  className={input}
                  type="number"
                  min="1"
                  step="0.01"
                  value={quotePrice}
                  onChange={(event) => setQuotePrice(event.target.value)}
                  placeholder="Harga baru"
                  aria-label="Harga vendor baru"
                />
                <span className="self-center text-sm font-semibold text-slate-700">IDR</span>
              </div>
              <select
                className={input}
                value={quoteSource}
                onChange={(event) => setQuoteSource(event.target.value)}
                aria-label="Sumber bukti quote"
              >
                <option value="DOCUMENT">Dokumen</option>
                <option value="EMAIL">Email</option>
                <option value="PORTAL">Portal vendor</option>
                <option value="OTHER">Lainnya</option>
              </select>
              <input
                className={input}
                value={quoteEvidence}
                onChange={(event) => setQuoteEvidence(event.target.value)}
                placeholder="Referensi bukti (bukan URL publik)"
                aria-label="Referensi bukti quote"
              />
              <input
                className={input}
                type="date"
                value={quoteExpiry}
                onChange={(event) => setQuoteExpiry(event.target.value)}
                aria-label="Berlaku sampai (opsional)"
              />
              <button
                className={button}
                disabled={
                  busy || previewBusy || !selectedBatch || !selectedPriceLine?.parameter_id || selectedHasPendingQuote ||
                  !(Number(quotePrice) > 0) || !quoteReason.trim() || !quoteEvidence.trim()
                }
                onClick={() => {
                  const validUntil = quoteExpiry
                    ? new Date(`${quoteExpiry}T23:59:59`).toISOString()
                    : null;
                  void run("Perubahan harga disimpan sebagai PENDING.", async () => {
                    const { error: rpcError } = await supabase.rpc(
                      "wms_v43d_request_price_change",
                      {
                        p_batch_id: selectedBatch,
                        p_vendor_id: quoteVendor,
                        p_variant_id: quoteVariant,
                        p_parameter_id: selectedPriceLine?.parameter_id,
                        p_scope: quoteScope,
                        p_reason: quoteReason.trim(),
                        p_unit_price: Number(quotePrice),
                        p_source_type: quoteSource,
                        p_evidence_ref: quoteEvidence.trim(),
                        p_valid_until: validUntil,
                      }
                    );
                    if (rpcError) throw rpcError;
                    setQuoteReason("");
                    setQuotePrice("");
                    setQuoteEvidence("");
                    setQuoteExpiry("");
                  }, () => loadPreview(selectedBatch));
                }}
              >
                Ajukan Perubahan Harga
              </button>
              <p className="text-xs text-slate-600 md:col-span-2 xl:col-span-3">
                {priceBefore != null && Number(quotePrice) > 0 ? `Selisih terhadap harga yang ditampilkan: ${money(Number(quotePrice) - priceBefore)} IDR/pcs.` : ""}
                {" "}Harga standar vendor tidak langsung mengubah HPP Master; jika HPP juga berubah, gunakan menu HPP yang sudah ada setelah verifikasi.
              </p>
            </div>
          </details>        {quotes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2">SKU</th><th className="p-2">Vendor</th>
                  <th className="p-2">Harga</th><th className="p-2">Sumber</th>
                  <th className="p-2">Pembuat</th><th className="p-2">Keputusan</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id} className="border-b">
                    <td className="p-2">{quote.sku ?? "SKU tidak ditemukan"}</td>
                    <td className="p-2">{quote.vendor_name ?? "Vendor tidak ditemukan"}</td>
                    <td className="p-2">{money(quote.unit_price)} {quote.currency}</td>
                    <td className="p-2">{quote.source_type} · {quote.evidence_ref}<p className="text-xs text-slate-600">{quote.scope_batch_id ? "Khusus Draft / PO" : "Harga standar"} · {quote.change_reason ?? "Konfirmasi sebelumnya"}</p>{quote.previous_unit_price != null && <p className="text-xs">Sebelumnya: {money(quote.previous_unit_price)} IDR</p>}</td>
                    <td className="p-2">
                      {actorNames[quote.created_by] ?? "Nama tidak tersedia"}
                      <span className="block text-xs text-slate-500">
                        {new Date(quote.created_at).toLocaleDateString("id-ID")}
                      </span>
                    </td>
                    <td className="space-x-2 p-2">
                      {quote.bulk_batch_id ? (
                        <span className="text-xs text-amber-800">
                          Quote dari batch sebelumnya; tidak dapat diputuskan per-SKU.
                        </span>
                      ) : quote.created_by === currentUserId ? (
                        <span className="text-xs text-slate-600">Perlu pemeriksa lain</span>
                      ) : (
                        <>
                          <button
                            className={secondary}
                            disabled={busy || previewBusy}
                            onClick={() => {
                              if (!window.confirm("Verifikasi harga vendor dan bukti ini?")) return;
                              void run("Vendor quote diverifikasi.", async () => {
                                const { error: rpcError } = await supabase.rpc(
                                  "wms_v43c_review_vendor_quote",
                                  { p_quote_id: quote.id, p_decision: "VERIFIED", p_notes: null }
                                );
                                if (rpcError) throw rpcError;
                              }, selectedBatch ? () => loadPreview(selectedBatch) : undefined);
                            }}
                          >
                            Verifikasi
                          </button>
                          <button
                            className={secondary}
                            disabled={busy || previewBusy}
                            onClick={() => {
                              const reason = window.prompt("Alasan menolak quote:");
                              if (!reason?.trim()) return;
                              void run("Vendor quote ditolak.", async () => {
                                const { error: rpcError } = await supabase.rpc(
                                  "wms_v43c_review_vendor_quote",
                                  { p_quote_id: quote.id, p_decision: "REJECTED", p_notes: reason.trim() }
                                );
                                if (rpcError) throw rpcError;
                              }, selectedBatch ? () => loadPreview(selectedBatch) : undefined);
                            }}
                          >
                            Tolak
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {identityError && <p className="text-xs text-amber-800">{identityError}</p>}
        </div>
      </details>
      )}

      <section className="space-y-4 rounded-xl border bg-white p-4">
        <div>
          <h2 className="text-lg font-bold">Pilih Draft Produksi</h2>
          <p className="text-sm text-slate-600">
            Hasil simulasi bukan persetujuan operasional. Draft hanya dapat diajukan
            setelah SKU, harga vendor, MOQ, dan lead time siap.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className={`${input} max-w-xl`}
            value={selectedBatch}
            disabled={busy || previewBusy}
            onChange={(event) => {
              if (event.target.value) void loadPreview(event.target.value);
              else {
                setSelectedBatch("");
                setAutoVendors([]);
                setPreview([]);
                setQuotes([]);
                setVariantDetails({});
                setMoqConfirmations({});
                setQuoteVariant("");
                setQuoteVendor("");
                          }
            }}
            aria-label="Pilih Draft Produksi"
          >
            <option value="">Pilih Draft Produksi</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                Draft · {new Date(batch.created_at).toLocaleString("id-ID")}
              </option>
            ))}
          </select>
          {selectedBatch && lineGroups.length > 0 && (
            <button
              className={button}
              disabled={busy || previewBusy || !status?.enabled || !readiness.canSubmit}
              onClick={() => {
                if (!window.confirm("Kirim Draft untuk Approval Operasional? Draft akan terkunci.")) return;
                void run("Draft dikirim untuk Approval Operasional.", async () => {
                  const { error: rpcError } = await supabase.rpc(
                    "wms_v43c_submit_operational_batch",
                    { p_batch_id: selectedBatch }
                  );
                  if (rpcError) throw rpcError;
                  setPreview([]);
                  setSelectedBatch("");
                });
              }}
            >
              Ajukan persetujuan
            </button>
          )}
        </div>

        {lineGroups.length > 0 && (
          <div className="max-w-full overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Jumlah</th>
                  <th className="p-3">Vendor</th>
                  <th className="p-3">HPP Master</th>
                  <th className="p-3">MOQ</th>
                  <th className="p-3">Lead time</th>
                  <th className="p-3">Kesiapan</th>
                </tr>
              </thead>
              <tbody>
                {lineGroups.map((candidateRows) => {
                  const first = candidateRows[0];
                  const candidates = candidateRows.filter(eligibleVendor).sort((a, b) =>
                    Number(a.vendor_unit_price) - Number(b.vendor_unit_price) ||
                    Number(a.lead_time_days) - Number(b.lead_time_days) ||
                    String(a.vendor_name).localeCompare(String(b.vendor_name))
                  );
                  const saved = candidateRows.find((line) => line.selected);
                  const autoPreview = !status?.enabled ? automaticChoice(candidateRows, autoVendors) : undefined;
                  const chosen = saved ?? autoPreview;
                  const suggested = chosen ?? candidates[0];
                  const selectedValue = chosen
                    ? `${chosen.vendor_id}|${chosen.parameter_id}|${chosen.quote_id ?? "MASTER"}`
                    : "";
                  const singleVendor = !!chosen && candidates.length === 1;
                  return (
                    <tr key={first.line_id} className="border-t align-top">
                      <td className="p-3">
                        <p className="font-semibold">{first.sku}</p>
                        <p className="text-xs text-slate-500">{first.product_code}</p>
                      </td>
                      <td className="p-3">{first.proposed_qty} pcs</td>
                      <td className="p-3">
                        {singleVendor ? (
                          <div>
                            <p className="font-semibold text-slate-900">{chosen?.vendor_name}</p>
                            <p className="text-xs text-emerald-700">{autoPreview && !saved ? "Otomatis (pratinjau)" : "Vendor terpilih"} · {money(chosen?.vendor_unit_price)} IDR</p>
                          </div>
                        ) : (
                        <select
                          id={`vendor-${first.line_id}`}
                          className={input}
                          value={selectedValue}
                          disabled={busy || previewBusy || !status?.enabled}
                          aria-label={`Vendor untuk ${first.sku}`}
                          onChange={(event) => {
                            const [vendorId, parameterId, quoteId] = event.target.value.split("|");
                            if (!vendorId || !parameterId || !quoteId) return;
                            void run("Vendor terverifikasi dipilih.", async () => {
                              const { error: rpcError } = await supabase.rpc(
                                "wms_v43c_set_vendor_selection",
                                {
                                  p_line_id: first.line_id,
                                  p_vendor_id: vendorId,
                                  p_parameter_id: parameterId,
                                  p_quote_id: quoteId === "MASTER" ? null : quoteId,
                                }
                              );
                              if (rpcError) throw rpcError;
                              await loadPreview(selectedBatch);
                            });
                          }}
                        >
                          <option value="">Pilih vendor</option>
                          {candidates.map((candidate) => (
                            <option
                              key={`${candidate.vendor_id}-${candidate.parameter_id}-${candidate.quote_id}`}
                              value={`${candidate.vendor_id}|${candidate.parameter_id}|${candidate.quote_id ?? "MASTER"}`}
                            >
                              {candidate.vendor_name} · {money(candidate.vendor_unit_price)} IDR
                            </option>
                          ))}
                        </select>
                        )}
                        {!chosen && suggested && <p className="mt-1 text-xs text-slate-600">{candidates.length > 1 ? "Rekomendasi harga terendah (cek MOQ): " : "Kandidat: "}{suggested.vendor_name} · {money(suggested.vendor_unit_price)} IDR</p>}
                      </td>
                      <td className="p-3">{money(first.hpp_master)} IDR
                        {suggested && <p className="mt-1 text-xs text-slate-600">{suggested.quote_id ? "Harga vendor terverifikasi" : "Harga otomatis dari HPP Master"}</p>}
                      </td>
                      <td className="p-3">
                        {suggested
                          ? suggested.moq_type === "BY_REQUEST"
                            ? "By Request"
                            : `${suggested.moq_quantity ?? "Belum diatur"} pcs`
                          : "—"}
                      </td>
                      <td className="p-3">
                        {suggested?.lead_time_days != null
                          ? `${suggested.lead_time_days} hari`
                          : "—"}
                      </td>
                      <td className="p-3">
                        <p className={
                          readiness.statusByLine[first.line_id] === "Siap diajukan"
                            ? "font-semibold text-emerald-700"
                            : "font-semibold text-amber-800"
                        }>
                          {!status?.enabled && readiness.statusByLine[first.line_id] === "Siap diajukan"
                            ? "Siap (pratinjau)"
                            : readiness.statusByLine[first.line_id] ?? "Perlu pemeriksaan"}
                        </p>
                        {chosen?.quote_valid_until && (
                          <p className="mt-1 text-xs text-slate-500">
                            Harga berlaku s.d. {new Date(chosen.quote_valid_until).toLocaleDateString("id-ID")}
                          </p>
                        )}
                        {chosen?.moq_type === "BY_REQUEST" && isApprover && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-indigo-700">
                              Konfirmasi MOQ
                            </summary>
                            <div className="mt-2 space-y-2">
                              <input
                                className={input}
                                type="number"
                                min="1"
                                placeholder="Minimum vendor (pcs), opsional"
                                value={moqMinimum[first.line_id] ?? ""}
                                onChange={(event) =>
                                  setMoqMinimum({ ...moqMinimum, [first.line_id]: event.target.value })
                                }
                              />
                              <input
                                className={input}
                                placeholder="Referensi bukti"
                                value={moqEvidence[first.line_id] ?? ""}
                                onChange={(event) =>
                                  setMoqEvidence({ ...moqEvidence, [first.line_id]: event.target.value })
                                }
                              />
                              <button
                                className={secondary}
                                disabled={busy || previewBusy || !moqEvidence[first.line_id]?.trim() || !status?.enabled}
                                onClick={() =>
                                  void run("MOQ BY_REQUEST dikonfirmasi.", async () => {
                                    const { error: rpcError } = await supabase.rpc(
                                      "wms_v43c_confirm_moq",
                                      {
                                        p_line_id: first.line_id,
                                        p_confirmed_minimum_qty: moqMinimum[first.line_id]
                                          ? Number(moqMinimum[first.line_id])
                                          : null,
                                        p_evidence_ref: moqEvidence[first.line_id].trim(),
                                        p_valid_until: null,
                                      }
                                    );
                                    if (rpcError) throw rpcError;
                                    await loadPreview(selectedBatch);
                                  })
                                }
                              >
                                Simpan konfirmasi MOQ
                              </button>
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {previewBusy && <p role="status" className="text-sm text-slate-600">Memeriksa vendor dan kesiapan Draft...</p>}
        {selectedBatch && !previewBusy && preview.length === 0 && (
          <p className="text-sm text-slate-500">Draft belum memiliki baris yang dapat ditampilkan.</p>
        )}
        {!status?.enabled && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Workflow masih nonaktif. Vendor otomatis ditampilkan sebagai pratinjau; tidak ada pemilihan baru yang disimpan dan pengajuan belum dapat dilakukan.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-xl border bg-white p-4">
        <div>
          <h2 className="text-lg font-bold">Persetujuan Operasional</h2>
          <p className="text-sm text-slate-600">
            Keputusan ini terpisah dari persetujuan simulasi. PO yang dibuat masuk
            sebagai Draft dan diteruskan ke alur Purchase Order yang tersedia.
          </p>
        </div>
        {identityError && <p className="text-xs text-amber-800">{identityError}</p>}
        {approvals.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada permintaan operasional.</p>
        ) : (
          <div className="space-y-3">
            {approvals.map((approval) => (
              <article key={approval.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold">
                      Permintaan · {approval.status}
                    </p>
                    <p className="text-xs text-slate-600">
                      Diajukan oleh {actorNames[approval.submitted_by] ?? "Nama tidak tersedia"}
                      {" · "}{new Date(approval.submitted_at).toLocaleString("id-ID")}
                    </p>
                    {approval.decided_by && (
                      <p className="text-xs text-slate-600">
                        Diputuskan oleh {actorNames[approval.decided_by] ?? "Nama tidak tersedia"}
                        {approval.decided_at
                          ? ` · ${new Date(approval.decided_at).toLocaleString("id-ID")}`
                          : ""}
                      </p>
                    )}
                    {approval.decision_notes && (
                      <p className="mt-1 text-sm text-slate-700">{approval.decision_notes}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={secondary}
                      onClick={() => void loadApprovalLines(approval.id)}
                    >
                      Lihat snapshot
                    </button>
                    {approval.status === "SUBMITTED" && isApprover && (
                      <>
                        <input
                          className={`${input} max-w-64`}
                          value={decisionNotes[approval.id] ?? ""}
                          onChange={(event) =>
                            setDecisionNotes({
                              ...decisionNotes,
                              [approval.id]: event.target.value,
                            })
                          }
                          placeholder="Catatan keputusan"
                          aria-label="Catatan keputusan"
                        />
                        <button
                          className={button}
                          disabled={busy || !status?.enabled}
                          onClick={() =>
                            void run("Draft disetujui secara operasional.", async () => {
                              const { error: rpcError } = await supabase.rpc(
                                "wms_v43c_decide_operational_approval",
                                {
                                  p_approval_id: approval.id,
                                  p_decision: "APPROVED",
                                  p_notes: decisionNotes[approval.id] || null,
                                }
                              );
                              if (rpcError) throw rpcError;
                            })
                          }
                        >
                          Setujui
                        </button>
                        <button
                          className={secondary}
                          disabled={busy || !decisionNotes[approval.id]?.trim() || !status?.enabled}
                          onClick={() =>
                            void run("Draft ditolak; buat Draft Review baru untuk rework.", async () => {
                              const { error: rpcError } = await supabase.rpc(
                                "wms_v43c_decide_operational_approval",
                                {
                                  p_approval_id: approval.id,
                                  p_decision: "REJECTED",
                                  p_notes: decisionNotes[approval.id].trim(),
                                }
                              );
                              if (rpcError) throw rpcError;
                            })
                          }
                        >
                          Tolak
                        </button>
                      </>
                    )}
                    {approval.status === "APPROVED" &&
                      isApprover &&
                      !generatedOrders.some((order) => order.approval_id === approval.id) && (
                      <button
                        className={button}
                        disabled={busy || !status?.enabled}
                        onClick={() => {
                          if (!window.confirm("Buat PO DRAFT berdasarkan snapshot approval ini?")) return;
                          void run("PO DRAFT berhasil dibuat; stok dan PO historis tidak berubah.", async () => {
                            const { error: rpcError } = await supabase.rpc(
                              "wms_v43c_generate_purchase_orders",
                              { p_approval_id: approval.id }
                            );
                            if (rpcError) throw rpcError;
                          });
                        }}
                      >
                        Buat PO
                      </button>
                    )}
                  </div>
                </div>
                {generatedOrders.filter((order) => order.approval_id === approval.id).length > 0 && (
                  <div className="mt-3 rounded-lg bg-slate-50 p-3">
                    <p className="text-sm font-bold">PO hasil konversi</p>
                    <div className="mt-2 space-y-2">
                      {generatedOrders
                        .filter((order) => order.approval_id === approval.id)
                        .map((order) => (
                          <div
                            key={order.po_id}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <span>{order.po_number} · {order.status}</span>
                            <div className="flex gap-2">
                              <a className={secondary} href="/production-planning/orders/">
                                Lihat PO &amp; Incoming
                              </a>
                              {order.status === "DRAFT" && isApprover && (
                                <button
                                  className={button}
                                  disabled={busy}
                                  onClick={() => {
                                    if (!window.confirm(`Finalkan ${order.po_number}?`)) return;
                                    void run("PO menjadi FINAL dan masuk alur Incoming.", async () => {
                                      const { error: rpcError } = await supabase.rpc(
                                        "wms_v43c_finalize_generated_po",
                                        { p_po_id: order.po_id }
                                      );
                                      if (rpcError) throw rpcError;
                                    });
                                  }}
                                >
                                  Finalisasi
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                {selectedApproval === approval.id && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[850px] text-left text-xs">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="p-2">SKU</th><th className="p-2">Usulan</th>
                          <th className="p-2">HPP Master snapshot</th>
                          <th className="p-2">Harga vendor snapshot</th>
                          <th className="p-2">Lead time</th><th className="p-2">Lifecycle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvalLines.map((line) => (
                          <tr key={line.id} className="border-b">
                            <td className="p-2">{line.sku_snapshot} · {line.product_name_snapshot}</td>
                            <td className="p-2">{line.proposed_qty}</td>
                            <td className="p-2">{money(line.master_hpp_snapshot)} IDR</td>
                            <td className="p-2">{money(line.vendor_unit_price_snapshot)} {line.currency_snapshot}</td>
                            <td className="p-2">{line.lead_time_days_snapshot} hari</td>
                            <td className="p-2">{line.lifecycle_status_snapshot}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-slate-500">
                      Snapshot HPP Master dan harga vendor tidak digabungkan. MOQ tersimpan
                      pada detail conversion dan tidak mengubah riwayat HPP.
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
