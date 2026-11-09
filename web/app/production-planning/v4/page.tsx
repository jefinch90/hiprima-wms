"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

type PlanningRow = {
  variant_id?: string;
  sku_master?: string;
  product_name?: string;
  vendor_name?: string;
  production_policy?: string;
  v4_status?: string;
  v4_stock_normal_units?: number | null;
  v4_incoming_po_final_units?: number | null;
  target_stock_position_units?: number | null;
  v4_net_need_before_moq?: number | null;
  effective_lead_time_days?: number | null;
  vendor_moq_quantity?: number | null;
  vendor_moq_type?: string;
};

const format = (value: unknown) => {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("id-ID", {
        maximumFractionDigits: 2,
      }).format(n);
};

const numberValue = (value: unknown) => {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n)
    ? 0
    : n;
};

export default function SmartPlanningV4Page() {
  const [rows, setRows] = useState<PlanningRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [leadTime, setLeadTime] = useState(30);
  const [reviewDays, setReviewDays] = useState(7);

  async function runSimulation() {
    if (busy) return;

    if (
      !Number.isInteger(leadTime) ||
      leadTime < 1 ||
      leadTime > 365 ||
      !Number.isInteger(reviewDays) ||
      reviewDays < 1 ||
      reviewDays > 90
    ) {
      setError("Parameter lead time atau review tidak valid.");
      return;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      setError("Konfigurasi public Supabase belum ditemukan.");
      return;
    }

    setBusy(true);
    setComplete(false);
    setRows([]);
    setError("");
    setProgress("Memulai pembacaan data V4...");

    try {
      const client = createClient();

      // Gunakan sesi login WMS yang sudah aktif.
      const { data: authData, error: authError } =
        await client.auth.getUser();

      if (authError || !authData.user) {
        throw new Error(
          "Sesi login WMS tidak aktif. Login kembali, lalu ulangi simulasi."
        );
      }
      const collected: PlanningRow[] = [];
      const seen = new Set<string>();
      const pageSize = 100;
      let finished = false;

      for (let page = 0; page < 20; page++) {
        const offset = page * pageSize;

        const { data, error: rpcError } = await client.rpc(
          "get_fashion_production_preview_v4",
          {
            p_lead_time_days: leadTime,
            p_review_days: reviewDays,
            p_limit: pageSize,
            p_offset: offset,
          }
        );

        if (rpcError) throw new Error(rpcError.message);

        if (!Array.isArray(data)) {
          throw new Error("Format response V4 tidak sesuai.");
        }

        const chunk = data as PlanningRow[];

        if (chunk.length === 0) {
          finished = true;
          break;
        }

        for (let i = 0; i < chunk.length; i++) {
          const item = chunk[i];
          const key = String(
            item.variant_id || item.sku_master || `row-${offset + i}`
          );

          if (seen.has(key)) {
            throw new Error(
              `SKU duplikat pada pagination: ${key}. Data belum lengkap.`
            );
          }

          seen.add(key);
          collected.push(item);
        }

        setRows([...collected]);
        setProgress(`${collected.length} SKU berhasil dibaca...`);

        if (chunk.length < pageSize) {
          finished = true;
          break;
        }
      }

      if (!finished) {
        throw new Error(
          "Batas pengambilan tercapai. Periksa pagination sebelum memakai hasil."
        );
      }

      setComplete(true);
      setProgress(
        `${collected.length} SKU selesai diproses. Hasil simulasi, bukan PO.`
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gagal mengambil data V4."
      );
      setProgress("Data belum lengkap. Jangan digunakan untuk membuat PO.");
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => {
    return {
      total: rows.length,
      calculated: rows.filter(
        (r) => r.v4_status === "SIMULATION_ONLY"
      ).length,
      review: rows.filter(
        (r) => r.v4_status !== "SIMULATION_ONLY"
      ).length,
      incoming: rows.reduce(
        (sum, r) => sum + numberValue(r.v4_incoming_po_final_units),
        0
      ),
      stock: rows.reduce(
        (sum, r) => sum + numberValue(r.v4_stock_normal_units),
        0
      ),
      netNeed: rows.reduce(
        (sum, r) => sum + numberValue(r.v4_net_need_before_moq),
        0
      ),
    };
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((r) => {
      const matchText =
        !q ||
        [r.sku_master, r.product_name, r.vendor_name]
          .some((v) => String(v || "").toLowerCase().includes(q));

      const matchFilter =
        filter === "ALL" ||
        (filter === "READY" && r.v4_status === "SIMULATION_ONLY") ||
        (filter === "REVIEW" && r.v4_status !== "SIMULATION_ONLY") ||
        (filter === "INCOMING" &&
          numberValue(r.v4_incoming_po_final_units) > 0);

      return matchText && matchFilter;
    });
  }, [rows, search, filter]);

  return (
    <main className="min-w-0 w-full max-w-full overflow-x-hidden px-4 py-6 md:px-8">
      <div className="mx-auto flex max-w-[1600px] min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500">
              HI.PRIMA WMS / PRODUCTION PLANNING
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">
              Smart Production Planning V4
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Perhitungan stok normal, incoming PO Final dan kebutuhan produksi bersih.
            </p>
          </div>
          <Link
            href="/production-planning/"
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800"
          >
            Kembali ke Planning V2
          </Link>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>MODE SIMULASI — BUKAN PO.</strong>{" "}
          Data penjualan mengikuti snapshot Production Planning V2.
          SKU bermasalah harus direview. MOQ per model/vendor belum diterapkan
          pada angka kebutuhan bersih. Tidak ada perubahan stok maupun PO.
        </div>

        <div className="flex min-w-0 flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="flex min-w-[145px] flex-col gap-1 text-sm">
            <span>Lead Time Cadangan</span>
            <input
              type="number"
              min={1}
              max={365}
              value={leadTime}
              disabled={busy}
              onChange={(e) => setLeadTime(Number(e.target.value))}
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex min-w-[145px] flex-col gap-1 text-sm">
            <span>Siklus Review (hari)</span>
            <input
              type="number"
              min={1}
              max={90}
              value={reviewDays}
              disabled={busy}
              onChange={(e) => setReviewDays(Number(e.target.value))}
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={runSimulation}
            disabled={busy}
            className="shrink-0 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Memproses..." : "Jalankan Simulasi V4"}
          </button>
        </div>

        {progress && (
          <p className="text-sm text-slate-600" role="status">
            {progress}
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {[
            ["SKU Dibaca", summary.total],
            ["Simulasi Valid", summary.calculated],
            ["Perlu Review", summary.review],
            ["Incoming pada SKU Dibaca", `${format(summary.incoming)} pcs`],
            ["Kebutuhan Bersih (Pra-MOQ)", `${format(summary.netNeed)} pcs`],
          ].map(([label, value]) => (
            <div key={String(label)} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-2 break-words text-xl font-bold text-slate-900">
                {value}
              </p>
            </div>
          ))}
        </div>

        <div className="min-w-0 rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <h2 className="font-bold text-slate-900">
                Detail Kebutuhan Produksi
              </h2>
              <p className="text-xs text-slate-500">
                {visible.length} SKU tampil.{" "}
                {complete
                  ? "Seluruh halaman preview telah dibaca."
                  : "Data belum lengkap."}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari SKU, produk, vendor"
                className="min-w-0 max-w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="ALL">Semua Status</option>
                <option value="READY">Simulasi Valid</option>
                <option value="REVIEW">Perlu Review</option>
                <option value="INCOMING">Ada Incoming</option>
              </select>
            </div>
          </div>

          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[1320px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {[
                    "SKU / Produk", "Vendor", "Stok Normal",
                    "Incoming Final", "Posisi Stok", "Target",
                    "Kebutuhan Bersih", "MOQ Vendor", "Status"
                  ].map((label) => (
                    <th key={label} className="whitespace-nowrap border-b border-slate-200 px-3 py-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r, index) => (
                  <tr key={`${r.variant_id || r.sku_master}-${index}`} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-900">
                        {r.sku_master || "Tanpa SKU"}
                      </p>
                      <p className="mt-1 max-w-[230px] text-xs text-slate-500">
                        {r.product_name || "—"}
                      </p>
                    </td>
                    <td className="px-3 py-3">{r.vendor_name || "Belum Verified"}</td>
                    <td className="px-3 py-3">{format(r.v4_stock_normal_units)}</td>
                    <td className="px-3 py-3 font-semibold">{format(r.v4_incoming_po_final_units)}</td>
                    <td className="px-3 py-3">
                      {r.v4_stock_normal_units == null ||
                       r.v4_incoming_po_final_units == null
                        ? "—"
                        : format(
                            numberValue(r.v4_stock_normal_units) +
                            numberValue(r.v4_incoming_po_final_units)
                          )}
                    </td>
                    <td className="px-3 py-3">{format(r.target_stock_position_units)}</td>
                    <td className="px-3 py-3 font-bold">
                      {format(r.v4_net_need_before_moq)}
                    </td>
                    <td className="px-3 py-3">
                      {format(r.vendor_moq_quantity)}
                      <p className="text-xs text-slate-500">{r.vendor_moq_type || ""}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={
                        r.v4_status === "SIMULATION_ONLY"
                          ? "font-medium text-emerald-700"
                          : "font-medium text-amber-700"
                      }>
                        {r.v4_status === "SIMULATION_ONLY"
                          ? "Simulasi Valid"
                          : r.v4_status || "Perlu Review"}
                      </span>
                      <p className="mt-1 text-xs text-slate-500">
                        {r.production_policy || ""}
                      </p>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      {rows.length === 0
                        ? "Jalankan simulasi untuk membaca data."
                        : "Tidak ada SKU sesuai filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Ringkasan hanya mencakup SKU yang berhasil dibaca pada simulasi ini.
          Jumlah kebutuhan bersih belum dibulatkan mengikuti MOQ.
          Tidak ada fungsi Create PO atau Finalisasi PO pada halaman ini.
        </p>
      </div>
    </main>
  );
}