"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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

export default function ProductionReviewV42() {
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
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
      setBatchId(null);
      setNotes("");
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

  const pageSize = 20;
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
    setDirty(true);
    setPreflight(null);
    setEdits((previous) => {
      const next = { ...previous };

      if (!value) {
        delete next[item.variant_id];
        return next;
      }

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

      return next;
    });
  }

  function updateEdit(
    id: string,
    patch: Partial<Edit>
  ) {
    setDirty(true);
    setPreflight(null);
    setEdits((previous) => {
      const current = previous[id];
      if (!current) return previous;

      return {
        ...previous,
        [id]: { ...current, ...patch },
      };
    });
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

  async function saveDraft() {
    if (!complete || saving || loading) return;

    setSaving(true);
    setError("");
    setPreflight(null);
    setReadiness(null);
    setMessage("Menyimpan Draft Review...");

    try {
      const db = await requireUser();

      if (selected.length === 0) {
        throw new Error(
          "Pilih minimal satu SKU untuk direview."
        );
      }

      const byId = new Map(
        eligible.map((r) => [r.variant_id, r])
      );

      const payload = selected.map(([id, edit]) => {
        const item = byId.get(id);

        if (!item) {
          throw new Error(`SKU ${id} tidak valid pada V4.`);
        }

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

        const type = String(item.vendor_moq_type ?? "");
        const color =
          type === "PER_COLOR"
            ? String(item.color ?? "").toUpperCase()
            : "SEMUA_WARNA";

        return {
          variant_id: item.variant_id,
          sku_snapshot: item.sku_master,
          product_code: item.product_code,
          color_snapshot: item.color ?? null,
          vendor_name_snapshot: item.vendor_name ?? null,
          moq_type: type || null,
          moq_quantity: item.vendor_moq_quantity ?? null,
          moq_group_key: JSON.stringify([
            item.product_code,
            item.vendor_name,
            type,
            color,
          ]),
          stock_normal_snapshot:
            item.v4_stock_normal_units ?? null,
          incoming_final_snapshot:
            item.v4_incoming_po_final_units ?? null,
          target_stock_snapshot:
            item.target_stock_position_units ?? null,
          net_need_snapshot:
            item.v4_net_need_before_moq ?? null,
          proposed_qty:
            edit.decision === "PROPOSE" ? edit.qty : 0,
          decision: edit.decision,
          source_policy: item.production_policy ?? null,

          // Belum lolos revalidasi approval di server.
          review_flag: "DRAFT_REQUIRES_REVALIDATION",

          review_notes: edit.notes || null,
        };
      });

      let id = batchId;

      if (!id) {
        const { data, error: insertError } = await db
          .from("wms_production_review_batches")
          .insert({
            source_version: "V4.1",
            lead_time_days: 30,
            review_days: 7,
            notes: notes || null,
          })
          .select("id")
          .single();

        if (insertError || !data) {
          throw new Error(
            insertError?.message || "Gagal membuat Draft."
          );
        }

        id = data.id;
        setBatchId(id);
      } else {
        const { data, error: updateError } = await db
          .from("wms_production_review_batches")
          .update({ notes: notes || null })
          .eq("id", id)
          .eq("status", "DRAFT")
          .select("id")
          .single();

        if (updateError || !data) {
          throw new Error(
            updateError?.message ||
            "Draft tidak dapat diedit."
          );
        }
      }

      if (!id) throw new Error("ID Draft tidak tersedia.");

      const lines = payload.map((row) => ({
        ...row,
        batch_id: id,
      }));

      for (let i = 0; i < lines.length; i += 100) {
        const { error: lineError } = await db
          .from("wms_production_review_lines")
          .upsert(lines.slice(i, i + 100), {
            onConflict: "batch_id,variant_id",
          });

        if (lineError) throw new Error(lineError.message);
      }

      const { data: existing, error: readError } = await db
        .from("wms_production_review_lines")
        .select("variant_id")
        .eq("batch_id", id)
        .range(0, 999);

      if (readError) throw new Error(readError.message);

      if ((existing ?? []).length >= 1000) {
        throw new Error(
          "Terlalu banyak baris Draft. Pemeriksaan diperlukan."
        );
      }

      const currentIds = new Set(
        payload.map((r) => r.variant_id)
      );

      const obsolete = (existing ?? [])
        .map((r) => String(r.variant_id))
        .filter((variantId) => !currentIds.has(variantId));

      for (let i = 0; i < obsolete.length; i += 100) {
        const { error: deleteError } = await db
          .from("wms_production_review_lines")
          .delete()
          .eq("batch_id", id)
          .in("variant_id", obsolete.slice(i, i + 100));

        if (deleteError) throw new Error(deleteError.message);
      }

      await refreshDrafts();
      setDirty(false);

      setMessage(
        `Draft berhasil disimpan: ${payload.length} SKU. ` +
        `Belum diajukan dan belum membuat PO.`
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gagal menyimpan Draft."
      );
      setMessage(
        "Penyimpanan perlu diperiksa. Muat kembali Draft sebelum mengulangi."
      );
    } finally {
      setSaving(false);
    }
  }

  async function openDraft(id: string) {
    if (!complete || saving || loading) return;

    setLoading(true);
    setError("");

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

      const { data: lines, error: lineError } = await db
        .from("wms_production_review_lines")
        .select(
          "variant_id,decision,proposed_qty,review_notes"
        )
        .eq("batch_id", id)
        .range(0, 999);

      if (lineError) throw new Error(lineError.message);

      const restored: Record<string, Edit> = {};
      const known = new Set(eligible.map((r) => r.variant_id));
      let unmatched = 0;

      for (const line of (lines ?? []) as SavedLine[]) {
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
      setNotes(batch.notes ?? "");
      setBatchId(id);
      setPage(0);
      setDirty(false);
      setPreflight(null);
      setReadiness(null);

      setMessage(
        `Draft dibuka: ${Object.keys(restored).length} SKU.`
      );

      if (unmatched > 0) {
        setError(
          `${unmatched} SKU Draft tidak cocok dengan preview V4 ` +
          "saat ini. Jangan ajukan approval."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuka Draft.");
    } finally {
      setLoading(false);
    }
  }

  const busy = loading || saving;

  return (
    <main className="w-full min-w-0 max-w-full overflow-x-hidden px-4 py-6 md:px-8">
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
                setEdits({});
                setNotes("");
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

            {batchId && (
              <span className="text-xs text-slate-500">
                Draft aktif: {batchId}
              </span>
            )}
          </div>

          <textarea
            rows={2}
            value={notes}
            disabled={busy}
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
              setPreflight(null);
            }}
            placeholder="Catatan umum review produksi..."
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveDraft}
              disabled={!complete || busy || selected.length === 0}
              className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Menyimpan..." : "Simpan Draft Review"}
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
                    "Catatan SKU"
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
                          disabled={busy}
                          onChange={(e) =>
                            changeDecision(r, e.target.value)
                          }
                          className="rounded-lg border border-slate-300 px-2 py-2"
                        >
                          <option value="">Belum Dipilih</option>
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
                          disabled={busy || edit?.decision !== "PROPOSE"}
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
                          disabled={busy || !edit}
                          onChange={(e) =>
                            updateEdit(r.variant_id, {
                              notes: e.target.value,
                            })
                          }
                          placeholder="Alasan revisi..."
                          className="w-48 rounded-lg border border-slate-300 px-2 py-2 disabled:bg-slate-100"
                        />
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

        <p className="text-xs text-slate-500">
          Simpan Draft menyimpan catatan dan usulan jumlah, bukan keputusan
          final. Seluruh angka harus direvalidasi server sebelum approval
          dan pembuatan PO. Saat ini belum ada transaksi stok atau PO.
        </p>
      </div>
    </main>
  );
}