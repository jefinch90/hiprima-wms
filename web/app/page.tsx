import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();

  // 1. Cek user login
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 2. Ambil data inventory + area gudang
  const { data: stockAreaData, error: stockAreaError } =
  await supabase.rpc("get_stock_by_area");

  // 3. Hitung jumlah master data
  const [
    productsResult,
    variantsResult,
    warehousesResult,
    stockAreasResult,
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id", { count: "exact", head: true }),

    supabase
      .from("product_variants")
      .select("id", { count: "exact", head: true }),

    supabase
      .from("warehouses")
      .select("id", { count: "exact", head: true }),

    supabase
      .from("stock_areas")
      .select("id", { count: "exact", head: true }),
  ]);

  if (stockAreaError) {
  throw new Error(`Stock area error: ${stockAreaError.message}`);
}

const normalStock = Number(
  stockAreaData?.find((row) => row.stock_area === "NORMAL")?.total_qty ?? 0
);

const defectStock = Number(
  stockAreaData?.find((row) => row.stock_area === "DEFECT")?.total_qty ?? 0
);

const rejectStock = Number(
  stockAreaData?.find((row) => row.stock_area === "REJECT")?.total_qty ?? 0
);

const totalStock = normalStock + defectStock + rejectStock;

  const formatNumber = (value: number) =>
    value.toLocaleString("id-ID");

  const stats = [
    {
      label: "Total Stock",
      value: formatNumber(totalStock),
      description: "Seluruh stok gudang",
    },
    {
      label: "Normal",
      value: formatNumber(normalStock),
      description: "Stok siap jual",
    },
    {
      label: "Defect",
      value: formatNumber(defectStock),
      description: "Stok perlu pengecekan",
    },
    {
      label: "Reject",
      value: formatNumber(rejectStock),
      description: "Stok reject",
    },
  ];

  const summary = [
    {
      label: "Products",
      value: formatNumber(productsResult.count ?? 0),
    },
    {
      label: "SKU / Variants",
      value: formatNumber(variantsResult.count ?? 0),
    },
    {
      label: "Warehouse",
      value: formatNumber(warehousesResult.count ?? 0),
    },
    {
      label: "Stock Areas",
      value: formatNumber(stockAreasResult.count ?? 0),
    },
  ];

  const stockAreaRows = [
    {
      area: "NORMAL",
      description: "Area Stok Normal / Siap Jual",
      quantity: normalStock,
    },
    {
      area: "DEFECT",
      description: "Area Stok Defect",
      quantity: defectStock,
    },
    {
      area: "REJECT",
      description: "Area Stok Reject",
      quantity: rejectStock,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">

        {/* SIDEBAR */}
        <aside className="hidden w-64 border-r border-slate-200 bg-white p-6 lg:block">
          <div className="mb-10">
            <div className="text-xl font-bold tracking-tight">
              Hi.PRIMA
            </div>

            <div className="text-sm text-slate-500">
              Warehouse Management System
            </div>
          </div>

          <nav className="space-y-2">
            <div className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white">
              Dashboard
            </div>

            <div className="rounded-xl px-4 py-3 text-sm text-slate-600">
              Products
            </div>

            <Link
  href="/inventory"
  className="block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
>
  Inventory
</Link>

            <div className="rounded-xl px-4 py-3 text-sm text-slate-600">
              Stock Movement
            </div>

            <Link
  href="/locations"
  className="block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
>
  Locations
</Link>

            <div className="rounded-xl px-4 py-3 text-sm text-slate-600">
              Users
            </div>
          </nav>
        </aside>

        {/* MAIN */}
        <main className="flex-1 p-6 md:p-10">
          <div className="mx-auto max-w-7xl">

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

            {/* STOCK CARDS */}
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

            {/* SUMMARY */}
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

            {/* STOCK AREA */}
            <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-6">
                <h2 className="text-lg font-semibold">
                  Stock by Area
                </h2>

                <p className="text-sm text-slate-500">
                  Kondisi stok berdasarkan area gudang
                </p>
              </div>

              <div className="overflow-x-auto">
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
                          {formatNumber(item.quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

          </div>
        </main>
      </div>
    </div>
  );
}