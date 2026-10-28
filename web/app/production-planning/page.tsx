"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";
import { wmsToast } from "@/utils/wmsNotifications";
import { productionIsRestricted, productionPolicyLabel } from "./productionSafety";

type Num = number | string | null;

type PlanItem = {
  variant_id: string;
  sku_master: string;
  product_code: string;
  product_name: string;
  color: string | null;
  size: string | null;
  sold_7: Num;
  sold_30: Num;
  sold_90: Num;
  velocity_7: Num;
  velocity_30: Num;
  velocity_90: Num;
  forecast_daily: Num;
  abc_class: string;
  sales_trend: string;
  forecast_quality: string;
  safety_days: number;
  reorder_point_units: Num;
  target_stock_position_units: Num;
  planning_status: string;
  vendor_name?: string | null;
  vendor_review_status?: string | null;
  vendor_lead_time_days?: Num;
  effective_lead_time_days?: Num;
  lead_time_source?: string | null;
  vendor_lifecycle_status?: string | null;
  vendor_moq_type?: string | null;
  vendor_moq_quantity?: Num;
  moq_note?: string | null;
  production_policy?: string | null;
};

type Preview = {
  engine?: string;
  as_of_date: string;
  data_age_days: number;
  data_fresh: boolean;
  planning_mode: string;
  production_release_allowed: boolean;
  summary: {
    active_master_skus: Num;
    fashion_sales_units_90: Num;
    mapped_units_90: Num;
    unmapped_units_90: Num;
    mapped_coverage_percent: Num;
    classification_matches_v6: boolean;
  };
  items: PlanItem[];
};

const number = (value: Num | undefined) =>
  Number(value ?? 0);

const fmt = (value: Num | undefined) =>
  new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 2
  }).format(number(value));

const trendName: Record<string, string> = {
  RISING: "Naik",
  STABLE: "Stabil",
  DECLINING: "Turun",
  NO_RECENT_SALES: "Tidak ada penjualan baru"
};

const trendColor: Record<string, string> = {
  RISING: "bg-emerald-50 text-emerald-700",
  STABLE: "bg-blue-50 text-blue-700",
  DECLINING: "bg-amber-50 text-amber-700",
  NO_RECENT_SALES: "bg-slate-100 text-slate-600"
};

function formatVendorMoq(item: PlanItem): string {
  if (item.lead_time_source !== "VERIFIED_VENDOR") {
    return "Belum Verified";
  }

  if (item.vendor_moq_type === "PER_PRODUCT") {
    return String(number(item.vendor_moq_quantity)) + " pcs / model";
  }
  if (item.vendor_moq_type === "PER_COLOR") {
    return String(number(item.vendor_moq_quantity)) + " pcs / warna";
  }
  if (item.vendor_moq_type === "BY_REQUEST") {
    return "By Request";
  }
  return "Belum ditentukan";
}
export default function ProductionPlanningPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [leadDraft, setLeadDraft] = useState(30);
  const [reviewDraft, setReviewDraft] = useState(7);
  const [parameters, setParameters] = useState({
    lead: 30,
    review: 7
  });

  const [simulationRunId, setSimulationRunId] = useState(0);
  const [report, setReport] = useState<Preview | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState("");
  const [abcFilter, setAbcFilter] = useState("ALL");
  const [trendFilter, setTrendFilter] = useState("ALL");
  const [qualityFilter, setQualityFilter] = useState("ALL");
  const [vendorFilter, setVendorFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("priority");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      setErrorMessage("");

      try {
        const { data: auth, error: authError } =
          await supabase.auth.getUser();

        if (authError) throw authError;

        if (!auth.user) {
          router.replace("/login");
          return;
        }

        const { data: profile, error: profileError } =
          await supabase
            .from("profiles")
            .select("role, is_active")
            .eq("id", auth.user.id)
            .single();

        if (profileError) throw profileError;

        if (!profile?.is_active) {
          throw new Error("Akun WMS tidak aktif.");
        }

        if (!["owner", "admin", "warehouse_manager"]
          .includes(String(profile.role))) {
          throw new Error(
            "Akses Production Planning belum diberikan."
          );
        }

        const fetched: PlanItem[] = [];
        let initialReport: Preview | null = null;
        let expected = 0;

        // Semua SKU diambil secara bertahap dari RPC
        // supaya filter dan sorting mencakup semua SKU.
        for (let offset = 0; offset < 10000; offset += 200) {
          const { data, error } = await supabase.rpc(
            "get_fashion_production_preview_v2",
            {
              p_lead_time_days: parameters.lead,
              p_review_days: parameters.review,
              p_limit: 200,
              p_offset: offset
            }
          );

          if (error) throw error;

          const result = data as unknown as Preview;

          if (!result || !Array.isArray(result.items)) {
            throw new Error("Format RPC Planning tidak valid.");
          }

          if (
            result.engine !== "weekly_smart_replenishment_v2" ||
            result.planning_mode !== "DRAFT_ONLY" ||
            result.production_release_allowed !== false
          ) {
            throw new Error("Simulation Engine V2 belum valid atau belum aman.");
          }
          if (!initialReport) {
            initialReport = result;
            expected = number(
              result.summary?.active_master_skus
            );

            if (expected < 0 || expected > 10000) {
              throw new Error("Jumlah SKU tidak wajar.");
            }

            if (
              !result.summary.classification_matches_v6
            ) {
              throw new Error(
                "Klasifikasi berbeda dengan Sales V6."
              );
            }
          }

          fetched.push(...result.items);

          if (fetched.length >= expected) break;

          if (result.items.length === 0) {
            throw new Error(
              "Data pagination tidak lengkap."
            );
          }

          if (cancelled) return;
        }

        if (fetched.length !== expected) {
          throw new Error(
            "Jumlah SKU yang diterima tidak sesuai."
          );
        }

        if (!cancelled) {
          setReport(initialReport);
          setItems(fetched);
          setCurrentPage(1);
          if (simulationRunId > 0) {
            wmsToast.success(
              "Simulasi berhasil",
              fetched.length.toLocaleString("id-ID") +
                " SKU selesai dihitung. Hasil masih Draft; stok dan PO tidak berubah."
            );
          }
        }
      } catch (error) {
        if (!cancelled) {
          if (simulationRunId > 0) {
            wmsToast.error(
              "Simulasi gagal",
              error instanceof Error
                ? error.message
                : "Data simulasi gagal dimuat."
            );
          }
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Gagal memuat Production Planning."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [supabase, router, parameters, simulationRunId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    const rows = items.filter(item => {
      const keyword = [
        item.sku_master,
        item.product_name,
        item.product_code,
        item.color ?? "",
        item.size ?? ""
      ].join(" ").toLowerCase();

      return (
        (!q || keyword.includes(q)) &&
        (abcFilter === "ALL" ||
          item.abc_class === abcFilter) &&
        (trendFilter === "ALL" ||
          item.sales_trend === trendFilter) &&
        (qualityFilter === "ALL" ||
          item.forecast_quality === qualityFilter) &&
        (vendorFilter === "ALL" ||
          (vendorFilter === "VERIFIED_VENDOR" &&
            item.lead_time_source === "VERIFIED_VENDOR") ||
          (vendorFilter === "DEFAULT_ASSUMPTION" &&
            item.lead_time_source !== "VERIFIED_VENDOR") ||
          item.production_policy === vendorFilter)
      );
    });

    const abcOrder: Record<string, number> = {
      A: 0, B: 1, C: 2
    };

    const trendOrder: Record<string, number> = {
      RISING: 0,
      STABLE: 1,
      DECLINING: 2,
      NO_RECENT_SALES: 3
    };

    return rows.sort((a, b) => {
      if (sortBy === "sales30") {
        return number(b.sold_30) - number(a.sold_30);
      }
      if (sortBy === "forecast") {
        return number(b.forecast_daily) -
          number(a.forecast_daily);
      }
      if (sortBy === "target") {
        return number(b.target_stock_position_units) -
          number(a.target_stock_position_units);
      }
      if (sortBy === "sku") {
        return a.sku_master.localeCompare(b.sku_master);
      }

      return (
        (abcOrder[a.abc_class] ?? 9) -
          (abcOrder[b.abc_class] ?? 9) ||
        (trendOrder[a.sales_trend] ?? 9) -
          (trendOrder[b.sales_trend] ?? 9) ||
        number(b.sold_30) - number(a.sold_30)
      );
    });
  }, [
    items, search, abcFilter,
    trendFilter, qualityFilter, vendorFilter, sortBy
  ]);

  const pageSize = 25;
  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / pageSize)
  );
  const safePage = Math.min(currentPage, totalPages);
  const rows = filtered.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const topA = items.filter(x =>
    x.abc_class === "A"
  ).length;

  const rising = items.filter(x =>
    x.sales_trend === "RISING"
  ).length;

  const limited = items.filter(x =>
    x.forecast_quality !== "NORMAL"
  ).length;

  function applySimulation() {
    if (
      !Number.isInteger(leadDraft) ||
      leadDraft < 1 || leadDraft > 180 ||
      !Number.isInteger(reviewDraft) ||
      reviewDraft < 1 || reviewDraft > 60
    ) {
      setErrorMessage(
        "Lead time harus 1–180 hari dan review 1–60 hari."
      );
      return;
    }

    setParameters({
      lead: leadDraft,
      review: reviewDraft
    });
    setSimulationRunId((id) => id + 1);
  }

  async function exportExcel() {
    if (!report || loading || exporting || filtered.length === 0) {
      return;
    }

    setExporting(true);
    setErrorMessage("");

    try {
      const { exportProductionExcel } =
        await import("./exportExcel");

      await exportProductionExcel({
        rows: filtered,
        asOfDate: report.as_of_date,
        leadDays: parameters.lead,
        reviewDays: parameters.review,
        mappingPercent: number(
          report.summary.mapped_coverage_percent
        ),
        unmappedUnits: number(
          report.summary.unmapped_units_90
        )
      });
    } catch (error) {
      setErrorMessage(
        "Export Excel gagal: " +
        (error instanceof Error ? error.message : String(error))
      );
    } finally {
      setExporting(false);
    }
  }

  const field =
    "w-full rounded-xl border border-slate-300 " +
    "bg-white px-3 py-2.5 text-sm outline-none " +
    "focus:border-slate-800";

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />

        <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-8">
          <div className="mx-auto w-full min-w-0 max-w-[1500px] space-y-6">

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Hi.PRIMA WMS
                </div>
                <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
                  Production Planning
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                  Weekly Smart Replenishment · Fashion
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-xl bg-amber-100 px-4 py-2.5 text-sm font-semibold text-amber-900">
                  Simulation / Draft
                </span>
              </div>
            </div>

            {errorMessage && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {errorMessage}
              </div>
            )}

            {loading && (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600">
                Memuat dan menghitung seluruh SKU...
              </div>
            )}

            {report && !loading && (
              <>
                {!report.data_fresh && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <strong>Data belum terkini.</strong>{" "}
                    Data penjualan terakhir{" "}
                    {report.as_of_date} (
                    {report.data_age_days} hari lalu).
                    Perbarui impor iSeller sebelum membuat
                    keputusan produksi aktual.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {[
                    [
                      "SKU Aktif",
                      fmt(report.summary.active_master_skus)
                    ],
                    [
                      "ABC Kelas A",
                      fmt(topA)
                    ],
                    [
                      "Tren Naik",
                      fmt(rising)
                    ],
                    [
                      "Forecast Perlu Review",
                      fmt(limited)
                    ],
                    [
                      "SKU Vendor Verified",
                      fmt(items.filter(x =>
                        x.lead_time_source === "VERIFIED_VENDOR"
                      ).length)
                    ],
                    [
                      "SKU Lead Time Asumsi",
                      fmt(items.filter(x =>
                        x.lead_time_source !== "VERIFIED_VENDOR"
                      ).length)
                    ],
                    [
                      "SKU Produksi Diblokir",
                      fmt(items.filter(x =>
                        ["BLOCKED_HOLD", "BLOCKED_DISCONTINUE"]
                          .includes(x.production_policy ?? "")
                      ).length)
                    ]
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <div className="text-xs text-slate-500">
                        {label}
                      </div>
                      <div className="mt-2 text-2xl font-bold">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="text-sm font-semibold">
                      Kelengkapan Mapping Penjualan
                    </div>
                    <div className="mt-3 text-2xl font-bold">
                      {fmt(report.summary.mapped_coverage_percent)}%
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-slate-800"
                        style={{
                          width:
                            Math.min(100,
                              number(report.summary.mapped_coverage_percent)
                            ) + "%"
                        }}
                      />
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      {fmt(report.summary.mapped_units_90)}
                      {" / "}
                      {fmt(report.summary.fashion_sales_units_90)}
                      {" unit terhubung ke Master."}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <div className="text-sm font-semibold text-amber-900">
                      Belum Terhubung ke Master
                    </div>
                    <div className="mt-3 text-2xl font-bold text-amber-900">
                      {fmt(report.summary.unmapped_units_90)} pcs
                    </div>
                    <p className="mt-2 text-xs text-amber-800">
                      Tetap tercatat sebagai gap.
                      Tidak dimasukkan ke rekomendasi
                      produksi per varian.
                    </p>
                  </div>
                </div>

                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h2 className="font-semibold">
                    Parameter Simulasi
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Ubah parameter, lalu jalankan simulasi.
                    Tidak ada PO atau stok yang diubah.
                  </p>

                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <label className="min-w-[145px] flex-1 space-y-1">
                      <span className="text-xs font-medium text-slate-600">
                        Lead Time Cadangan (hari)
                    <span className="mt-1 block text-[11px] font-normal text-slate-500">
                      Hanya untuk SKU tanpa vendor Verified
                    </span>
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={leadDraft}
                        onChange={e =>
                          setLeadDraft(Number(e.target.value))
                        }
                        className={field}
                      />
                    </label>

                    <label className="min-w-[145px] flex-1 space-y-1">
                      <span className="text-xs font-medium text-slate-600">
                        Siklus Review Produksi (hari)
                    <span className="mt-1 block text-[11px] font-normal text-slate-500">
                      Interval evaluasi kebutuhan produksi ulang
                    </span>
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={reviewDraft}
                        onChange={e =>
                          setReviewDraft(Number(e.target.value))
                        }
                        className={field}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={applySimulation}
                      disabled={loading}
                      className="shrink-0 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      Jalankan Simulasi
                    </button>

                    <button
                      type="button"
                      onClick={() => void exportExcel()}
                      disabled={loading || exporting || !report || filtered.length === 0}
                      className="shrink-0 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                    >
                      {exporting ? "Menyiapkan Excel..." : "Export Excel"}
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white">
                  <div className="space-y-4 border-b border-slate-200 p-5">
                    <div>
                      <h2 className="text-lg font-semibold">
                        SKU Production Simulation
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        Target posisi stok belum merupakan
                        jumlah produksi. Stok fisik dan
                        incoming belum direkonsiliasi.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                      <input
                        type="search"
                        value={search}
                        onChange={e => {
                          setSearch(e.target.value);
                          setCurrentPage(1);
                        }}
                        placeholder="Cari SKU / produk / warna..."
                        className={field}
                      />

                      <select
                        value={abcFilter}
                        className={field}
                        onChange={e => {
                          setAbcFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                      >
                        <option value="ALL">Semua ABC</option>
                        <option value="A">Kelas A</option>
                        <option value="B">Kelas B</option>
                        <option value="C">Kelas C</option>
                      </select>

                      <select
                        value={trendFilter}
                        className={field}
                        onChange={e => {
                          setTrendFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                      >
                        <option value="ALL">Semua Tren</option>
                        <option value="RISING">Naik</option>
                        <option value="STABLE">Stabil</option>
                        <option value="DECLINING">Turun</option>
                        <option value="NO_RECENT_SALES">
                          Tidak Ada Penjualan Baru
                        </option>
                      </select>

                      <select
                        value={qualityFilter}
                        className={field}
                        onChange={e => {
                          setQualityFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                      >
                        <option value="ALL">Semua Kualitas</option>
                        <option value="NORMAL">Normal</option>
                        <option value="LOW_VOLUME">
                          Volume Rendah
                        </option>
                        <option value="LIMITED_HISTORY">
                          Histori Terbatas
                        </option>
                      </select>

                      <select
                        value={vendorFilter}
                        className={field}
                        onChange={e => {
                          setVendorFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                      >
                        <option value="ALL">Semua Status Vendor</option>
                        <option value="VERIFIED_VENDOR">Vendor Verified</option>
                        <option value="DEFAULT_ASSUMPTION">Lead Time Asumsi</option>
                        <option value="BLOCKED_HOLD">Hold - Blocked</option>
                        <option value="BLOCKED_DISCONTINUE">Discontinue - Blocked</option>
                        <option value="SEASONAL_APPROVAL_REQUIRED">Seasonal - Approval</option>
                        <option value="ACTIVE_SIMULATION_ONLY">On Produksi</option>
                      </select>
                      <select
                        value={sortBy}
                        className={field}
                        onChange={e => setSortBy(e.target.value)}
                      >
                        <option value="priority">Prioritas ABC</option>
                        <option value="sales30">Terlaris 30 Hari</option>
                        <option value="forecast">Forecast Tertinggi</option>
                        <option value="target">Target Stok Tertinggi</option>
                        <option value="sku">SKU A–Z</option>
                      </select>
                    </div>
                  </div>

                  <div className="w-full max-w-full overflow-x-auto">
                    <table className="min-w-[1680px] w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          {[
                            "SKU Master",
                            "Vendor",
                            "Lead Time",
                            "Lifecycle / Kebijakan",
                            "MOQ",
                            "ABC",
                            "Tren",
                            "7 Hari",
                            "30 Hari",
                            "90 Hari",
                            "Forecast/Hari",
                            "Safety",
                            "Reorder Point",
                            "Target Posisi Stok",
                            "Kualitas"
                          ].map(h => (
                            <th
                              key={h}
                              className="whitespace-nowrap px-4 py-3 font-semibold"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {rows.map(item => (
                          <tr key={item.variant_id}
                              className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <div className="font-semibold">
                                {item.sku_master}
                              </div>
                              <div className="mt-1 max-w-[260px] text-slate-500">
                                {item.product_name}
                              </div>
                              <div className="mt-1 text-slate-400">
                                {item.color ?? "-"} / {item.size ?? "-"}
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              <div className="font-semibold">
                                {item.vendor_name ?? "Belum Verified"}
                              </div>
                              <div className="mt-1 text-slate-500">
                                {item.vendor_review_status ?? "Perlu review"}
                              </div>
                            </td>

                            <td className="px-4 py-3 tabular-nums">
                              <div className="font-semibold">
                                {fmt(item.effective_lead_time_days)} hari
                              </div>
                              <div className={
                                "mt-1 text-[11px] " +
                                (item.lead_time_source === "VERIFIED_VENDOR"
                                  ? "text-emerald-700"
                                  : "text-amber-700")
                              }>
                                {item.lead_time_source === "VERIFIED_VENDOR"
                                  ? "Vendor Verified"
                                  : "Asumsi"}
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              <div className="font-semibold">
                                {item.vendor_lifecycle_status ?? "Perlu review"}
                              </div>
                              <div className={
                                "mt-1 text-[11px] " +
                                (["BLOCKED_HOLD", "BLOCKED_DISCONTINUE"]
                                  .includes(item.production_policy ?? "")
                                  ? "text-red-700"
                                  : "text-slate-500")
                              }>
                                {productionPolicyLabel(item)}
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              {formatVendorMoq(item)}
                            </td>
                            <td className="px-4 py-3">
                              <span className={
                                "rounded-lg px-2 py-1 font-bold " +
                                (item.abc_class === "A"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : item.abc_class === "B"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-slate-100 text-slate-600")
                              }>
                                {item.abc_class}
                              </span>
                            </td>

                            <td className="px-4 py-3">
                              <span className={
                                "whitespace-nowrap rounded-lg px-2 py-1 " +
                                (trendColor[item.sales_trend] ??
                                  "bg-slate-100 text-slate-600")
                              }>
                                {trendName[item.sales_trend] ??
                                  item.sales_trend}
                              </span>
                            </td>

                            <td className="px-4 py-3 tabular-nums">
                              {fmt(item.sold_7)}
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {fmt(item.sold_30)}
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {fmt(item.sold_90)}
                            </td>
                            <td className="px-4 py-3 font-semibold tabular-nums">
                              {fmt(item.forecast_daily)}
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {item.safety_days} hari
                            </td>
                            <td className="px-4 py-3 font-medium tabular-nums">
                              {productionIsRestricted(item) ? "—" : fmt(item.reorder_point_units)}
                            </td>
                            <td className="px-4 py-3 font-semibold tabular-nums">
                              {productionIsRestricted(item) ? "—" : fmt(item.target_stock_position_units)}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {item.forecast_quality === "NORMAL"
                                ? "Normal"
                                : item.forecast_quality === "LOW_VOLUME"
                                  ? "Volume rendah"
                                  : "Histori terbatas"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {filtered.length === 0 && (
                      <div className="p-8 text-center text-sm text-slate-500">
                        Tidak ada SKU sesuai filter.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4">
                    <div className="text-xs text-slate-500">
                      {fmt(filtered.length)} SKU ditemukan ·
                      halaman {safePage} dari {totalPages}
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={safePage <= 1}
                        onClick={() => setCurrentPage(
                          Math.max(1, safePage - 1)
                        )}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={safePage >= totalPages}
                        onClick={() => setCurrentPage(
                          Math.min(totalPages, safePage + 1)
                        )}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </section>

                <p className="pb-4 text-xs text-slate-500">
                  Forecast menggunakan pembobotan 7/30/90 hari
                  dan safety stock heuristik ABC/tren.
                  Angka ini adalah simulasi, bukan prediksi
                  terjamin atau instruksi produksi final.
                  Pembaruan stok dan PO dinonaktifkan.
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
