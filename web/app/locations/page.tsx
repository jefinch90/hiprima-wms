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

type LocationRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  is_active: boolean;
  sku_count: number | string;
  total_qty: number | string;
  total_count: number | string;
};

type LocationInventoryRow = {
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  qty: number | string;
};

export default function LocationsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const pageSize = 50;

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [inventory, setInventory] = useState<LocationInventoryRow[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [selectedLocation, setSelectedLocation] =
    useState<LocationRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadLocations = useCallback(async () => {
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
      "get_locations_summary",
      {
        p_search: search || null,
        p_limit: pageSize,
        p_offset: offset,
      }
    );

    if (error) {
      setLocations([]);
      setTotalCount(0);
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as LocationRow[];

    setLocations(rows);
    setTotalCount(Number(rows[0]?.total_count ?? 0));
    setLoading(false);
  }, [currentPage, router, search, supabase]);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const totalPages = Math.max(
    Math.ceil(totalCount / pageSize),
    1
  );

  const formatNumber = (
    value: number | string | null | undefined
  ) => Number(value ?? 0).toLocaleString("id-ID");

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSelectedLocation(null);
    setInventory([]);
    setCurrentPage(1);
    setSearch(searchInput.trim());
  }

  function handleReset() {
    setSearchInput("");
    setSearch("");
    setCurrentPage(1);
    setSelectedLocation(null);
    setInventory([]);
    setErrorMessage("");
  }

  async function handleSelectLocation(location: LocationRow) {
    setSelectedLocation(location);
    setInventory([]);
    setDetailLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase.rpc(
      "get_location_inventory",
      {
        p_location_id: location.location_id,
      }
    );

    if (error) {
      setErrorMessage(error.message);
      setDetailLoading(false);
      return;
    }

    setInventory(
      (data ?? []) as LocationInventoryRow[]
    );

    setDetailLoading(false);
  }

  function changePage(page: number) {
    setSelectedLocation(null);
    setInventory([]);
    setCurrentPage(page);
  }

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
                Locations
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Monitoring rack dan lokasi stok gudang
              </p>
            </header>

            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            {selectedLocation && (
              <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

                <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm text-slate-500">
                      Location Detail
                    </div>

                    <h2 className="mt-1 text-2xl font-bold">
                      {selectedLocation.location_code}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      {selectedLocation.location_name}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLocation(null);
                      setInventory([]);
                    }}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
                  >
                    Close
                  </button>
                </div>

                <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Area
                    </div>
                    <div className="mt-1 font-semibold">
                      {selectedLocation.area_code}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      SKU
                    </div>
                    <div className="mt-1 text-xl font-bold">
                      {formatNumber(selectedLocation.sku_count)}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Total Qty
                    </div>
                    <div className="mt-1 text-xl font-bold">
                      {formatNumber(selectedLocation.total_qty)}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Status
                    </div>
                    <div className="mt-1 font-semibold">
                      {selectedLocation.is_active
                        ? "Active"
                        : "Inactive"}
                    </div>
                  </div>
                </div>

                {detailLoading ? (
                  <div className="border-t border-slate-200 p-10 text-center text-sm text-slate-500">
                    Memuat detail lokasi...
                  </div>
                ) : (
                  <div className="w-full max-w-full overflow-x-auto border-t border-slate-200">
                    <table className="w-full min-w-[850px] text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-5 py-4">SKU</th>
                          <th className="px-5 py-4">Product</th>
                          <th className="px-5 py-4">Variant</th>
                          <th className="px-5 py-4 text-right">
                            Qty
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {inventory.map((item) => (
                          <tr key={item.variant_id}>
                            <td className="px-5 py-4 font-semibold">
                              {item.sku}
                            </td>

                            <td className="px-5 py-4">
                              <div>{item.product_name}</div>
                              <div className="mt-1 text-xs text-slate-400">
                                {item.product_code}
                              </div>
                            </td>

                            <td className="px-5 py-4">
                              {item.color ?? "-"} • Size{" "}
                              {item.size ?? "-"}
                            </td>

                            <td className="px-5 py-4 text-right font-bold">
                              {formatNumber(item.qty)}
                            </td>
                          </tr>
                        ))}

                        {inventory.length === 0 && (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-5 py-10 text-center text-slate-500"
                            >
                              Tidak ada stok pada lokasi ini.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

              </section>
            )}

            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <form
                onSubmit={handleSearch}
                className="flex flex-col gap-3 lg:flex-row"
              >
                <input
                  value={searchInput}
                  onChange={(event) =>
                    setSearchInput(event.target.value)
                  }
                  placeholder="Cari kode rack atau nama lokasi..."
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                />

                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white"
                >
                  Search
                </button>

                {search && (
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

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    Location List
                  </h2>

                  <p className="text-sm text-slate-500">
                    {formatNumber(totalCount)} lokasi ditemukan
                  </p>
                </div>

                <div className="text-sm text-slate-500">
                  Page {currentPage} of {totalPages}
                </div>
              </div>

              {loading ? (
                <div className="p-12 text-center text-sm text-slate-500">
                  Memuat locations...
                </div>
              ) : (
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-5 py-4">Location</th>
                        <th className="px-5 py-4">Area</th>
                        <th className="px-5 py-4">Status</th>
                        <th className="px-5 py-4 text-right">
                          SKU
                        </th>
                        <th className="px-5 py-4 text-right">
                          Qty
                        </th>
                        <th className="px-5 py-4"></th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {locations.map((location) => (
                        <tr
                          key={location.location_id}
                          className="hover:bg-slate-50"
                        >
                          <td className="px-5 py-4">
                            <div className="font-semibold">
                              {location.location_code}
                            </div>
                            <div className="text-xs text-slate-400">
                              {location.location_name}
                            </div>
                          </td>

                          <td className="px-5 py-4">
                            {location.area_code}
                          </td>

                          <td className="px-5 py-4">
                            {location.is_active
                              ? "Active"
                              : "Inactive"}
                          </td>

                          <td className="px-5 py-4 text-right">
                            {formatNumber(location.sku_count)}
                          </td>

                          <td className="px-5 py-4 text-right font-semibold">
                            {formatNumber(location.total_qty)}
                          </td>

                          <td className="px-5 py-4 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                handleSelectLocation(location)
                              }
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}

                      {locations.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-5 py-12 text-center text-slate-500"
                          >
                            Tidak ada lokasi ditemukan.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  Maksimal {pageSize} lokasi per halaman
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() =>
                      changePage(
                        Math.max(currentPage - 1, 1)
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Previous
                  </button>

                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      changePage(
                        Math.min(
                          currentPage + 1,
                          totalPages
                        )
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