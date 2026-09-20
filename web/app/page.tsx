const stats = [
  {
    label: "Total Stock",
    value: "14,886",
    description: "Seluruh stok gudang",
  },
  {
    label: "Normal",
    value: "12,562",
    description: "Stok siap jual",
  },
  {
    label: "Defect",
    value: "2,321",
    description: "Stok perlu pengecekan",
  },
  {
    label: "Reject",
    value: "3",
    description: "Stok reject",
  },
];

const summary = [
  { label: "Products", value: "785" },
  { label: "SKU / Variants", value: "3,743" },
  { label: "Warehouse", value: "1" },
  { label: "Stock Areas", value: "3" },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden w-64 border-r border-slate-200 bg-white p-6 lg:block">
          <div className="mb-10">
            <div className="text-xl font-bold tracking-tight">Hi.PRIMA</div>
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

            <div className="rounded-xl px-4 py-3 text-sm text-slate-600">
              Inventory
            </div>

            <div className="rounded-xl px-4 py-3 text-sm text-slate-600">
              Stock Movement
            </div>

            <div className="rounded-xl px-4 py-3 text-sm text-slate-600">
              Locations
            </div>

            <div className="rounded-xl px-4 py-3 text-sm text-slate-600">
              Users
            </div>
          </nav>
        </aside>

        {/* Main Content */}
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
                  Monitoring stok Hi.PRIMA
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
                Gudang Utama Hi.PRIMA
              </div>
            </header>

            {/* Stock Cards */}
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

            {/* Summary */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <h2 className="text-lg font-semibold">Warehouse Summary</h2>
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
                    <p className="text-sm text-slate-500">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold">{item.value}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Stock Area Table */}
            <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-6">
                <h2 className="text-lg font-semibold">Stock by Area</h2>
                <p className="text-sm text-slate-500">
                  Kondisi stok berdasarkan area gudang
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-6 py-4 font-medium">Area</th>
                      <th className="px-6 py-4 font-medium">Description</th>
                      <th className="px-6 py-4 text-right font-medium">
                        Quantity
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-6 py-4 font-medium">NORMAL</td>
                      <td className="px-6 py-4 text-slate-500">
                        Area Stok Normal / Siap Jual
                      </td>
                      <td className="px-6 py-4 text-right font-semibold">
                        12,562
                      </td>
                    </tr>

                    <tr>
                      <td className="px-6 py-4 font-medium">DEFECT</td>
                      <td className="px-6 py-4 text-slate-500">
                        Area Stok Defect
                      </td>
                      <td className="px-6 py-4 text-right font-semibold">
                        2,321
                      </td>
                    </tr>

                    <tr>
                      <td className="px-6 py-4 font-medium">REJECT</td>
                      <td className="px-6 py-4 text-slate-500">
                        Area Stok Reject
                      </td>
                      <td className="px-6 py-4 text-right font-semibold">
                        3
                      </td>
                    </tr>
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