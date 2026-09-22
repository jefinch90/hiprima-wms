import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import Sidebar from "@/components/Sidebar";
import { transferStockAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchSkuRow = {
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  total_qty: number;
};

type VariantRow = {
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  total_qty: number;
};

type SourceLocationRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  qty_on_hand: number;
};

type DestinationLocationRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  current_qty: number;
};

export default async function TransferStockPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    variant?: string;
    from?: string;
    success?: string;
    error?: string;
    sku?: string;
    movement?: string;
    source?: string;
    destination?: string;
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
  const variantId = params.variant ?? "";
  const fromLocationId = params.from ?? "";

  const success = params.success === "1";
  const errorMessage = params.error ?? "";

  const successSku = params.sku ?? "";
  const successMovement = params.movement ?? "";
  const successSource = params.source ?? "";
  const successDestination = params.destination ?? "";

  let searchResults: SearchSkuRow[] = [];
  let selectedVariant: VariantRow | null = null;
  let sourceLocations: SourceLocationRow[] = [];
  let destinationLocations: DestinationLocationRow[] = [];

  if (search && !success) {
    const { data, error } = await supabase.rpc(
      "search_transfer_skus",
      {
        p_search: search,
        p_limit: 20,
      }
    );

    if (error) {
      throw new Error(
        `Search transfer SKU error: ${error.message}`
      );
    }

    searchResults = (data ?? []) as SearchSkuRow[];
  }

  if (variantId && !success) {
    const { data, error } = await supabase.rpc(
      "get_transfer_variant",
      {
        p_variant_id: variantId,
      }
    );

    if (error) {
      throw new Error(
        `Transfer variant error: ${error.message}`
      );
    }

    selectedVariant =
      ((data ?? [])[0] as VariantRow | undefined) ?? null;

    if (!selectedVariant) {
      redirect(
        `/stock-movement/transfer?error=${encodeURIComponent(
          "SKU tidak ditemukan."
        )}`
      );
    }

    const {
      data: sourceData,
      error: sourceError,
    } = await supabase.rpc(
      "get_transfer_source_locations",
      {
        p_variant_id: variantId,
      }
    );

    if (sourceError) {
      throw new Error(
        `Transfer source location error: ${sourceError.message}`
      );
    }

    sourceLocations =
      (sourceData ?? []) as SourceLocationRow[];
  }

  if (
    variantId &&
    fromLocationId &&
    selectedVariant &&
    !success
  ) {
    const {
      data: destinationData,
      error: destinationError,
    } = await supabase.rpc(
      "get_transfer_destination_locations",
      {
        p_variant_id: variantId,
        p_from_location_id: fromLocationId,
      }
    );

    if (destinationError) {
      throw new Error(
        `Transfer destination location error: ${destinationError.message}`
      );
    }

    destinationLocations =
      (destinationData ?? []) as DestinationLocationRow[];
  }

  const selectedSource =
    sourceLocations.find(
      (location) =>
        location.location_id === fromLocationId
    ) ?? null;

  const formatNumber = (
    value: number | string | null | undefined
  ) =>
    Number(value ?? 0).toLocaleString("id-ID");

  const makeVariantUrl = (item: SearchSkuRow) => {
    const query = new URLSearchParams();

    query.set("q", search);
    query.set("variant", item.variant_id);

    return `/stock-movement/transfer?${query.toString()}`;
  };

  const makeSourceUrl = (locationId: string) => {
    const query = new URLSearchParams();

    if (search) {
      query.set("q", search);
    }

    query.set("variant", variantId);
    query.set("from", locationId);

    return `/stock-movement/transfer?${query.toString()}`;
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">
          <div className="mx-auto w-full min-w-0 max-w-[1400px]">

            {/* HEADER */}
            <header className="mb-8">
              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h1 className="text-3xl font-bold">
                    Transfer Stock
                  </h1>

                  <p className="mt-2 text-sm text-slate-500">
                    Pindahkan stok SKU antar lokasi dalam area stok yang sama
                  </p>
                </div>

                <Link
                  href="/stock-movement"
                  className="shrink-0 rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium"
                >
                  Back to Movement
                </Link>
              </div>
            </header>

            {/* SUCCESS */}
            {success && (
              <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                <div className="text-lg font-semibold text-emerald-900">
                  Transfer stock berhasil
                </div>

                <p className="mt-1 text-sm text-emerald-800">
                  Inventory dan movement history sudah diperbarui.
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl bg-white p-4">
                    <div className="text-xs text-slate-500">
                      SKU
                    </div>
                    <div className="mt-1 break-all font-semibold">
                      {successSku || "-"}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white p-4">
                    <div className="text-xs text-slate-500">
                      Movement No
                    </div>
                    <div className="mt-1 font-semibold">
                      {successMovement
                        ? `#${successMovement}`
                        : "-"}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white p-4">
                    <div className="text-xs text-slate-500">
                      Source Stock After
                    </div>
                    <div className="mt-1 font-semibold">
                      {successSource
                        ? formatNumber(successSource)
                        : "-"}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white p-4">
                    <div className="text-xs text-slate-500">
                      Destination Stock After
                    </div>
                    <div className="mt-1 font-semibold">
                      {successDestination
                        ? formatNumber(
                            successDestination
                          )
                        : "-"}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/stock-movement/transfer"
                    className="rounded-xl bg-slate-900 px-5 py-3 text-center text-sm font-medium text-white"
                  >
                    Transfer Lagi
                  </Link>

                  <Link
                    href={
                      successSku
                        ? `/stock-movement?q=${encodeURIComponent(
                            successSku
                          )}`
                        : "/stock-movement"
                    }
                    className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium"
                  >
                    Lihat Movement
                  </Link>
                </div>
              </section>
            )}

            {/* ERROR */}
            {errorMessage && !success && (
              <section className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5">
                <div className="font-semibold text-red-800">
                  Transfer gagal
                </div>

                <div className="mt-1 break-words text-sm text-red-700">
                  {errorMessage}
                </div>
              </section>
            )}

            {!success && (
              <>
                {/* STEP 1 */}
                <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Step 1
                    </div>

                    <h2 className="mt-1 text-lg font-semibold">
                      Cari SKU
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      Cari SKU yang stoknya ingin dipindahkan.
                    </p>
                  </div>

                  <form
                    action="/stock-movement/transfer"
                    method="GET"
                    className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
                  >
                    <input
                      type="text"
                      name="q"
                      defaultValue={search}
                      placeholder="Contoh: T290Butter"
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                    />

                    <button
                      type="submit"
                      className="shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white"
                    >
                      Search SKU
                    </button>

                    {(search ||
                      variantId ||
                      fromLocationId) && (
                      <Link
                        href="/stock-movement/transfer"
                        className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-center text-sm"
                      >
                        Reset
                      </Link>
                    )}
                  </form>

                  {search && (
                    <div className="mt-6">
                      <div className="mb-3 text-sm text-slate-500">
                        {formatNumber(
                          searchResults.length
                        )}{" "}
                        SKU ditemukan
                      </div>

                      {searchResults.length > 0 ? (
                        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                          {searchResults.map((item) => {
                            const active =
                              item.variant_id ===
                              variantId;

                            return (
                              <div
                                key={item.variant_id}
                                className={
                                  active
                                    ? "flex flex-col gap-4 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                                    : "flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                                }
                              >
                                <div className="min-w-0">
                                  <div className="break-all font-semibold">
                                    {item.sku}
                                  </div>

                                  <div className="mt-1 break-words text-sm">
                                    {item.product_name}
                                  </div>

                                  <div className="mt-1 text-xs text-slate-500">
                                    {item.product_code}
                                    {" • "}
                                    {item.color ?? "-"}
                                    {" • "}
                                    Size {item.size ?? "-"}
                                  </div>

                                  <div className="mt-2 text-xs text-slate-500">
                                    Total stock:{" "}
                                    <span className="font-semibold text-slate-900">
                                      {formatNumber(
                                        item.total_qty
                                      )}
                                    </span>
                                  </div>
                                </div>

                                {active ? (
                                  <span className="shrink-0 rounded-xl bg-slate-200 px-4 py-2 text-center text-sm font-medium">
                                    Selected
                                  </span>
                                ) : (
                                  <Link
                                    href={makeVariantUrl(
                                      item
                                    )}
                                    className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-center text-sm font-medium hover:bg-slate-50"
                                  >
                                    Pilih SKU
                                  </Link>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                          SKU tidak ditemukan.
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* SELECTED SKU + SOURCE */}
                {selectedVariant && (
                  <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="mb-5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        SKU Terpilih
                      </div>

                      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="break-all text-xl font-bold">
                            {selectedVariant.sku}
                          </div>

                          <div className="mt-1 break-words text-sm">
                            {selectedVariant.product_name}
                          </div>

                          <div className="mt-1 text-sm text-slate-500">
                            {selectedVariant.product_code}
                            {" • "}
                            {selectedVariant.brand ?? "-"}
                            {" • "}
                            {selectedVariant.color ?? "-"}
                            {" • "}
                            Size{" "}
                            {selectedVariant.size ?? "-"}
                          </div>
                        </div>

                        <div className="shrink-0 rounded-xl bg-slate-50 px-4 py-3">
                          <div className="text-xs text-slate-500">
                            Total Stock
                          </div>

                          <div className="mt-1 text-xl font-bold">
                            {formatNumber(
                              selectedVariant.total_qty
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Step 2
                      </div>

                      <h2 className="mt-1 text-lg font-semibold">
                        Pilih Source Rack
                      </h2>

                      <p className="mt-1 text-sm text-slate-500">
                        Hanya lokasi yang memiliki stok yang dapat dipilih.
                      </p>

                      {sourceLocations.length > 0 ? (
                        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {sourceLocations.map(
                            (location) => {
                              const active =
                                location.location_id ===
                                fromLocationId;

                              return (
                                <Link
                                  key={
                                    location.location_id
                                  }
                                  href={makeSourceUrl(
                                    location.location_id
                                  )}
                                  className={
                                    active
                                      ? "rounded-xl border-2 border-slate-900 bg-slate-50 p-4"
                                      : "rounded-xl border border-slate-200 p-4 hover:border-slate-400 hover:bg-slate-50"
                                  }
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="font-semibold">
                                        {
                                          location.location_code
                                        }
                                      </div>

                                      <div className="mt-1 text-xs text-slate-500">
                                        {
                                          location.location_name
                                        }
                                      </div>
                                    </div>

                                    <div className="shrink-0 rounded-lg bg-slate-100 px-3 py-1 text-sm font-bold">
                                      {formatNumber(
                                        location.qty_on_hand
                                      )}
                                    </div>
                                  </div>

                                  <div className="mt-3 text-xs text-slate-500">
                                    Area:{" "}
                                    {location.area_code}
                                  </div>
                                </Link>
                              );
                            }
                          )}
                        </div>
                      ) : (
                        <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                          SKU ini tidak memiliki stok pada lokasi aktif.
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* STEP 3 */}
                {selectedVariant &&
                  selectedSource && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="mb-6">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Step 3
                        </div>

                        <h2 className="mt-1 text-lg font-semibold">
                          Detail Transfer
                        </h2>

                        <p className="mt-1 text-sm text-slate-500">
                          Tentukan lokasi tujuan dan jumlah stok.
                        </p>
                      </div>

                      <div className="mb-6 grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-4">
                          <div className="text-xs text-slate-500">
                            Source
                          </div>

                          <div className="mt-1 font-semibold">
                            {
                              selectedSource.location_code
                            }
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            {
                              selectedSource.location_name
                            }
                            {" • "}
                            {selectedSource.area_code}
                          </div>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-4">
                          <div className="text-xs text-slate-500">
                            Available Stock
                          </div>

                          <div className="mt-1 text-xl font-bold">
                            {formatNumber(
                              selectedSource.qty_on_hand
                            )}
                          </div>
                        </div>
                      </div>

                      <form
                        action={transferStockAction}
                        className="space-y-5"
                      >
                        <input
                          type="hidden"
                          name="variant_id"
                          value={
                            selectedVariant.variant_id
                          }
                        />

                        <input
                          type="hidden"
                          name="from_location_id"
                          value={
                            selectedSource.location_id
                          }
                        />

                        <input
                          type="hidden"
                          name="sku"
                          value={
                            selectedVariant.sku
                          }
                        />

                        <div>
                          <label
                            htmlFor="to_location_id"
                            className="mb-2 block text-sm font-medium"
                          >
                            Destination Rack
                          </label>

                          <select
                            id="to_location_id"
                            name="to_location_id"
                            required
                            defaultValue=""
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500"
                          >
                            <option
                              value=""
                              disabled
                            >
                              Pilih lokasi tujuan
                            </option>

                            {destinationLocations.map(
                              (location) => (
                                <option
                                  key={
                                    location.location_id
                                  }
                                  value={
                                    location.location_id
                                  }
                                >
                                  {
                                    location.location_code
                                  }{" "}
                                  —{" "}
                                  {
                                    location.location_name
                                  }{" "}
                                  | Stock:{" "}
                                  {formatNumber(
                                    location.current_qty
                                  )}
                                </option>
                              )
                            )}
                          </select>

                          <p className="mt-2 text-xs text-slate-500">
                            Hanya lokasi aktif dalam area{" "}
                            <span className="font-medium">
                              {selectedSource.area_code}
                            </span>{" "}
                            yang ditampilkan.
                          </p>
                        </div>

                        <div>
                          <label
                            htmlFor="quantity"
                            className="mb-2 block text-sm font-medium"
                          >
                            Quantity
                          </label>

                          <input
                            id="quantity"
                            name="quantity"
                            type="number"
                            min="1"
                            max={
                              selectedSource.qty_on_hand
                            }
                            step="1"
                            required
                            placeholder="Masukkan qty transfer"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />

                          <p className="mt-2 text-xs text-slate-500">
                            Maksimal{" "}
                            {formatNumber(
                              selectedSource.qty_on_hand
                            )}{" "}
                            pcs.
                          </p>
                        </div>

                        <div>
                          <label
                            htmlFor="reference_no"
                            className="mb-2 block text-sm font-medium"
                          >
                            Reference
                            <span className="ml-1 font-normal text-slate-400">
                              (optional)
                            </span>
                          </label>

                          <input
                            id="reference_no"
                            name="reference_no"
                            type="text"
                            placeholder="Contoh: TRF-001"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="notes"
                            className="mb-2 block text-sm font-medium"
                          >
                            Notes
                            <span className="ml-1 font-normal text-slate-400">
                              (optional)
                            </span>
                          </label>

                          <textarea
                            id="notes"
                            name="notes"
                            rows={4}
                            placeholder="Catatan transfer..."
                            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        <div className="border-t border-slate-200 pt-5">
                          {destinationLocations.length >
                          0 ? (
                            <button
                              type="submit"
                              className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white sm:w-auto"
                            >
                              Confirm Transfer
                            </button>
                          ) : (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                              Tidak ada lokasi tujuan aktif lain di area ini.
                            </div>
                          )}
                        </div>
                      </form>
                    </section>
                  )}
              </>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}