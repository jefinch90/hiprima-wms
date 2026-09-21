import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

type MovementRow = {
  movement_id: string;
  movement_no: number;
  movement_type: string;
  created_at: string;

  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;

  quantity: number;

  from_location: string | null;
  to_location: string | null;

  reason: string | null;
  reference_no: string | null;
  notes: string | null;
  created_by: string | null;

  total_count: number;
};

const movementLabels: Record<string, string> = {
  opening: "Opening",
  inbound: "Inbound",
  outbound: "Outbound",
  transfer: "Transfer",
  adjustment_in: "Adjustment In",
  adjustment_out: "Adjustment Out",
  return_in: "Return In",
  return_out: "Return Out",
};

export default async function StockMovementPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
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
  const typeFilter = params.type?.trim() ?? "";
  const currentPage = Math.max(
    Number(params.page ?? "1") || 1,
    1
  );

  const pageSize = 50;
  const offset = (currentPage - 1) * pageSize;

  const { data, error } = await supabase.rpc(
    "get_stock_movements",
    {
      p_search: search || null,
      p_type: typeFilter || null,
      p_limit: pageSize,
      p_offset: offset,
    }
  );

  if (error) {
    throw new Error(
      `Stock movement error: ${error.message}`
    );
  }

  const movements = (data ?? []) as MovementRow[];

  const totalCount = Number(
    movements[0]?.total_count ?? 0
  );

  const totalPages = Math.max(
    Math.ceil(totalCount / pageSize),
    1
  );

  const formatNumber = (value: number) =>
    Number(value ?? 0).toLocaleString("id-ID");

  const formatDate = (value: string) =>
    new Date(value).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const makePageUrl = (page: number) => {
    const query = new URLSearchParams();

    if (search) {
      query.set("q", search);
    }

    if (typeFilter) {
      query.set("type", typeFilter);
    }

    query.set("page", String(page));

    return `/stock-movement?${query.toString()}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">

        {/* SIDEBAR */}
        <aside className="hidden w-64 border-r border-slate-200 bg-white p-6 lg:block">

          <div className="mb-10">
            <div className="text-xl font-bold">
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
              className="block rounded-xl px-4 py-3 text-sm text-slate-600 hover:bg-slate-50"
            >
              Inventory
            </Link>

            <Link
              href="/stock-movement"
              className="block rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
            >
              Stock Movement
            </Link>

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

              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <h1 className="mt-1 text-3xl font-bold">
                Stock Movement
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Riwayat pergerakan stok Warehouse Management System
              </p>

            </header>

            {/* SEARCH & FILTER */}
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

              <form
                action="/stock-movement"
                method="GET"
                className="flex flex-col gap-3 lg:flex-row"
              >

                <input
                  name="q"
                  defaultValue={search}
                  placeholder="Cari SKU, produk, reference, lokasi..."
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm"
                />

                <select
                  name="type"
                  defaultValue={typeFilter}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
                >
                  <option value="">
                    All Movement
                  </option>

                  <option value="opening">
                    Opening
                  </option>

                  <option value="inbound">
                    Inbound
                  </option>

                  <option value="outbound">
                    Outbound
                  </option>

                  <option value="transfer">
                    Transfer
                  </option>

                  <option value="adjustment_in">
                    Adjustment In
                  </option>

                  <option value="adjustment_out">
                    Adjustment Out
                  </option>

                  <option value="return_in">
                    Return In
                  </option>

                  <option value="return_out">
                    Return Out
                  </option>
                </select>

                <button className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white">
                  Search
                </button>

                {(search || typeFilter) && (
                  <Link
                    href="/stock-movement"
                    className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm"
                  >
                    Reset
                  </Link>
                )}

              </form>
            </section>

            {/* MOVEMENT LIST */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex items-center justify-between border-b border-slate-200 p-6">

                <div>
                  <h2 className="text-lg font-semibold">
                    Movement History
                  </h2>

                  <p className="text-sm text-slate-500">
                    {formatNumber(totalCount)} movement ditemukan
                  </p>
                </div>

                <div className="text-sm text-slate-500">
                  Page {currentPage} of {totalPages}
                </div>

              </div>

              <div className="overflow-x-auto">

                <table className="w-full min-w-[1250px] text-left text-sm">

                  <thead className="bg-slate-50 text-slate-500">

                    <tr>
                      <th className="px-4 py-4">
                        No
                      </th>

                      <th className="px-4 py-4">
                        Date
                      </th>

                      <th className="px-4 py-4">
                        Type
                      </th>

                      <th className="px-4 py-4">
                        SKU
                      </th>

                      <th className="px-4 py-4">
                        Product
                      </th>

                      <th className="px-4 py-4 text-right">
                        Qty
                      </th>

                      <th className="px-4 py-4">
                        Movement
                      </th>

                      <th className="px-4 py-4">
                        Reference
                      </th>

                      <th className="px-4 py-4">
                        Notes
                      </th>
                    </tr>

                  </thead>

                  <tbody className="divide-y divide-slate-100">

                    {movements.map((movement) => (

                      <tr
                        key={movement.movement_id}
                        className="hover:bg-slate-50"
                      >

                        <td className="px-4 py-4 font-semibold">
                          #{movement.movement_no}
                        </td>

                        <td className="whitespace-nowrap px-4 py-4">
                          {formatDate(movement.created_at)}
                        </td>

                        <td className="px-4 py-4">
                          <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium">
                            {movementLabels[
                              movement.movement_type
                            ] ?? movement.movement_type}
                          </span>
                        </td>

                        <td className="px-4 py-4 font-semibold">
                          {movement.sku}
                        </td>

                        <td className="px-4 py-4">

                          <div>
                            {movement.product_name}
                          </div>

                          <div className="text-xs text-slate-400">
                            {movement.product_code}
                          </div>

                        </td>

                        <td className="px-4 py-4 text-right font-bold">
                          {formatNumber(
                            movement.quantity
                          )}
                        </td>

                        <td className="px-4 py-4">

                          <div className="whitespace-nowrap">
                            {movement.from_location ?? "-"}
                            {" → "}
                            {movement.to_location ?? "-"}
                          </div>

                        </td>

                        <td className="px-4 py-4">

                          {movement.reference_no ?? "-"}

                          {movement.reason && (
                            <div className="mt-1 text-xs text-slate-400">
                              {movement.reason}
                            </div>
                          )}

                        </td>

                        <td className="max-w-[250px] px-4 py-4 text-slate-500">
                          {movement.notes ?? "-"}
                        </td>

                      </tr>

                    ))}

                  </tbody>

                </table>

              </div>

              {/* PAGINATION */}
              <div className="flex items-center justify-between border-t border-slate-200 p-5">

                <div className="text-sm text-slate-500">
                  Menampilkan maksimal {pageSize} movement per halaman
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