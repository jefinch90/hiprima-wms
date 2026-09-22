import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import Sidebar from "@/components/Sidebar";

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

  const currentPage = Math.max(
    Number(params.page ?? "1") || 1,
    1
  );

  const pageSize = 50;
  const offset = (currentPage - 1) * pageSize;

  const { data, error } = await supabase.rpc(
    "get_inventory_list",
    {
      p_search: search || null,
      p_limit: pageSize,
      p_offset: offset,
    }
  );

  if (error) {
    throw new Error(
      `Inventory error: ${error.message}`
    );
  }

  const inventory =
    (data ?? []) as InventoryRow[];

  const totalCount = Number(
    inventory[0]?.total_count ?? 0
  );

  const totalPages = Math.max(
    Math.ceil(totalCount / pageSize),
    1
  );

  const formatNumber = (value: number) =>
    Number(value ?? 0).toLocaleString(
      "id-ID"
    );

  const makePageUrl = (page: number) => {
    const query =
      new URLSearchParams();

    if (search) {
      query.set("q", search);
    }

    query.set(
      "page",
      String(page)
    );

    return `/inventory?${query.toString()}`;
  };

  const renderLocation = (
    title: string,
    value: string | null,
    type: "normal" | "defect" | "reject"
  ) => {
    const titleClass =
      type === "normal"
        ? "text-slate-700"
        : type === "defect"
        ? "text-amber-700"
        : "text-red-700";

    const boxClass =
      type === "normal"
        ? "bg-slate-50"
        : type === "defect"
        ? "bg-amber-50 text-amber-800"
        : "bg-red-50 text-red-800";

    return (
      <div className="mb-3 last:mb-0">
        <div
          className={`mb-1 text-xs font-semibold ${titleClass}`}
        >
          {title}
        </div>

        {value ? (
          <div
            className={`whitespace-pre-line rounded-md px-2 py-1 text-xs ${boxClass}`}
          >
            {value}
          </div>
        ) : (
          <div className="text-xs text-slate-400">
            -
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">

      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 p-6 md:p-10">

          <div className="mx-auto w-full min-w-0 max-w-[1500px]">

            <header className="mb-8">
              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <h1 className="mt-1 text-3xl font-bold">
                Inventory
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Monitoring stok SKU berdasarkan area dan lokasi gudang
              </p>
            </header>

            <section className="mb-6 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <form
                action="/inventory"
                method="GET"
                className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
              >
                <input
                  name="q"
                  defaultValue={search}
                  placeholder="Cari SKU, kode produk, nama produk, atau warna..."
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                />

                <button
                  type="submit"
                  className="shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white"
                >
                  Search
                </button>

                {search && (
                  <Link
                    href="/inventory"
                    className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-center text-sm"
                  >
                    Reset
                  </Link>
                )}
              </form>
            </section>

            <section className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
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

              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">

                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-5 py-4">
                        SKU
                      </th>

                      <th className="px-5 py-4">
                        Product
                      </th>

                      <th className="px-5 py-4">
                        Variant
                      </th>

                      <th className="px-5 py-4 text-right">
                        Normal
                      </th>

                      <th className="px-5 py-4 text-right">
                        Defect
                      </th>

                      <th className="px-5 py-4 text-right">
                        Reject
                      </th>

                      <th className="px-5 py-4 text-right">
                        Total
                      </th>

                      <th className="min-w-[210px] px-5 py-4">
                        Location
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">

                    {inventory.map((row) => (
                      <tr
                        key={row.variant_id}
                        className="align-top hover:bg-slate-50"
                      >
                        <td className="px-5 py-5">
                          <div className="font-semibold">
                            {row.sku}
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            {row.product_code}
                          </div>
                        </td>

                        <td className="px-5 py-5">
                          <div>
                            {row.product_name}
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            {row.brand ?? "-"}
                          </div>
                        </td>

                        <td className="px-5 py-5">
                          <div>
                            {row.color ?? "-"}
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            Size: {row.size ?? "-"}
                          </div>
                        </td>

                        <td className="px-5 py-5 text-right">
                          {formatNumber(row.normal_qty)}
                        </td>

                        <td className="px-5 py-5 text-right">
                          {formatNumber(row.defect_qty)}
                        </td>

                        <td className="px-5 py-5 text-right">
                          {formatNumber(row.reject_qty)}
                        </td>

                        <td className="px-5 py-5 text-right">
                          <span className="inline-flex rounded-lg bg-slate-100 px-3 py-1 font-bold">
                            {formatNumber(row.total_qty)}
                          </span>
                        </td>

                        <td className="px-5 py-5">
                          {renderLocation(
                            "NORMAL",
                            row.normal_locations,
                            "normal"
                          )}

                          {renderLocation(
                            "DEFECT",
                            row.defect_locations,
                            "defect"
                          )}

                          {row.reject_qty > 0 &&
                            renderLocation(
                              "REJECT",
                              row.reject_locations,
                              "reject"
                            )}
                        </td>
                      </tr>
                    ))}

                    {inventory.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-5 py-12 text-center text-slate-500"
                        >
                          Tidak ada inventory ditemukan.
                        </td>
                      </tr>
                    )}

                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">

                <div className="text-sm text-slate-500">
                  Menampilkan maksimal {pageSize} SKU per halaman
                </div>

                <div className="flex gap-2">
                  {currentPage > 1 ? (
                    <Link
                      href={makePageUrl(
                        currentPage - 1
                      )}
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
                      href={makePageUrl(
                        currentPage + 1
                      )}
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