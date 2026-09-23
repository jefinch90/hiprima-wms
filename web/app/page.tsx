"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type StockAreaRow = {
  stock_area: string;
  total_qty: number | string | null;
};

type DashboardData = {
  normalStock: number;
  defectStock: number;
  rejectStock: number;
  productsCount: number;
  variantsCount: number;
  warehousesCount: number;
  stockAreasCount: number;
};

const initialDashboardData: DashboardData = {
  normalStock: 0,
  defectStock: 0,
  rejectStock: 0,
  productsCount: 0,
  variantsCount: 0,
  warehousesCount: 0,
  stockAreasCount: 0,
};

export default function Home() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [dashboardData, setDashboardData] =
    useState<DashboardData>(initialDashboardData);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      setErrorMessage("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/login");
        return;
      }

      const { data: stockAreaData, error: stockAreaError } =
        await supabase.rpc("get_stock_by_area");

      if (stockAreaError) {
        setErrorMessage(
          `Stock area error: ${stockAreaError.message}`
        );
        setLoading(false);
        return;
      }

      const [
        productsResult,
        variantsResult,
        warehousesResult,
        stockAreasResult,
      ] = await Promise.all([
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

      const queryError =
        productsResult.error ||
        variantsResult.error ||
        warehousesResult.error ||
        stockAreasResult.error;

      if (queryError) {
        setErrorMessage(queryError.message);
        setLoading(false);
        return;
      }

      const rows = (stockAreaData ?? []) as StockAreaRow[];

      const normalStock = Number(
        rows.find(
          (row) => row.stock_area === "NORMAL"
        )?.total_qty ?? 0
      );

      const defectStock = Number(
        rows.find(
          (row) => row.stock_area === "DEFECT"
        )?.total_qty ?? 0
      );

      const rejectStock = Number(
        rows.find(
          (row) => row.stock_area === "REJECT"
        )?.total_qty ?? 0
      );

      setDashboardData({
        normalStock,
        defectStock,
        rejectStock,
        productsCount: productsResult.count ?? 0,
        variantsCount: variantsResult.count ?? 0,
        warehousesCount: warehousesResult.count ?? 0,
        stockAreasCount: stockAreasResult.count ?? 0,
      });

      setLoading(false);
    }

    loadDashboard();
  }, [router, supabase]);

  const formatNumber = (value: number) =>
    value.toLocaleString("id-ID");

  const totalStock =
    dashboardData.normalStock +
    dashboardData.defectStock +
    dashboardData.rejectStock;

  const stats = [
    {
      label: "Total Stock",
      value: formatNumber(totalStock),
      description: "Seluruh stok gudang",
    },
    {
      label: "Normal",
      value: formatNumber(
        dashboardData.normalStock
      ),
      description: "Stok siap jual",
    },
    {
      label: "Defect",
      value: formatNumber(
        dashboardData.defectStock
      ),
      description: "Stok perlu pengecekan",
    },
    {
      label: "Reject",
      value: formatNumber(
        dashboardData.rejectStock
      ),
      description: "Stok reject",
    },
  ];

  const summary = [
    {
      label: "Products",
      value: formatNumber(
        dashboardData.productsCount
      ),
    },
    {
      label: "SKU / Variants",
      value: formatNumber(
        dashboardData.variantsCount
      ),
    },
    {
      label: "Warehouse",
      value: formatNumber(
        dashboardData.warehousesCount
      ),
    },
    {
      label: "Stock Areas",
      value: formatNumber(
        dashboardData.stockAreasCount
      ),
    },
  ];

  const stockAreaRows = [
    {
      area: "NORMAL",
      description:
        "Area Stok Normal / Siap Jual",
      quantity: dashboardData.normalStock,
    },
    {
      area: "DEFECT",
      description: "Area Stok Defect",
      quantity: dashboardData.defectStock,
    },
    {
      area: "REJECT",
      description: "Area Stok Reject",
      quantity: dashboardData.rejectStock,
    },
  ];

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">
          <div className="mx-auto w-full min-w-0 max-w-7xl">

            <header className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="mb-1 text-sm font-medium text-slate-500">
                  PT Prima Berkah Mulia
                </p>

                <h1 className="text-3xl font-bold tracking-tight">
                  Warehouse Dashboard
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                  Monitoring stok Hi.PRIMA • Live Database
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
                Gudang Utama Hi.PRIMA
              </div>
            </header>

            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500 shadow-sm">
                Memuat dashboard...
              </div>
            ) : (
              <>
                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {stats.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                    >
                      <p className="text-sm font-medium text-slate-500">
                        {item.label}
                      </p>

                      <p className="mt-3 text-3xl font-bold tracking-tight">
                        {item.value}
                      </p>

                      <p className="mt-2 text-xs text-slate-400">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </section>

                <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-6">
                    <h2 className="text-lg font-semibold">
                      Warehouse Summary
                    </h2>

                    <p className="text-sm text-slate-500">
                      Ringkasan data master WMS
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {summary.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-xl bg-slate-50 p-5"
                      >
                        <p className="text-sm text-slate-500">
                          {item.label}
                        </p>

                        <p className="mt-2 text-2xl font-semibold">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mt-6 w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 p-6">
                    <h2 className="text-lg font-semibold">
                      Stock by Area
                    </h2>

                    <p className="text-sm text-slate-500">
                      Kondisi stok berdasarkan area gudang
                    </p>
                  </div>

                  <div className="w-full max-w-full overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-6 py-4 font-medium">
                            Area
                          </th>

                          <th className="px-6 py-4 font-medium">
                            Description
                          </th>

                          <th className="px-6 py-4 text-right font-medium">
                            Quantity
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {stockAreaRows.map((item) => (
                          <tr key={item.area}>
                            <td className="px-6 py-4 font-medium">
                              {item.area}
                            </td>

                            <td className="px-6 py-4 text-slate-500">
                              {item.description}
                            </td>

                            <td className="px-6 py-4 text-right font-semibold">
                              {formatNumber(
                                item.quantity
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}