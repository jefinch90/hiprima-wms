"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type ValuationSummary = {
  normal_qty: number | string | null;
  defect_qty: number | string | null;
  reject_qty: number | string | null;
  total_qty: number | string | null;

  normal_inventory_value_hpp: number | string | null;
  defect_inventory_value_hpp: number | string | null;
  reject_inventory_value_hpp: number | string | null;
  total_inventory_value_hpp: number | string | null;

  potential_sales_value: number | string | null;
  potential_gross_profit: number | string | null;
  margin_pct: number | string | null;
};

export default function Home() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [productsCount, setProductsCount] = useState(0);
  const [variantsCount, setVariantsCount] = useState(0);
  const [warehousesCount, setWarehousesCount] = useState(0);
  const [stockAreasCount, setStockAreasCount] = useState(0);

  const [normalStock, setNormalStock] = useState(0);
  const [defectStock, setDefectStock] = useState(0);
  const [rejectStock, setRejectStock] = useState(0);

  const [valuation, setValuation] =
    useState<ValuationSummary | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login");
      return;
    }

    const [
      valuationResult,
      productsResult,
      variantsResult,
      warehousesResult,
      stockAreasResult,
    ] = await Promise.all([
      supabase.rpc("wms_valuation_by_warehouse", { p_warehouse_id: null }),

      supabase
        .from("products")
        .select("id", {
          count: "exact",
          head: true,
        }),

      supabase
        .from("product_variants")
        .select("id", {
          count: "exact",
          head: true,
        }),

      supabase
        .from("warehouses")
        .select("id", {
          count: "exact",
          head: true,
        }),

      supabase
        .from("stock_areas")
        .select("id", {
          count: "exact",
          head: true,
        }),
    ]);

    if (valuationResult.error) {
      setErrorMessage(
        `Valuation error: ${valuationResult.error.message}`
      );
      setLoading(false);
      return;
    }

    if (productsResult.error) {
      setErrorMessage(
        `Products error: ${productsResult.error.message}`
      );
      setLoading(false);
      return;
    }

    if (variantsResult.error) {
      setErrorMessage(
        `Variants error: ${variantsResult.error.message}`
      );
      setLoading(false);
      return;
    }

    if (warehousesResult.error) {
      setErrorMessage(
        `Warehouse error: ${warehousesResult.error.message}`
      );
      setLoading(false);
      return;
    }

    if (stockAreasResult.error) {
      setErrorMessage(
        `Stock area master error: ${stockAreasResult.error.message}`
      );
      setLoading(false);
      return;
    }

    const summaryRows =
      (valuationResult.data ?? []) as ValuationSummary[];

    const summary = summaryRows[0];

    if (!summary) {
      setErrorMessage("Ringkasan inventory tidak tersedia.");
      setLoading(false);
      return;
    }

    const normal = Number(summary.normal_qty ?? 0);
    const defect = Number(summary.defect_qty ?? 0);
    const reject = Number(summary.reject_qty ?? 0);
    const total = Number(summary.total_qty ?? 0);

    if (
      ![normal, defect, reject, total].every(
        n => Number.isSafeInteger(n) && n >= 0
      ) ||
      normal + defect + reject !== total
    ) {
      setErrorMessage("Rekonsiliasi jumlah inventory tidak sesuai.");
      setLoading(false);
      return;
    }

    setValuation(summary);
    setNormalStock(normal);
    setDefectStock(defect);
    setRejectStock(reject);

    setProductsCount(
      Number(productsResult.count ?? 0)
    );

    setVariantsCount(
      Number(variantsResult.count ?? 0)
    );

    setWarehousesCount(
      Number(warehousesResult.count ?? 0)
    );

    setStockAreasCount(
      Number(stockAreasResult.count ?? 0)
    );

    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const totalStock =
    normalStock +
    defectStock +
    rejectStock;

  const formatNumber = (
    value: number | string | null | undefined
  ) =>
    Number(value ?? 0).toLocaleString("id-ID");

  const formatRupiah = (
    value: number | string | null | undefined
  ) =>
    `Rp ${Number(value ?? 0).toLocaleString("id-ID")}`;

  const formatPercent = (
    value: number | string | null | undefined
  ) => {
    if (
      value === null ||
      value === undefined
    ) {
      return "-";
    }

    return `${Number(value).toLocaleString(
      "id-ID",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    )}%`;
  };

  const totalInventoryValue =
    Number(
      valuation?.total_inventory_value_hpp ?? 0
    );

  const normalInventoryValue =
    Number(
      valuation?.normal_inventory_value_hpp ?? 0
    );

  const defectInventoryValue =
    Number(
      valuation?.defect_inventory_value_hpp ?? 0
    );

  const rejectInventoryValue =
    Number(
      valuation?.reject_inventory_value_hpp ?? 0
    );

  const potentialSales =
    Number(
      valuation?.potential_sales_value ?? 0
    );

  const potentialGrossProfit =
    Number(
      valuation?.potential_gross_profit ?? 0
    );

  const margin =
    valuation?.margin_pct == null
      ? null
      : Number(valuation.margin_pct);

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">
          <div className="mx-auto w-full min-w-0 max-w-[1400px]">

            {/* HEADER */}
            <header data-hp-hero="dashboard" className="mb-8">
              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <h1 className="mt-1 text-3xl font-bold">
                Warehouse Dashboard
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Monitoring stok Hi.PRIMA • Live Database
              </p>
            </header>

            {/* ERROR */}
            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
                {errorMessage}
              </div>
            )}

            {/* STOCK SUMMARY */}
            <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

              <div data-hp-kpi="total" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                  Total Stock
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {formatNumber(totalStock)}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Normal + Defect + Reject
                </p>
              </div>

              <div data-hp-kpi="normal" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                  Normal
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {formatNumber(normalStock)}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Siap Jual
                </p>
              </div>

              <div data-hp-kpi="defect" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                  Defect
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {formatNumber(defectStock)}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Perlu pengecekan
                </p>
              </div>

              <div data-hp-kpi="reject" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                  Reject
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {formatNumber(rejectStock)}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Stok reject
                </p>
              </div>

            </section>
            {/* HIPRIMA V3 STOCK QUALITY CHART */}
            {!loading && !errorMessage && (
              <section className="hp-stock-quality mb-8">
                <div className="hp-quality-heading">
                  <div>
                    <p className="hp-eyebrow">
                      INVENTORY HEALTH
                    </p>
                    <h2>Stock Quality Composition</h2>
                    <p>
                      Distribusi stok berdasarkan kondisi QC
                    </p>
                  </div>
                  <span className="hp-live-chip">
                    Live Inventory
                  </span>
                </div>

                <div className="hp-quality-body">
                  <div
                    className="hp-quality-donut"
                    role="img"
                    aria-label={
                      "Komposisi stok: Normal "+
                      formatNumber(normalStock)+
                      ", Defect "+
                      formatNumber(defectStock)+
                      ", Reject "+
                      formatNumber(rejectStock)
                    }
                    style={{
                      background: totalStock > 0
                        ? "conic-gradient(#0d9488 0% "+
                          (normalStock/totalStock*100)+
                          "%, #f59e0b "+
                          (normalStock/totalStock*100)+
                          "% "+
                          ((normalStock+defectStock)/
                            totalStock*100)+
                          "%, #dc4664 "+
                          ((normalStock+defectStock)/
                            totalStock*100)+
                          "% 100%)"
                        : "#e5e7eb"
                    }}
                  >
                    <div className="hp-donut-center">
                      <strong>
                        {totalStock > 0
                          ? (normalStock/totalStock*100)
                            .toLocaleString("id-ID",{
                              maximumFractionDigits:1
                            })+"%"
                          : "-"}
                      </strong>
                      <span>Normal Stock</span>
                    </div>
                  </div>

                  <div className="hp-quality-legend">
                    {[
                      {
                        label:"Normal",
                        value:normalStock,
                        color:"#0d9488"
                      },
                      {
                        label:"Defect",
                        value:defectStock,
                        color:"#f59e0b"
                      },
                      {
                        label:"Reject",
                        value:rejectStock,
                        color:"#dc4664"
                      }
                    ].map(item=>(
                      <div
                        key={item.label}
                        className="hp-quality-row"
                      >
                        <span
                          className="hp-quality-dot"
                          style={{
                            backgroundColor:item.color
                          }}
                        />
                        <div className="hp-quality-name">
                          <strong>{item.label}</strong>
                          <small>
                            {totalStock > 0
                              ? (item.value/totalStock*100)
                                .toLocaleString("id-ID",{
                                  maximumFractionDigits:2
                                })+"%"
                              : "0%"}
                          </small>
                        </div>
                        <strong>
                          {formatNumber(item.value)} pcs
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}


            {/* WAREHOUSE SUMMARY */}
            <section className="mb-8">

              <div className="mb-4">
                <h2 className="text-xl font-semibold">
                  Warehouse Summary
                </h2>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

                <div data-hp-kpi="products" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Products
                  </p>

                  <p className="mt-3 text-3xl font-bold">
                    {formatNumber(productsCount)}
                  </p>
                </div>

                <div data-hp-kpi="sku" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    SKU / Variants
                  </p>

                  <p className="mt-3 text-3xl font-bold">
                    {formatNumber(variantsCount)}
                  </p>
                </div>

                <div data-hp-kpi="warehouse" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Warehouse
                  </p>

                  <p className="mt-3 text-3xl font-bold">
                    {formatNumber(warehousesCount)}
                  </p>
                </div>

                <div data-hp-kpi="areas" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Stock Areas
                  </p>

                  <p className="mt-3 text-3xl font-bold">
                    {formatNumber(stockAreasCount)}
                  </p>
                </div>

              </div>
            </section>

            {/* INVENTORY VALUATION */}
            <section className="mb-8">

              <div className="mb-4">
                <h2 className="text-xl font-semibold">
                  Inventory Valuation
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Nilai stok berdasarkan HPP • Normal + Defect + Reject
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

                <div data-hp-kpi="value" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Inventory Value (HPP)
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(totalInventoryValue)}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Semua status stok
                  </p>
                </div>

                <div data-hp-kpi="normal" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Nilai HPP Normal
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(normalInventoryValue)}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Normal stock
                  </p>
                </div>

                <div data-hp-kpi="defect" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Nilai HPP Defect
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(defectInventoryValue)}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Tetap dihitung sebagai nilai stok
                  </p>
                </div>

                <div data-hp-kpi="reject" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Nilai HPP Reject
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(rejectInventoryValue)}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Tetap dihitung sebagai nilai stok
                  </p>
                </div>

              </div>
            </section>

            {/* POTENTIAL SALES & PROFIT */}
            <section className="mb-8">

              <div className="mb-4">
                <h2 className="text-xl font-semibold">
                  Potential Sales & Profit
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Hanya berdasarkan stok NORMAL
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">

                <div data-hp-kpi="sales" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Potential Sales Value
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(potentialSales)}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Normal × Harga Jual
                  </p>
                </div>

                <div data-hp-kpi="profit" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Potential Gross Profit
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatRupiah(potentialGrossProfit)}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Normal × (Harga Jual − HPP)
                  </p>
                </div>

                <div data-hp-kpi="margin" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p data-hp-kpi-label="" className="text-sm font-medium text-slate-500">
                    Margin
                  </p>

                  <p className="mt-3 text-2xl font-bold">
                    {formatPercent(margin)}
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Gross Profit ÷ Potential Sales
                  </p>
                </div>

              </div>
            </section>

            {/* STOCK BY AREA */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="border-b border-slate-200 p-6">
                <h2 className="text-xl font-semibold">
                  Stock by Area
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Ringkasan stok seluruh gudang berdasarkan area inventory
                </p>
              </div>

              <div className="w-full max-w-full overflow-x-auto">

                <table className="w-full min-w-[650px] text-left text-sm">

                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-6 py-4 font-semibold">
                        Area
                      </th>

                      <th className="px-6 py-4 font-semibold">
                        Description
                      </th>

                      <th className="px-6 py-4 text-right font-semibold">
                        Quantity
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">

                    <tr>
                      <td className="px-6 py-5 font-semibold">
                        NORMAL
                      </td>

                      <td className="px-6 py-5 text-slate-600">
                        Area Stok Normal / Siap Jual
                      </td>

                      <td className="px-6 py-5 text-right font-semibold">
                        {formatNumber(normalStock)}
                      </td>
                    </tr>

                    <tr>
                      <td className="px-6 py-5 font-semibold">
                        DEFECT
                      </td>

                      <td className="px-6 py-5 text-slate-600">
                        Area Stok Defect
                      </td>

                      <td className="px-6 py-5 text-right font-semibold">
                        {formatNumber(defectStock)}
                      </td>
                    </tr>

                    <tr>
                      <td className="px-6 py-5 font-semibold">
                        REJECT
                      </td>

                      <td className="px-6 py-5 text-slate-600">
                        Area Stok Reject
                      </td>

                      <td className="px-6 py-5 text-right font-semibold">
                        {formatNumber(rejectStock)}
                      </td>
                    </tr>

                  </tbody>

                </table>
              </div>
            </section>

            {loading && (
              <div className="mt-4 text-center text-sm text-slate-400">
                Loading dashboard...
              </div>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}