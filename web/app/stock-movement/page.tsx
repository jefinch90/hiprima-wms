"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type MovementRow = {
  movement_id: string;
  movement_no: number | string;
  movement_type: string;
  created_at: string;
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  quantity: number | string;
  from_location: string | null;
  to_location: string | null;
  reason: string | null;
  reference_no: string | null;
  notes: string | null;
  created_by: string | null;
  total_count: number | string;
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

export default function StockMovementPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const pageSize = 50;

  const [movements, setMovements] = useState<MovementRow[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [typeInput, setTypeInput] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadMovements = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login");
      return;
    }

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
      setMovements([]);
      setTotalCount(0);
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as MovementRow[];

    setMovements(rows);
    setTotalCount(Number(rows[0]?.total_count ?? 0));
    setLoading(false);
  }, [
    currentPage,
    router,
    search,
    supabase,
    typeFilter,
  ]);

  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  const totalPages = Math.max(
    Math.ceil(totalCount / pageSize),
    1
  );

  const formatNumber = (
    value: number | string | null | undefined
  ) => Number(value ?? 0).toLocaleString("id-ID");

  const formatDate = (value: string) =>
    new Date(value).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setCurrentPage(1);
    setSearch(searchInput.trim());
    setTypeFilter(typeInput);
  }

  function handleReset() {
    setSearchInput("");
    setTypeInput("");
    setSearch("");
    setTypeFilter("");
    setCurrentPage(1);
    setErrorMessage("");
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">
          <div className="mx-auto w-full min-w-0 max-w-[1400px]">

            <header className="mb-8">
              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="text-3xl font-bold">
                    Stock Movement
                  </h1>

                  <p className="mt-2 text-sm text-slate-500">
                    Riwayat pergerakan stok Warehouse Management System
                  </p>
                </div>

                <Link
                  href="/stock-movement/transfer"
                  className="rounded-xl bg-slate-900 px-5 py-3 text-center text-sm font-medium text-white"
                >
                  Transfer Stock
                </Link>
              </div>
            </header>

            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <form
                onSubmit={handleSearch}
                className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto]"
              >
                <input
                  value={searchInput}
                  onChange={(event) =>
                    setSearchInput(event.target.value)
                  }
                  placeholder="Cari SKU, produk, reference, lokasi..."
                  className="min-w-0 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none"
                />

                <select
                  value={typeInput}
                  onChange={(event) =>
                    setTypeInput(event.target.value)
                  }
                  className="min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
                >
                  <option value="">All Movement</option>
                  <option value="opening">Opening</option>
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                  <option value="transfer">Transfer</option>
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

                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white"
                >
                  Search
                </button>

                {(search || typeFilter) && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-xl border border-slate-300 px-5 py-3 text-sm"
                  >
                    Reset
                  </button>
                )}
              </form>
            </section>

            <section className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
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

              {loading ? (
                <div className="p-12 text-center text-sm text-slate-500">
                  Memuat stock movement...
                </div>
              ) : (
                <>
                  <div className="hidden lg:block">
                    <table className="w-full table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-[6%]" />
                        <col className="w-[12%]" />
                        <col className="w-[9%]" />
                        <col className="w-[12%]" />
                        <col className="w-[18%]" />
                        <col className="w-[6%]" />
                        <col className="w-[11%]" />
                        <col className="w-[13%]" />
                        <col className="w-[13%]" />
                      </colgroup>

                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-4">No</th>
                          <th className="px-3 py-4">Date</th>
                          <th className="px-3 py-4">Type</th>
                          <th className="px-3 py-4">SKU</th>
                          <th className="px-3 py-4">Product</th>
                          <th className="px-3 py-4 text-right">
                            Qty
                          </th>
                          <th className="px-3 py-4">Movement</th>
                          <th className="px-3 py-4">Reference</th>
                          <th className="px-3 py-4">Notes</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {movements.map((movement) => (
                          <tr
                            key={movement.movement_id}
                            className="align-top hover:bg-slate-50"
                          >
                            <td className="break-words px-3 py-5 font-semibold">
                              #{movement.movement_no}
                            </td>

                            <td className="break-words px-3 py-5">
                              {formatDate(movement.created_at)}
                            </td>

                            <td className="break-words px-3 py-5">
                              <span className="inline-flex rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium">
                                {movementLabels[
                                  movement.movement_type
                                ] ?? movement.movement_type}
                              </span>
                            </td>

                            <td className="break-all px-3 py-5 font-semibold">
                              {movement.sku}
                            </td>

                            <td className="break-words px-3 py-5">
                              <div>{movement.product_name}</div>
                              <div className="mt-1 text-xs text-slate-400">
                                {movement.product_code}
                              </div>
                            </td>

                            <td className="px-3 py-5 text-right font-bold">
                              {formatNumber(movement.quantity)}
                            </td>

                            <td className="break-words px-3 py-5">
                              {movement.from_location ?? "-"} →{" "}
                              {movement.to_location ?? "-"}
                            </td>

                            <td className="break-words px-3 py-5">
                              <div>
                                {movement.reference_no ?? "-"}
                              </div>
                              {movement.reason && (
                                <div className="mt-1 text-xs text-slate-400">
                                  {movement.reason}
                                </div>
                              )}
                            </td>

                            <td className="break-words px-3 py-5 text-slate-500">
                              {movement.notes ?? "-"}
                            </td>
                          </tr>
                        ))}

                        {movements.length === 0 && (
                          <tr>
                            <td
                              colSpan={9}
                              className="px-5 py-12 text-center text-slate-500"
                            >
                              Tidak ada stock movement ditemukan.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="divide-y divide-slate-100 lg:hidden">
                    {movements.map((movement) => (
                      <div
                        key={movement.movement_id}
                        className="p-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-semibold">
                              #{movement.movement_no}
                            </div>
                            <div className="mt-1 break-all font-semibold">
                              {movement.sku}
                            </div>
                          </div>

                          <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium">
                            {movementLabels[
                              movement.movement_type
                            ] ?? movement.movement_type}
                          </span>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <div className="text-xs text-slate-400">
                              Date
                            </div>
                            <div className="mt-1">
                              {formatDate(movement.created_at)}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-slate-400">
                              Qty
                            </div>
                            <div className="mt-1 font-semibold">
                              {formatNumber(movement.quantity)}
                            </div>
                          </div>

                          <div className="col-span-2">
                            <div className="text-xs text-slate-400">
                              Product
                            </div>
                            <div className="mt-1">
                              {movement.product_name}
                            </div>
                          </div>

                          <div className="col-span-2">
                            <div className="text-xs text-slate-400">
                              Movement
                            </div>
                            <div className="mt-1">
                              {movement.from_location ?? "-"} →{" "}
                              {movement.to_location ?? "-"}
                            </div>
                          </div>

                          <div className="col-span-2">
                            <div className="text-xs text-slate-400">
                              Reference
                            </div>
                            <div className="mt-1">
                              {movement.reference_no ?? "-"}
                            </div>
                          </div>

                          <div className="col-span-2">
                            <div className="text-xs text-slate-400">
                              Notes
                            </div>
                            <div className="mt-1 text-slate-500">
                              {movement.notes ?? "-"}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  Maksimal {pageSize} movement per halaman
                </div>

                <div className="flex gap-2">
                  <button
                    disabled={currentPage <= 1}
                    onClick={() =>
                      setCurrentPage((page) =>
                        Math.max(page - 1, 1)
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Previous
                  </button>

                  <button
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      setCurrentPage((page) =>
                        Math.min(page + 1, totalPages)
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Next
                  </button>
                </div>
              </div>

            </section>
          </div>
        </main>
      </div>
    </div>
  );
}