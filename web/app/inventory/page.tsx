"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type InventoryRow = {
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  barcode: string | null;

  normal_qty: number | string;
  defect_qty: number | string;
  reject_qty: number | string;
  total_qty: number | string;

  normal_locations: string | null;
  defect_locations: string | null;
  reject_locations: string | null;

  total_count: number | string;
};

export default function InventoryPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const pageSize = 50;

  const [inventory, setInventory] = useState<InventoryRow[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadInventory = useCallback(async () => {
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
      "get_inventory_list",
      {
        p_search: search || null,
        p_limit: pageSize,
        p_offset: offset,
      }
    );

    if (error) {
      setInventory([]);
      setTotalCount(0);
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as InventoryRow[];

    setInventory(rows);

    setTotalCount(
      Number(rows[0]?.total_count ?? 0)
    );

    setLoading(false);
  }, [
    currentPage,
    pageSize,
    router,
    search,
    supabase,
  ]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  const totalPages = Math.max(
    Math.ceil(totalCount / pageSize),
    1
  );

  const formatNumber = (
    value: number | string | null | undefined
  ) =>
    Number(value ?? 0).toLocaleString("id-ID");

  function handleSearch(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setCurrentPage(1);
    setSearch(searchInput.trim());
  }

  function handleReset() {
    setSearchInput("");
    setSearch("");
    setCurrentPage(1);
    setErrorMessage("");
  }

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

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">
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

            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            <section className="mb-6 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

              <form
                onSubmit={handleSearch}
                className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
              >
                <input
                  value={searchInput}
                  onChange={(event) =>
                    setSearchInput(event.target.value)
                  }
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
                  <button
                    type="button"
                    onClick={handleReset}
                    className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-center text-sm"
                  >
                    Reset
                  </button>
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

              {loading ? (
                <div className="p-12 text-center text-sm text-slate-500">
                  Memuat inventory...
                </div>
              ) : (
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
                            {formatNumber(
                              row.normal_qty
                            )}
                          </td>

                          <td className="px-5 py-5 text-right">
                            {formatNumber(
                              row.defect_qty
                            )}
                          </td>

                          <td className="px-5 py-5 text-right">
                            {formatNumber(
                              row.reject_qty
                            )}
                          </td>

                          <td className="px-5 py-5 text-right">
                            <span className="inline-flex rounded-lg bg-slate-100 px-3 py-1 font-bold">
                              {formatNumber(
                                row.total_qty
                              )}
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

                            {Number(row.reject_qty) > 0 &&
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
              )}

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">

                <div className="text-sm text-slate-500">
                  Menampilkan maksimal {pageSize} SKU per halaman
                </div>

                <div className="flex gap-2">

                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() =>
                      setCurrentPage((page) =>
                        Math.max(page - 1, 1)
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Previous
                  </button>

                  <button
                    type="button"
                    disabled={
                      currentPage >= totalPages
                    }
                    onClick={() =>
                      setCurrentPage((page) =>
                        Math.min(
                          page + 1,
                          totalPages
                        )
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:border-slate-200 disabled:text-slate-300"
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