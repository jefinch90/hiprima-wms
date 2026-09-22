import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import Sidebar from "@/components/Sidebar";

export const dynamic = "force-dynamic";

type LocationRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  is_active: boolean;
  sku_count: number;
  total_qty: number;
  total_count: number;
};

type LocationInventoryRow = {
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  qty: number;
};

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    location?: string;
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
  const locationId =
    params.location ?? "";

  const currentPage = Math.max(
    Number(params.page ?? "1") || 1,
    1
  );

  const pageSize = 50;
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
    throw new Error(
      `Locations error: ${error.message}`
    );
  }

  const locations =
    (data ?? []) as LocationRow[];

  const totalCount = Number(
    locations[0]?.total_count ?? 0
  );

  const totalPages = Math.max(
    Math.ceil(totalCount / pageSize),
    1
  );

  let selectedLocation:
    | LocationRow
    | null = null;

  let locationInventory:
    LocationInventoryRow[] = [];

  if (locationId) {
    selectedLocation =
      locations.find(
        (item) =>
          item.location_id === locationId
      ) ?? null;

    if (!selectedLocation) {
      const { data: locationData } =
        await supabase
          .from("locations")
          .select(`
            id,
            code,
            name,
            is_active,
            stock_areas (
              code,
              name
            )
          `)
          .eq("id", locationId)
          .single();

      if (locationData) {
        const area = Array.isArray(
          locationData.stock_areas
        )
          ? locationData.stock_areas[0]
          : locationData.stock_areas;

        selectedLocation = {
          location_id: locationData.id,
          location_code:
            locationData.code,
          location_name:
            locationData.name,
          area_code:
            area?.code ?? "-",
          area_name:
            area?.name ?? "-",
          is_active:
            locationData.is_active,
          sku_count: 0,
          total_qty: 0,
          total_count: 0,
        };
      }
    }

    const {
      data: inventoryData,
      error: inventoryError,
    } = await supabase.rpc(
      "get_location_inventory",
      {
        p_location_id: locationId,
      }
    );

    if (inventoryError) {
      throw new Error(
        `Location inventory error: ${inventoryError.message}`
      );
    }

    locationInventory =
      (inventoryData ??
        []) as LocationInventoryRow[];
  }

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

    return `/locations?${query.toString()}`;
  };

  const detailTotalQty =
    locationInventory.reduce(
      (total, item) =>
        total +
        Number(item.qty ?? 0),
      0
    );

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
                Locations
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Monitoring lokasi rak dan isi stok gudang
              </p>
            </header>

            {selectedLocation && (
              <section className="mb-6 w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-500">
                      Location Detail
                    </div>

                    <h2 className="mt-1 text-2xl font-bold">
                      {selectedLocation.location_code}
                    </h2>

                    <div className="mt-1 text-sm text-slate-500">
                      {selectedLocation.location_name}
                    </div>
                  </div>

                  <Link
                    href="/locations"
                    className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-center text-sm"
                  >
                    Close
                  </Link>
                </div>

                <div className="mb-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">
                      Area
                    </div>

                    <div className="mt-2 font-semibold">
                      {selectedLocation.area_code}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">
                      SKU
                    </div>

                    <div className="mt-2 text-xl font-bold">
                      {formatNumber(
                        locationInventory.length
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">
                      Total Qty
                    </div>

                    <div className="mt-2 text-xl font-bold">
                      {formatNumber(
                        detailTotalQty
                      )}
                    </div>
                  </div>
                </div>

                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full text-left text-sm">

                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-3">
                          SKU
                        </th>

                        <th className="px-4 py-3">
                          Product
                        </th>

                        <th className="px-4 py-3">
                          Variant
                        </th>

                        <th className="px-4 py-3 text-right">
                          Qty
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {locationInventory.map(
                        (item) => (
                          <tr
                            key={
                              item.variant_id
                            }
                            className="hover:bg-slate-50"
                          >
                            <td className="px-4 py-3 font-semibold">
                              {item.sku}
                            </td>

                            <td className="px-4 py-3">
                              <div>
                                {item.product_name}
                              </div>

                              <div className="text-xs text-slate-400">
                                {item.product_code}
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              {item.color ?? "-"} /{" "}
                              {item.size ?? "-"}
                            </td>

                            <td className="px-4 py-3 text-right font-bold">
                              {formatNumber(
                                item.qty
                              )}
                            </td>
                          </tr>
                        )
                      )}

                      {locationInventory.length ===
                        0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-10 text-center text-slate-500"
                          >
                            Tidak ada stok di lokasi ini.
                          </td>
                        </tr>
                      )}
                    </tbody>

                  </table>
                </div>

              </section>
            )}

            <section className="mb-6 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <form
                action="/locations"
                method="GET"
                className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
              >
                <input
                  name="q"
                  defaultValue={search}
                  placeholder="Cari kode rak, nama lokasi, NORMAL, DEFECT..."
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
                    href="/locations"
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
                    Location List
                  </h2>

                  <p className="text-sm text-slate-500">
                    {formatNumber(totalCount)} lokasi ditemukan
                  </p>
                </div>

                <div className="shrink-0 text-sm text-slate-500">
                  Page {currentPage} of {totalPages}
                </div>
              </div>

              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full text-left text-sm">

                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-5 py-4">
                        Location
                      </th>

                      <th className="px-5 py-4">
                        Area
                      </th>

                      <th className="px-5 py-4 text-right">
                        SKU
                      </th>

                      <th className="px-5 py-4 text-right">
                        Qty
                      </th>

                      <th className="px-5 py-4">
                        Status
                      </th>

                      <th className="px-5 py-4"></th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {locations.map(
                      (location) => (
                        <tr
                          key={
                            location.location_id
                          }
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

                          <td className="px-5 py-4 text-right">
                            {formatNumber(
                              location.sku_count
                            )}
                          </td>

                          <td className="px-5 py-4 text-right font-semibold">
                            {formatNumber(
                              location.total_qty
                            )}
                          </td>

                          <td className="px-5 py-4">
                            {location.is_active
                              ? "Active"
                              : "Inactive"}
                          </td>

                          <td className="px-5 py-4 text-right">
                            <Link
                              href={`/locations?location=${location.location_id}`}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      )
                    )}

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

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  Menampilkan maksimal {pageSize} lokasi per halaman
                </div>

                <div className="flex shrink-0 gap-2">
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