"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import SimulationApprovalPanel from "./SimulationApprovalPanel";
import { createClient } from "@/utils/supabase/client";

type Decision = "PROPOSE" | "HOLD" | "EXCLUDE";

type PlanningItem = {
  variant_id: string;
  sku_master: string;
  product_code: string;
  product_name?: string;
  color?: string;
  size?: string;
  vendor_name?: string;
  vendor_moq_type?: string;
  vendor_moq_quantity?: number | null;
  production_policy?: string;
  v4_status?: string;
  v4_stock_normal_units?: number | null;
  v4_incoming_po_final_units?: number | null;
  target_stock_position_units?: number | null;
  v4_net_need_before_moq?: number | null;
};

type Edit = {
  decision: Decision;
  qty: number;
  notes: string;
};

type Draft = {
  id: string;
  status: string;
  created_at: string;
  notes: string | null;
};

type SavedLine = {
  variant_id: string;
  decision: Decision;
  proposed_qty: number;
  review_notes: string | null;
};

type DraftPreviewSummary = {
  id: string;
  approvalStatus: string;
  skuCount: number;
  totalQty: number;
  qtyComplete: boolean;
};

type SkuSaveState = "saving" | "failed";

type ReadinessV1 = {
  batch_id: string;
  as_of_date: string;
  mode: string;
  sales: {
    last_sale_date: string | null;
    period_end: string | null;
    age_days: number | null;
    rows: number;
    fresh: boolean;
  };
  proposal: {
    sku_count: number;
    qty: number;
  };
  models: Array<{
    product_code: string;
    vendor_name: string;
    total_master_sku: number;
    sku_with_incoming: number;
    incoming_all_sku: number;
    vendor_verified_count: number;
    vendor_ready_count: number;
    moq_type: string | null;
    moq_quantity: number | null;
    candidate_only_count: number;
    preview_coverage_verified: boolean;
  }>;
  approval_enabled: boolean;
  po_generation_enabled: boolean;
};
type PreflightResult = {
  batch_id?: string;
  preview_sku?: number;
  proposed_sku?: number;
  blocker_count?: number;
  blockers?: string[];
  data_checks_passed?: boolean;
  approval_enabled?: boolean;
  po_generation_enabled?: boolean;
};

const number = (value: unknown) => {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? 0 : n;
};

const fmt = (value: unknown) => {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 2,
  }).format(Number(value));
};

function sameEdit(left: Edit | undefined, right: Edit | undefined) {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.decision === right.decision &&
      left.qty === right.qty &&
      left.notes === right.notes)
  );
}

function hasUnsavedEdits(
  edits: Record<string, Edit>,
  savedEdits: Record<string, Edit>
) {
  const ids = new Set([
    ...Object.keys(edits),
    ...Object.keys(savedEdits),
  ]);

  return [...ids].some((id) => !sameEdit(edits[id], savedEdits[id]));
}

function getChangedEdits(
  edits: Record<string, Edit>,
  savedEdits: Record<string, Edit>
) {
  return Object.entries(edits).filter(
    ([id, edit]) => !sameEdit(edit, savedEdits[id])
  );
}

function getReturnedBatchId(data: unknown, currentBatchId: string | null) {
  let returnedBatchId: string | null = null;
  const result =
    Array.isArray(data) && data.length === 1 ? data[0] : data;

  if (
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    "batch_id" in result &&
    typeof result.batch_id === "string"
  ) {
    returnedBatchId = result.batch_id;
  } else if (typeof result === "string") {
    returnedBatchId = result;
  }

  if (
    returnedBatchId &&
    currentBatchId &&
    returnedBatchId !== currentBatchId
  ) {
    throw new Error("RPC mengembalikan batch_id yang berbeda.");
  }

  const batchId = returnedBatchId || currentBatchId;
  if (!batchId) {
    throw new Error("RPC tidak mengembalikan batch_id Draft.");
  }

  return batchId;
}

export default function ProductionReviewV42() {
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [savedEdits, setSavedEdits] = useState<Record<string, Edit>>({});
  const [skuSaveStates, setSkuSaveStates] = useState<
    Record<string, SkuSaveState>
  >({});
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [draftPreviewSummary, setDraftPreviewSummary] =
    useState<DraftPreviewSummary | null>(null);
  const [draftPreviewError, setDraftPreviewError] = useState("");
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [hasSimulationRequest, setHasSimulationRequest] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [readiness, setReadiness] = useState<ReadinessV1 | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const savingLock = useRef(false);

  async function requireUser() {
    const db = createClient();
    const { data, error: authError } = await db.auth.getUser();

    if (authError || !data.user) {
      throw new Error("Sesi login WMS tidak aktif. Login kembali.");
    }

    return db;
  }

  async function refreshDrafts() {
    const db = await requireUser();

    const { data, error: queryError } = await db
      .from("wms_production_review_batches")
      .select("id,status,created_at,notes")
      .eq("status", "DRAFT")
      .order("created_at", { ascending: false })
      .limit(30);

    if (queryError) throw new Error(queryError.message);

    setDrafts((data ?? []) as Draft[]);
  }

  async function assertEditableBatch(
    db: Awaited<ReturnType<typeof requireUser>>,
    id: string
  ) {
    const { data: batch, error: batchError } = await db
      .from("wms_production_review_batches")
      .select("id,status")
      .eq("id", id)
      .maybeSingle();

    if (batchError) throw new Error(batchError.message);
    if (!batch || batch.status !== "DRAFT") {
      throw new Error("Draft tidak tersedia untuk diedit.");
    }

    const { data: requests, error: requestError } = await db
      .from("wms_sim_approval_requests")
      .select("id")
      .eq("batch_id", id)
      .limit(1);

    if (requestError) throw new Error(requestError.message);
    if ((requests ?? []).length > 0) {
      setHasSimulationRequest(true);
      throw new Error(
        "Draft sudah memiliki pengajuan simulasi dan tidak dapat diedit."
      );
    }
  }

  function validateSkuEdit(item: PlanningItem | undefined, edit: Edit) {
    if (!item) throw new Error("SKU tidak valid pada preview V4.");

    if (
      edit.decision === "PROPOSE" &&
      (!Number.isSafeInteger(edit.qty) ||
        edit.qty <= 0 ||
        edit.qty > 100000)
    ) {
      throw new Error(
        `Qty produksi ${item.sku_master} harus bilangan bulat positif.`
      );
    }

    if (!["PROPOSE", "HOLD", "EXCLUDE"].includes(edit.decision)) {
      throw new Error("Status keputusan tidak valid.");
    }

    return edit.decision === "PROPOSE" ? edit.qty : 0;
  }

  async function persistSku(
    db: Awaited<ReturnType<typeof requireUser>>,
    currentBatchId: string | null,
    variantId: string,
    edit: Edit,
    qty: number,
    onBatchId: (id: string) => void
  ) {
    const { data, error: rpcError } = await db.rpc(
      "wms_save_review_sku_v42f_v2",
      {
        p_batch_id: currentBatchId,
        p_variant_id: variantId,
        p_decision: edit.decision,
        p_qty: qty,
        p_notes: edit.notes || null,
      }
    );

    if (rpcError) throw new Error(rpcError.message);

    const id = getReturnedBatchId(data, currentBatchId);
    onBatchId(id);

    const { data: line, error: lineError } = await db
      .from("wms_production_review_lines")
      .select("variant_id,decision,proposed_qty,review_notes")
      .eq("batch_id", id)
      .eq("variant_id", variantId)
      .maybeSingle();

    if (lineError) throw new Error(lineError.message);
    if (
      !line ||
      line.decision !== edit.decision ||
      number(line.proposed_qty) !== qty ||
      (line.review_notes ?? "") !== edit.notes
    ) {
      throw new Error(
        "Isi SKU hasil simpan tidak cocok dengan perubahan terakhir."
      );
    }

    return id;
  }

  async function loadPreview() {
    if (loading || saving) return;

    setLoading(true);
    setError("");
    setComplete(false);
    setMessage("Memuat data Smart Planning V4...");

    try {
      const db = await requireUser();
      const all: PlanningItem[] = [];
      const seen = new Set<string>();
      let finished = false;

      for (let p = 0; p < 20; p++) {
        const { data, error: rpcError } = await db.rpc(
          "get_fashion_production_preview_v4",
          {
            p_lead_time_days: 30,
            p_review_days: 7,
            p_limit: 100,
            p_offset: p * 100,
          }
        );

        if (rpcError) throw new Error(rpcError.message);

        if (!Array.isArray(data)) {
          throw new Error("Format data V4 tidak sesuai.");
        }

        for (const item of data as PlanningItem[]) {
          if (!item.variant_id || seen.has(item.variant_id)) {
            throw new Error("Variant ID kosong atau duplikat.");
          }

          seen.add(item.variant_id);
          all.push(item);
        }

        setMessage(`${all.length} SKU sedang dibaca...`);

        if (data.length < 100) {
          finished = true;
          break;
        }
      }

      if (!finished || all.length === 0) {
        throw new Error("Data V4 belum lengkap.");
      }

      setItems(all);
      setPreflight(null);
      setReadiness(null);
      setDirty(false);
      setEdits({});
      setSavedEdits({});
      setSkuSaveStates({});
      setBatchId(null);
      setNotes("");
      setSavedNotes("");
      setHasSimulationRequest(false);
      setPage(0);
      setComplete(true);

      await refreshDrafts();

      setMessage(
        `${all.length} SKU berhasil dibaca. Siap membuat Draft Review.`
      );
    } catch (e) {
      setComplete(false);
      setError(e instanceof Error ? e.message : "Gagal memuat data.");
      setMessage("Data belum lengkap.");
    } finally {
      setLoading(false);
    }
  }

  const eligible = useMemo(() => {
    return items.filter(
      (r) =>
        r.v4_status === "SIMULATION_ONLY" &&
        r.production_policy === "ACTIVE_SIMULATION_ONLY"
    );
  }, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    return eligible.filter((r) => {
      if (!q) return true;

      return [
        r.sku_master,
        r.product_code,
        r.product_name,
        r.vendor_name,
        r.color,
      ].some((value) =>
        String(value ?? "").toLowerCase().includes(q)
      );
    });
  }, [eligible, search]);

  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const shown = visible.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize
  );

  function changeDecision(
    item: PlanningItem,
    value: string
  ) {
    if (busy || hasSimulationRequest) return;

    if (
      !value &&
      savedEdits[item.variant_id]
    ) {
      return;
    }

    setPreflight(null);
    const next = { ...edits };

    if (!value) {
      delete next[item.variant_id];
    } else {
      const old = next[item.variant_id];
      next[item.variant_id] = {
        decision: value as Decision,
        qty:
          value === "PROPOSE"
            ? old?.decision === "PROPOSE"
              ? old.qty
              : Math.ceil(number(item.v4_net_need_before_moq))
            : 0,
        notes: old?.notes ?? "",
      };
    }

    setEdits(next);
    setSkuSaveStates((previous) => {
      const updated = { ...previous };
      delete updated[item.variant_id];
      return updated;
    });
    setDirty(
      hasUnsavedEdits(next, savedEdits) || notes !== savedNotes
    );
  }

  function updateEdit(
    id: string,
    patch: Partial<Edit>
  ) {
    if (busy || hasSimulationRequest) return;

    const current = edits[id];
    if (!current) return;

    setPreflight(null);
    const next = {
      ...edits,
      [id]: { ...current, ...patch },
    };
    setEdits(next);
    setSkuSaveStates((previous) => {
      const updated = { ...previous };
      delete updated[id];
      return updated;
    });
    setDirty(
      hasUnsavedEdits(next, savedEdits) || notes !== savedNotes
    );
  }

  const selected = useMemo(() => {
    return Object.entries(edits).filter(([, e]) => !!e);
  }, [edits]);

  const proposed = selected.filter(
    ([, e]) => e.decision === "PROPOSE"
  );

  const proposedQty = proposed.reduce(
    (sum, [, e]) => sum + number(e.qty),
    0
  );
  const changedEdits = useMemo(
    () => getChangedEdits(edits, savedEdits),
    [edits, savedEdits]
  );
  const canSaveAll =
    changedEdits.length > 0 ||
    (!!batchId && notes !== savedNotes);

  const groupReview = useMemo(() => {
    const byId = new Map(items.map((r) => [r.variant_id, r]));
    const groups = new Map<
      string,
      {
        name: string;
        qty: number;
        moq: number | null;
        type: string;
      }
    >();

    for (const [id, edit] of proposed) {
      const item = byId.get(id);
      if (!item) continue;

      const type = String(item.vendor_moq_type ?? "").toUpperCase();
      const color = type === "PER_COLOR"
        ? String(item.color ?? "").toUpperCase()
        : "SEMUA WARNA";

      const key = JSON.stringify([
        item.product_code,
        item.vendor_name,
        type,
        color,
      ]);

      const old = groups.get(key);

      if (old) {
        old.qty += number(edit.qty);
      } else {
        groups.set(key, {
          name: `${item.product_code} / ${color}`,
          qty: number(edit.qty),
          moq:
            item.vendor_moq_quantity == null
              ? null
              : number(item.vendor_moq_quantity),
          type,
        });
      }
    }

    return [...groups.values()].map((g) => ({
      ...g,
      warning:
        g.type === "BY_REQUEST"
          ? "Konfirmasi vendor"
          : g.moq == null || g.moq <= 0
            ? "MOQ perlu diverifikasi"
            : g.qty < g.moq
              ? `Kurang ${fmt(g.moq - g.qty)} pcs dari MOQ`
              : "Memenuhi minimum",
    }));
  }, [items, proposed]);

  async function checkReadiness() {
    if (!batchId || checkingReadiness || busy || dirty) return;

    setCheckingReadiness(true);
    setReadiness(null);
    setError("");
    setMessage("Memeriksa kesiapan sumber data WMS...");

    try {
      const db = await requireUser();
      const { data, error: rpcError } = await db.rpc(
        "wms_production_readiness_v1",
        { p_batch_id: batchId }
      );

      if (rpcError) throw new Error(rpcError.message);

      const result = data as ReadinessV1 | null;

      if (
        !result ||
        result.batch_id !== batchId ||
        result.mode !== "SIMULATION_DATA" ||
        !result.sales ||
        !Array.isArray(result.models) ||
        result.approval_enabled !== false ||
        result.po_generation_enabled !== false
      ) {
        throw new Error("Respons kesiapan data tidak valid.");
      }

      setReadiness(result);
      setMessage(
        "Kesiapan data berhasil diperiksa. " +
        "Data saat ini masih dalam mode simulasi."
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Gagal membaca kesiapan data."
      );
    } finally {
      setCheckingReadiness(false);
    }
  }
  async function checkPreflight() {
    if (!batchId || checking || loading || saving || dirty) return;

    setChecking(true);
    setPreflight(null);
    setError("");
    setMessage("Memeriksa Draft di server...");

    try {
      const db = await requireUser();

      const { data, error: rpcError } = await db.rpc(
        "wms_review_preflight_v42",
        { p_batch_id: batchId }
      );

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Format hasil validasi server tidak sesuai.");
      }

      const result = data as PreflightResult;

      if (
        !Array.isArray(result.blockers) ||
        typeof result.blocker_count !== "number" ||
        typeof result.data_checks_passed !== "boolean" ||
        result.approval_enabled !== false ||
        result.po_generation_enabled !== false
      ) {
        throw new Error("Hasil validasi tidak lengkap atau tidak aman.");
      }

      setPreflight(result);

      setMessage(
        `Pemeriksaan selesai: ${result.blocker_count} kendala. ` +
        "Approval dan pembuatan PO tetap terkunci."
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Pemeriksaan server gagal."
      );
      setMessage("Draft belum berhasil divalidasi.");
    } finally {
      setChecking(false);
    }
  }

  async function saveSku(variantId: string) {
    if (
      !complete ||
      busy ||
      savingLock.current ||
      hasSimulationRequest
    ) {
      return;
    }

    const edit = edits[variantId];
    if (!edit || sameEdit(edit, savedEdits[variantId])) return;

    const item = eligible.find((row) => row.variant_id === variantId);
    let qty: number;

    try {
      qty = validateSkuEdit(item, edit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Data SKU tidak valid.");
      return;
    }

    savingLock.current = true;
    setSaving(true);
    setError("");
    setPreflight(null);
    setReadiness(null);
    setSkuSaveStates((previous) => ({
      ...previous,
      [variantId]: "saving",
    }));
    setMessage(`Menyimpan SKU ${item?.sku_master ?? variantId}...`);

    try {
      const db = await requireUser();
      let id = batchId;

      if (id) await assertEditableBatch(db, id);

      id = await persistSku(db, id, variantId, edit, qty, (nextId) => {
        id = nextId;
        setBatchId(nextId);
      });

      const nextSaved = { ...savedEdits, [variantId]: edit };
      setSavedEdits(nextSaved);
      setSkuSaveStates((previous) => {
        const updated = { ...previous };
        delete updated[variantId];
        return updated;
      });
      setDirty(
        hasUnsavedEdits(edits, nextSaved) || notes !== savedNotes
      );
      setMessage(`SKU ${item?.sku_master ?? variantId} tersimpan.`);

      try {
        await refreshDrafts();
      } catch (e) {
        setError(
          `SKU tersimpan, tetapi daftar Draft gagal diperbarui: ${
            e instanceof Error ? e.message : "kesalahan tidak diketahui"
          }`
        );
      }
    } catch (e) {
      setSkuSaveStates((previous) => ({
        ...previous,
        [variantId]: "failed",
      }));
      setDirty(true);
      setError(
        e instanceof Error ? e.message : "Gagal menyimpan SKU."
      );
      setMessage("SKU gagal disimpan. Periksa dan coba lagi.");
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  }

  async function saveAll() {
    if (
      !complete ||
      busy ||
      savingLock.current ||
      hasSimulationRequest
    ) {
      return;
    }

    const work = [...changedEdits];
    const byId = new Map(eligible.map((item) => [item.variant_id, item]));
    const quantities = new Map<string, number>();

    try {
      for (const [id, edit] of work) {
        quantities.set(id, validateSkuEdit(byId.get(id), edit));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Data SKU tidak valid.");
      return;
    }

    const saveBatchNotes = !!batchId && notes !== savedNotes;
    if (work.length === 0 && !saveBatchNotes) return;

    savingLock.current = true;
    setSaving(true);
    setError("");
    setPreflight(null);
    setReadiness(null);
    setSkuSaveStates((previous) => {
      const updated = { ...previous };
      for (const [id] of work) updated[id] = "saving";
      return updated;
    });
    setMessage("Menyimpan perubahan SKU...");

    const nextSaved = { ...savedEdits };
    const failures: string[] = [];
    let savedCount = 0;
    let id = batchId;
    let nextSavedNotes = savedNotes;
    let notesFailure = "";

    try {
      const db = await requireUser();
      if (id) await assertEditableBatch(db, id);

      for (const [variantId, edit] of work) {
        const item = byId.get(variantId);

        try {
          if (id) await assertEditableBatch(db, id);
          id = await persistSku(
            db,
            id,
            variantId,
            edit,
            quantities.get(variantId) ?? 0,
            (nextId) => {
              id = nextId;
              setBatchId(nextId);
            }
          );
          nextSaved[variantId] = edit;
          savedCount++;
          setSkuSaveStates((previous) => {
            const updated = { ...previous };
            delete updated[variantId];
            return updated;
          });
        } catch (e) {
          const reason =
            e instanceof Error ? e.message : "kesalahan tidak diketahui";
          failures.push(`${item?.sku_master ?? variantId}: ${reason}`);
          setSkuSaveStates((previous) => ({
            ...previous,
            [variantId]: "failed",
          }));
        }
      }

      if (id && notes !== nextSavedNotes) {
        try {
          await assertEditableBatch(db, id);
          const { data: updatedBatch, error: updateError } = await db
            .from("wms_production_review_batches")
            .update({ notes: notes || null })
            .eq("id", id)
            .eq("status", "DRAFT")
            .select("id")
            .maybeSingle();

          if (updateError) throw new Error(updateError.message);
          if (!updatedBatch) {
            throw new Error("Draft tidak tersedia untuk diperbarui.");
          }

          nextSavedNotes = notes;
        } catch (e) {
          notesFailure =
            e instanceof Error ? e.message : "kesalahan tidak diketahui";
        }
      } else if (work.length === 0 && notes !== nextSavedNotes) {
        notesFailure = "ID Draft tidak tersedia untuk menyimpan catatan.";
      }

      setSavedEdits(nextSaved);
      setSavedNotes(nextSavedNotes);
      setDirty(
        hasUnsavedEdits(edits, nextSaved) || notes !== nextSavedNotes
      );

      if (failures.length > 0 || notesFailure) {
        const failedSkuCount = failures.length;
        setError(
          [
            failures.length > 0
              ? `SKU gagal: ${failures.join(" | ")}`
              : "",
            notesFailure ? `Catatan Draft gagal: ${notesFailure}` : "",
          ]
            .filter(Boolean)
            .join(" ")
        );
        if (failedSkuCount > 0) {
          setMessage(
            savedCount > 0
              ? `Penyimpanan parsial: ${savedCount} SKU tersimpan, ` +
                `${failedSkuCount} SKU gagal. Periksa daftar kegagalan.`
              : `Penyimpanan gagal: 0 SKU tersimpan, ${failedSkuCount} SKU gagal.`
          );
        } else {
          setMessage(
            "Catatan Draft gagal disimpan; tidak ada SKU berubah."
          );
        }
      } else if (savedCount > 0) {
        setMessage(
          `Simpan Semua berhasil: ${savedCount} SKU berubah telah disimpan.`
        );
      } else {
        setMessage("Catatan Draft berhasil disimpan; tidak ada SKU berubah.");
      }

      try {
        await refreshDrafts();
      } catch (e) {
        setError((current) =>
          [
            current,
            `Daftar Draft gagal diperbarui: ${
              e instanceof Error ? e.message : "kesalahan tidak diketahui"
            }`,
          ]
            .filter(Boolean)
            .join(" ")
        );
      }
    } catch (e) {
      const reason =
        e instanceof Error ? e.message : "Gagal menyimpan Draft.";
      setSkuSaveStates((previous) => {
        const updated = { ...previous };
        for (const [variantId] of work) updated[variantId] = "failed";
        return updated;
      });
      setDirty(true);
      setError(reason);
      setMessage(
        `Penyimpanan gagal untuk ${work.length} SKU. Tidak ada status sukses yang diasumsikan.`
      );
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  }

  async function openDraft(id: string) {
    if (!complete || saving || loading) return;

    setLoading(true);
    setError("");
    setDraftPreviewSummary(null);
    setDraftPreviewError("");

    try {
      const db = await requireUser();

      const { data: batch, error: batchError } = await db
        .from("wms_production_review_batches")
        .select("id,status,notes")
        .eq("id", id)
        .single();

      if (batchError || !batch || batch.status !== "DRAFT") {
        throw new Error("Draft tidak tersedia untuk diedit.");
      }

      const lines: SavedLine[] = [];
      const pageSize = 1000;
      let allLinesLoaded = false;
      for (let offset = 0; offset < 100000; offset += pageSize) {
        const { data, error: lineError } = await db
          .from("wms_production_review_lines")
          .select("variant_id,decision,proposed_qty,review_notes")
          .eq("batch_id", id)
          .range(offset, offset + pageSize - 1);

        if (lineError) throw new Error(lineError.message);

        const pageLines = (data ?? []) as SavedLine[];
        lines.push(...pageLines);
        if (pageLines.length < pageSize) {
          allLinesLoaded = true;
          break;
        }
      }

      if (!allLinesLoaded || lines.length === 0) {
        throw new Error(
          "Baris Draft tidak dapat dimuat lengkap. Ringkasan Preview tidak tersedia."
        );
      }

      const { data: requests, error: requestError } = await db
        .from("wms_sim_approval_requests")
        .select("id,status,requested_at")
        .eq("batch_id", id)
        .order("requested_at", { ascending: false })
        .limit(1);

      if (requestError) throw new Error(requestError.message);
      const latestRequest = requests?.[0];

      const restored: Record<string, Edit> = {};
      const known = new Set(eligible.map((r) => r.variant_id));
      let unmatched = 0;

      for (const line of lines) {
        if (!known.has(line.variant_id)) {
          unmatched++;
          continue;
        }

        restored[line.variant_id] = {
          decision: line.decision,
          qty: number(line.proposed_qty),
          notes: line.review_notes ?? "",
        };
      }

      setEdits(restored);
      setSavedEdits(restored);
      setSkuSaveStates({});
      setNotes(batch.notes ?? "");
      setSavedNotes(batch.notes ?? "");
      setBatchId(id);
      setHasSimulationRequest(!!latestRequest);
      const proposedLines = lines.filter(
        (line) => line.decision === "PROPOSE"
      );
      const invalidQty = proposedLines.some(
        (line) =>
          !Number.isSafeInteger(Number(line.proposed_qty)) ||
          Number(line.proposed_qty) <= 0
      );
      setDraftPreviewSummary({
        id,
        approvalStatus: latestRequest?.status ?? "Belum diajukan",
        skuCount: lines.length,
        totalQty: proposedLines.reduce(
          (total, line) => total + number(line.proposed_qty),
          0
        ),
        qtyComplete: !invalidQty,
      });
      setPage(0);
      setDirty(false);
      setPreflight(null);
      setReadiness(null);

      setMessage(
        `Draft dibuka: ${Object.keys(restored).length} SKU` +
        (latestRequest
          ? ". Pengajuan simulasi sudah ada; Draft hanya dapat dibaca."
          : ".")
      );

      if (unmatched > 0) {
        setError(
          `${unmatched} SKU Draft tidak cocok dengan preview V4 ` +
          "saat ini. Jangan ajukan approval."
        );
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Gagal membuka Draft.";
      setError(reason);
      setDraftPreviewError(reason);
      setDraftPreviewSummary(null);
    } finally {
      setLoading(false);
    }
  }

  const busy = loading || saving;

  return (
    <main className="w-full min-w-0 max-w-full overflow-x-clip px-4 pt-6 pb-64 md:px-8 md:pb-44">
      <div className="mx-auto flex max-w-[1600px] min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">
              HI.PRIMA WMS / SMART PRODUCTION PLANNING
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Review & Approval Produksi V4.2
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Tahap Draft: pilih SKU, revisi jumlah, dan simpan keputusan.
            </p>
          </div>
          <Link
            href="/production-planning/v4/moq/"
            className="shrink-0 rounded-lg border border-slate-300 px-4 py-3 text-sm"
          >
            Kembali ke Review MOQ
          </Link>
        </div>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>TAHAP DRAFT — APPROVAL BELUM AKTIF.</strong>
          {" "}Simpan Draft tidak menambah stok, membuat PO,
          atau menyetujui produksi. Data penjualan perlu diperbarui,
          MOQ perlu divalidasi, dan incoming di luar simulasi
          harus direkonsiliasi sebelum pengajuan.
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <button
            type="button"
            onClick={loadPreview}
            disabled={busy}
            className="shrink-0 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Memuat..." : "Muat Simulasi V4"}
          </button>
          <span className="text-sm text-slate-600" role="status">
            {message || "Muat simulasi untuk memulai."}
          </span>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["SKU Simulasi", items.length],
            ["SKU Bisa Direview", eligible.length],
            ["SKU Dipilih", selected.length],
            ["Total Qty Diajukan", `${fmt(proposedQty)} pcs`],
          ].map(([label, value]) => (
            <div key={String(label)} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-2 text-xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-bold">Draft Produksi</h2>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !complete}
              onClick={() => {
                setBatchId(null);
                setDraftPreviewSummary(null);
                setDraftPreviewError("");
                setEdits({});
                setSavedEdits({});
                setSkuSaveStates({});
                setNotes("");
                setSavedNotes("");
                setHasSimulationRequest(false);
                setDirty(false);
                setPreflight(null);
                setMessage("Draft baru siap diedit.");
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
            >
              Draft Baru
            </button>

            <select
              value=""
              disabled={busy || !complete}
              onChange={(e) => {
                if (e.target.value) void openDraft(e.target.value);
              }}
              className="max-w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
            >
              <option value="">Buka Draft Tersimpan</option>
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {new Date(d.created_at).toLocaleDateString("id-ID")} —
                  {d.id.slice(0, 8)}
                </option>
              ))}
            </select>

            {draftPreviewError && (
              <p
                role="alert"
                className="basis-full break-words rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
              >
                Preview Draft tidak tersedia: {draftPreviewError}
              </p>
            )}

            {draftPreviewSummary && (
              <div className="basis-full rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                <div className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-600">ID Draft</p>
                    <p className="break-all font-semibold">
                      {draftPreviewSummary.id.slice(0, 8)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-600">
                      Status Approval Simulasi
                    </p>
                    <p className="break-words font-semibold">
                      {draftPreviewSummary.approvalStatus === "REJECTED"
                        ? "DITOLAK (Simulasi)"
                        : draftPreviewSummary.approvalStatus === "APPROVED"
                          ? "Disetujui (Simulasi) — bukan operasional"
                          : draftPreviewSummary.approvalStatus === "SUBMITTED"
                            ? "Menunggu persetujuan (Simulasi)"
                            : draftPreviewSummary.approvalStatus}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">
                      Jumlah SKU dan Total Qty Usulan
                    </p>
                    <p className="font-semibold">
                      {draftPreviewSummary.skuCount} SKU ·{" "}
                      {draftPreviewSummary.qtyComplete
                        ? `${fmt(draftPreviewSummary.totalQty)} pcs`
                        : "Qty tidak lengkap"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/production-planning/v4/po-preview/?batch=${encodeURIComponent(draftPreviewSummary.id)}`}
                    className="inline-flex rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white hover:bg-indigo-800"
                  >
                    Lihat Preview PO Draft
                  </Link>
                  <span className="text-xs text-slate-600">
                    Preview read-only dari baris Draft tersimpan.
                  </span>
                </div>
              </div>
            )}

            {batchId && (
              <span className="text-xs text-slate-500">
                Draft aktif: {batchId}
              </span>
            )}
          </div>

          <textarea
            rows={2}
            value={notes}
            disabled={busy || hasSimulationRequest}
            onChange={(e) => {
              const nextNotes = e.target.value;
              setNotes(nextNotes);
              setDirty(
                hasUnsavedEdits(edits, savedEdits) ||
                nextNotes !== savedNotes
              );
              setPreflight(null);
            }}
            placeholder="Catatan umum review produksi..."
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

        </section>

        {/* V42E_FLOATING_ACTIONS */}
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[40vh] min-w-0 overflow-x-hidden overflow-y-auto border-t border-slate-300 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl sm:px-4 md:px-8 lg:left-64">
          <div className="mx-auto w-full min-w-0 max-w-[1600px]">
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">
                Review Produksi - Panel Aksi
              </p>
              <p className="text-xs text-slate-600">
                {selected.length} SKU dipilih | {fmt(proposedQty)} pcs
                {dirty ? " | Perubahan belum disimpan" : ""}
              </p>
            </div>
            <span className="rounded-lg bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800">
              MODE SIMULASI
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void saveAll()}
              disabled={
                !complete ||
                busy ||
                hasSimulationRequest ||
                !canSaveAll
              }
              className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving
                ? "Menyimpan..."
                : `Simpan Semua${changedEdits.length > 0
                  ? ` (${changedEdits.length} SKU)`
                  : ""}`}
            </button>

            <button
              type="button"
              disabled={!batchId || busy || dirty || checkingReadiness}
              onClick={() => void checkReadiness()}
              className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold disabled:opacity-40"
            >
              {checkingReadiness
                ? "Memeriksa Data..."
                : "Cek Kesiapan Data"}
            </button>
            <button
              type="button"
              disabled={!complete || !batchId || busy || checking || dirty}
              onClick={() => void checkPreflight()}
              className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold disabled:opacity-40"
            >
              {checking ? "Sedang Memeriksa..." : "Periksa Kelayakan Produksi"}
            </button>

            <button
              type="button"
              disabled
              title="Menunggu validasi server, data penjualan, dan MOQ."
              className="rounded-lg bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-500"
            >
              Ajukan Approval — Belum Aktif
            </button>
          </div>
          </div>
        </div>
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <h2 className="font-bold">Review Qty per SKU</h2>
              <p className="text-xs text-slate-500">
                {visible.length} SKU tersedia.
                Produk bermasalah tidak dapat dipilih.
              </p>
            </div>
            <input
              type="search"
              placeholder="Cari SKU, model, vendor..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[1450px] text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {[
                    "SKU / Produk",
                    "Vendor",
                    "Stok",
                    "Incoming",
                    "Target",
                    "Kebutuhan",
                    "Keputusan",
                    "Qty Draft",
                    "Catatan SKU",
                    "Status Simpan",
                    "Simpan SKU",
                  ].map((name) => (
                    <th key={name} className="border-b border-slate-200 px-3 py-3">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {shown.map((r) => {
                  const edit = edits[r.variant_id];
                  const skuStatus = !edit
                    ? "Belum dipilih"
                    : skuSaveStates[r.variant_id] === "saving"
                      ? "Menyimpan"
                      : sameEdit(edit, savedEdits[r.variant_id])
                        ? "Tersimpan"
                        : skuSaveStates[r.variant_id] === "failed"
                          ? "Gagal"
                          : "Belum disimpan";

                  return (
                    <tr key={r.variant_id}
                        className="border-b border-slate-100 align-top">
                      <td className="px-3 py-3">
                        <p className="font-semibold">{r.sku_master}</p>
                        <p className="text-xs text-slate-500">
                          {r.product_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {r.color} / {r.size}
                        </p>
                      </td>

                      <td className="px-3 py-3">
                        {r.vendor_name || "—"}
                      </td>
                      <td className="px-3 py-3">
                        {fmt(r.v4_stock_normal_units)}
                      </td>
                      <td className="px-3 py-3">
                        {fmt(r.v4_incoming_po_final_units)}
                      </td>
                      <td className="px-3 py-3">
                        {fmt(r.target_stock_position_units)}
                      </td>
                      <td className="px-3 py-3 font-semibold">
                        {fmt(r.v4_net_need_before_moq)}
                      </td>

                      <td className="px-3 py-3">
                        <select
                          value={edit?.decision ?? ""}
                          disabled={busy || hasSimulationRequest}
                          onChange={(e) =>
                            changeDecision(r, e.target.value)
                          }
                          className="rounded-lg border border-slate-300 px-2 py-2"
                        >
                          <option
                            value=""
                            disabled={!!savedEdits[r.variant_id]}
                          >
                            Belum Dipilih
                          </option>
                          <option value="PROPOSE">Ajukan Produksi</option>
                          <option value="HOLD">Tunda</option>
                          <option value="EXCLUDE">Tidak Diproduksi</option>
                        </select>
                      </td>

                      <td className="px-3 py-3">
                        <input
                          type="number"
                          min={0}
                          max={100000}
                          step={1}
                          value={edit?.qty ?? 0}
                          disabled={
                            busy ||
                            hasSimulationRequest ||
                            edit?.decision !== "PROPOSE"
                          }
                          onChange={(e) =>
                            updateEdit(r.variant_id, {
                              qty: Number(e.target.value),
                            })
                          }
                          className="w-28 rounded-lg border border-slate-300 px-2 py-2 disabled:bg-slate-100"
                        />
                      </td>

                      <td className="px-3 py-3">
                        <input
                          value={edit?.notes ?? ""}
                          disabled={busy || hasSimulationRequest || !edit}
                          onChange={(e) =>
                            updateEdit(r.variant_id, {
                              notes: e.target.value,
                            })
                          }
                          placeholder="Alasan revisi..."
                          className="w-48 rounded-lg border border-slate-300 px-2 py-2 disabled:bg-slate-100"
                        />
                      </td>

                      <td className="px-3 py-3">
                        <span
                          role="status"
                          className={
                            skuStatus === "Gagal"
                              ? "font-semibold text-red-700"
                              : skuStatus === "Tersimpan"
                                ? "font-semibold text-emerald-700"
                                : "text-slate-600"
                          }
                        >
                          {skuStatus}
                        </span>
                      </td>

                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => void saveSku(r.variant_id)}
                          disabled={
                            !edit ||
                            sameEdit(edit, savedEdits[r.variant_id]) ||
                            busy ||
                            hasSimulationRequest
                          }
                          className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40"
                        >
                          {skuSaveStates[r.variant_id] === "saving"
                            ? "Menyimpan..."
                            : "Simpan SKU"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="text-sm text-slate-500">
              Halaman {currentPage + 1} dari {pages}
            </span>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
              >
                Sebelumnya
              </button>

              <button
                type="button"
                disabled={currentPage >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </section>

        {readiness &&
          !dirty &&
          readiness.batch_id === batchId && (
            <section className="rounded-xl border border-slate-300 bg-white p-4">
              <h2 className="font-bold text-slate-900">
                Kesiapan Data Produksi — Simulasi
              </h2>

              <p className="mt-2 text-sm text-slate-700">
                Diperiksa: {readiness.as_of_date}
                {" | "}
                Draft: {readiness.proposal.sku_count} SKU,
                {" "}
                {readiness.proposal.qty} pcs
              </p>

              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-semibold">
                  Data Penjualan iSeller
                </p>
                <p>
                  Penjualan terakhir:
                  {" "}
                  {readiness.sales.last_sale_date ?? "Belum tersedia"}
                </p>
                <p>
                  Umur data:
                  {" "}
                  {readiness.sales.age_days ?? "—"} hari
                  {" | "}
                  {readiness.sales.rows} baris
                </p>
                <p className="font-semibold">
                  Status:
                  {" "}
                  {readiness.sales.fresh
                    ? "Terbaru menurut aturan 2 hari"
                    : "Perlu diperbarui sebelum Go-Live"}
                </p>
              </div>

              <div className="mt-3 space-y-3">
                {readiness.models.map((m, i) => (
                  <div
                    key={`${m.product_code}-${i}`}
                    className="rounded-lg border border-slate-200 p-3 text-sm"
                  >
                    <p className="font-bold">
                      {m.product_code} — {m.vendor_name}
                    </p>
                    <p>
                      Vendor terverifikasi:
                      {" "}
                      {m.vendor_verified_count}
                      {" | "}
                      Siap produksi: {m.vendor_ready_count}
                    </p>
                    <p>
                      MOQ: {m.moq_type ?? "Belum tersedia"}
                      {" / "}
                      {m.moq_quantity ?? "—"} pcs
                    </p>
                    <p>
                      Incoming PO Final:
                      {" "}
                      {m.incoming_all_sku} pcs
                      {" "}
                      dari {m.sku_with_incoming} SKU
                    </p>
                    <p>
                      Total SKU master model:
                      {" "}
                      {m.total_master_sku}
                    </p>
                    <p>
                      Mapping kandidat perlu review:
                      {" "}
                      {m.candidate_only_count}
                    </p>
                    <p className="font-semibold text-amber-800">
                      Cakupan terhadap preview V4 belum diverifikasi penuh
                    </p>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-sm font-semibold text-amber-900">
                Mode simulasi. Pemeriksaan ini belum mengizinkan
                Approval maupun Generate PO.
              </p>
            </section>
          )}
        <SimulationApprovalPanel
          batchId={batchId}
          dirty={dirty}
          busy={busy || checking || checkingReadiness}
        />
        {preflight && (
          <section
            role="status"
            className="rounded-xl border border-amber-300 bg-amber-50 p-4"
          >
            <h2 className="font-bold text-slate-900">
              Hasil Pemeriksaan Server V4.2B
            </h2>

            <p className="mt-2 text-sm">
              Preview: {preflight.preview_sku ?? "—"} SKU
              {" | "}
              Usulan: {preflight.proposed_sku ?? "—"} SKU
              {" | "}
              Kendala: {preflight.blocker_count ?? "—"}
            </p>

            <p className="mt-2 font-semibold text-amber-900">
              {preflight.data_checks_passed
                ? "Pemeriksaan awal tanpa kendala. Belum merupakan persetujuan."
                : "Belum layak diajukan. Periksa kendala berikut."}
            </p>

            {preflight.blockers && preflight.blockers.length > 0 && (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-red-800">
                {preflight.blockers.map((blocker, index) => (
                  <li key={`${index}-${blocker}`}>
                    {blocker.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-xs text-slate-600">
              Hasil berdasarkan Draft tersimpan. Approval dan Generate PO
              tetap tidak aktif. Belum ada transaksi stok maupun PO.
            </p>
          </section>
        )}

        {groupReview.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-bold">Pemeriksaan MOQ Draft</h2>
            <p className="mt-1 text-xs text-slate-500">
              Pemeriksaan awal di browser, bukan validasi approval server.
            </p>

            <div className="mt-3 max-h-60 overflow-auto">
              {groupReview.map((g) => (
                <div key={g.name + g.type}
                     className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-sm">
                  <span className="font-medium">{g.name}</span>
                  <span>
                    Qty {fmt(g.qty)} / MOQ {fmt(g.moq)}
                  </span>
                  <span className={
                    g.warning === "Memenuhi minimum"
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }>
                    {g.warning}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="text-xs text-slate-500">
          Simpan Draft menyimpan catatan dan usulan jumlah, bukan keputusan
          final. Seluruh angka harus direvalidasi server sebelum approval
          dan pembuatan PO. Saat ini belum ada transaksi stok atau PO.
        </p>
      </div>
    </main>
  );
}