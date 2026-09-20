import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

type InventoryRow = {
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  barcode: string | null;
  normal_qty: number;
  defect_qty: number;
  reject_qty: number;
  total_qty: number;
  normal_locations: string | null;
  defect_locations: string | null;
  reject_locations: string | null;
  total_count: number;
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
  }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;

  const search = params.q?.trim() ?? "";
  const currentPage = Math.max(Number(params.page ?? "1") || 1, 1);

  const pageSize = 50;
  const offset = (currentPage - 1) * pageSize;

  const { data, error } = await supabase.rpc("get_inventory_list", {
    p_search: search || null,
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error) {
    throw new Error(`Inventory error: ${error.message}`);
  }

  const rows = (data ?? []) as InventoryRow[];

  const totalCount = Number(rows[0]?.total_count ?? 0);
  const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

  const formatNumber = (value: number) =>
    Number(value ?? 0).toLocaleString("id-ID");

  const makePageUrl = (page: number) => {
    const query = new URLSearchParams();

    if (search) {
      query.set("q", search);
    }

    query.set("page", String(page));

    return `/inventory?${query.toString()}`;
  };

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
            <Link
              href="/"
              className="block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
            >
              Dashboard
            </Link>

            <Link
  href="/products"
  className="block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
>
  Products
</Link>

            <Link
              href="/inventory"
              className="block rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
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
          <div className="mx-auto max-w-[1600px]">

            <header className="mb-8">
              <p className="mb-1 text-sm font-medium text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <h1 className="text-3xl font-bold tracking-tight">
                Inventory
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Monitoring stok SKU berdasarkan area dan lokasi gudang
              </p>
            </header>

            {/* SEARCH */}
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <form
                method="GET"
                action="/inventory"
                className="flex flex-col gap-3 md:flex-row"
              >
                <input
                  type="text"
                  name="q"
                  defaultValue={search}
                  placeholder="Cari SKU, kode produk, nama produk, atau warna..."
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                />

                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white"
                >
                  Search
                </button>

                {search && (
                  <Link
                    href="/inventory"
                    className="rounded-xl border border-slate-300 px-6 py-3 text-center text-sm font-medium text-slate-600"
                  >
                    Reset
                  </Link>
                )}
              </form>
            </section>

            {/* TABLE */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    Inventory List
                  </h2>

                  <p className="text-sm text-slate-500">
                    {formatNumber(totalCount)} SKU ditemukan
                  </p>
                </div>

                <div className="text-sm text-slate-500">
                  Page {currentPage} of {totalPages}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1350px] text-left text-sm">

                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-medium">
                        SKU
                      </th>

                      <th className="px-5 py-4 font-medium">
                        Product
                      </th>

                      <th className="px-5 py-4 font-medium">
                        Variant
                      </th>

                      <th className="px-5 py-4 text-right font-medium">
                        Normal
                      </th>

                      <th className="px-5 py-4 text-right font-medium">
                        Defect
                      </th>

                      <th className="px-5 py-4 text-right font-medium">
                        Reject
                      </th>

                      <th className="px-5 py-4 text-right font-medium">
                        Total
                      </th>

                      <th className="px-5 py-4 font-medium">
                        Location
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">

                    {rows.map((row) => (
                      <tr
                        key={row.variant_id}
                        className="hover:bg-slate-50"
                      >
                        <td className="px-5 py-4">
                          <div className="font-semibold">
                            {row.sku}
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            {row.product_code}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="font-medium">
                            {row.product_name}
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            {row.brand ?? "-"}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div>
                            {row.color ?? "-"}
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            Size: {row.size ?? "-"}
                          </div>
                        </td>

                        <td className="px-5 py-4 text-right font-medium">
                          {formatNumber(row.normal_qty)}
                        </td>

                        <td className="px-5 py-4 text-right font-medium">
                          {formatNumber(row.defect_qty)}
                        </td>

                        <td className="px-5 py-4 text-right font-medium">
                          {formatNumber(row.reject_qty)}
                        </td>

                        <td className="px-5 py-4 text-right">
                          <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-bold">
                            {formatNumber(row.total_qty)}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-xs">
  <div className="space-y-3">

    {/* NORMAL */}
    <div>
      <div className="mb-1 font-semibold text-slate-700">
        NORMAL
      </div>

      {row.normal_locations ? (
        <div className="space-y-1">
          {row.normal_locations.split(", ").map((location) => (
            <div
              key={location}
              className="rounded-md bg-slate-50 px-2 py-1 text-slate-700"
            >
              {location}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-slate-400">-</div>
      )}
    </div>

    {/* DEFECT */}
    {row.defect_qty > 0 && (
      <div>
        <div className="mb-1 font-semibold text-amber-700">
          DEFECT
        </div>

        <div className="space-y-1">
          {row.defect_locations
            ?.split(", ")
            .map((location) => (
              <div
                key={location}
                className="rounded-md bg-amber-50 px-2 py-1 text-amber-800"
              >
                {location}
              </div>
            ))}
        </div>
      </div>
    )}

    {/* REJECT */}
    {row.reject_qty > 0 && (
      <div>
        <div className="mb-1 font-semibold text-red-700">
          REJECT
        </div>

        <div className="space-y-1">
          {row.reject_locations
            ?.split(", ")
            .map((location) => (
              <div
                key={location}
                className="rounded-md bg-red-50 px-2 py-1 text-red-800"
              >
                {location}
              </div>
            ))}
        </div>
      </div>
    )}

  </div>
</td>
                      </tr>
                    ))}

                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-6 py-16 text-center text-slate-500"
                        >
                          Data inventory tidak ditemukan.
                        </td>
                      </tr>
                    )}

                  </tbody>
                </table>
              </div>

              {/* PAGINATION */}
              <div className="flex items-center justify-between border-t border-slate-200 p-5">

                <div className="text-sm text-slate-500">
                  Menampilkan maksimal {pageSize} SKU per halaman
                </div>

                <div className="flex gap-2">
                  {currentPage > 1 ? (
                    <Link
                      href={makePageUrl(currentPage - 1)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-300">
                      Previous
                    </span>
                  )}

                  {currentPage < totalPages ? (
                    <Link
                      href={makePageUrl(currentPage + 1)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
                    >
                      Next
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-300">
                      Next
                    </span>
                  )}
                </div>
              </div>

            </section>
          </div>
        </main>
      </div>
    </div>
  );
}