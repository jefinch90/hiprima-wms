"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type SearchSkuRow = {
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  total_qty: number | string;
};

type VariantRow = SearchSkuRow;

type LocationRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  current_qty: number | string;
};

type AdjustmentResult = {
  new_movement_no: number | string;
  adjustment_type: string;
  system_qty_before: number | string;
  physical_qty_after: number | string;
  adjustment_qty: number | string;
};

export default function StockAdjustmentPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<
    SearchSkuRow[]
  >([]);

  const [selectedVariant, setSelectedVariant] =
    useState<VariantRow | null>(null);

  const [locations, setLocations] = useState<
    LocationRow[]
  >([]);

  const [selectedLocationId, setSelectedLocationId] =
    useState("");

  const [physicalQty, setPhysicalQty] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const [searching, setSearching] = useState(false);
  const [loadingVariant, setLoadingVariant] =
    useState(false);
  const [processing, setProcessing] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

  const [successResult, setSuccessResult] =
    useState<AdjustmentResult | null>(null);

  useEffect(() => {
    async function checkAuth() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
      }
    }

    checkAuth();
  }, [router, supabase]);

  const selectedLocation =
    locations.find(
      (location) =>
        location.location_id === selectedLocationId
    ) ?? null;

  const systemQty = selectedLocation
    ? Number(selectedLocation.current_qty)
    : 0;

  const parsedPhysicalQty =
    physicalQty.trim() === ""
      ? null
      : Number(physicalQty);

  const difference =
    parsedPhysicalQty !== null &&
    Number.isInteger(parsedPhysicalQty) &&
    parsedPhysicalQty >= 0
      ? parsedPhysicalQty - systemQty
      : null;

  const adjustmentType =
    difference === null || difference === 0
      ? null
      : difference > 0
        ? "adjustment_in"
        : "adjustment_out";

  const adjustmentQty =
    difference === null
      ? 0
      : Math.abs(difference);

  const formatNumber = (
    value: number | string | null | undefined
  ) => Number(value ?? 0).toLocaleString("id-ID");

  function resetAdjustment() {
    setSearchInput("");
    setSearchResults([]);
    setSelectedVariant(null);
    setLocations([]);
    setSelectedLocationId("");
    setPhysicalQty("");
    setReferenceNo("");
    setReason("");
    setNotes("");
    setErrorMessage("");
    setSuccessResult(null);
  }

  async function handleSearch(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const search = searchInput.trim();

    setErrorMessage("");
    setSuccessResult(null);

    if (!search) {
      setSearchResults([]);
      return;
    }

    setSearching(true);

    const { data, error } = await supabase.rpc(
      "search_adjustment_skus",
      {
        p_search: search,
        p_limit: 20,
      }
    );

    if (error) {
      setErrorMessage(error.message);
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearchResults(
      (data ?? []) as SearchSkuRow[]
    );

    setSearching(false);
  }

  async function handleSelectVariant(
    variantId: string
  ) {
    setLoadingVariant(true);
    setErrorMessage("");
    setSuccessResult(null);

    setSelectedLocationId("");
    setPhysicalQty("");
    setReferenceNo("");
    setReason("");
    setNotes("");
    setLocations([]);

    const {
      data: variantData,
      error: variantError,
    } = await supabase.rpc(
      "get_adjustment_variant",
      {
        p_variant_id: variantId,
      }
    );

    if (variantError) {
      setErrorMessage(variantError.message);
      setLoadingVariant(false);
      return;
    }

    const variant =
      ((variantData ?? [])[0] as
        | VariantRow
        | undefined) ?? null;

    if (!variant) {
      setErrorMessage("SKU tidak ditemukan.");
      setLoadingVariant(false);
      return;
    }

    const {
      data: locationData,
      error: locationError,
    } = await supabase.rpc(
      "get_adjustment_locations",
      {
        p_variant_id: variantId,
      }
    );

    if (locationError) {
      setErrorMessage(locationError.message);
      setLoadingVariant(false);
      return;
    }

    setSelectedVariant(variant);

    setLocations(
      (locationData ?? []) as LocationRow[]
    );

    setLoadingVariant(false);
  }

  function handleSelectLocation(
    locationId: string
  ) {
    setSelectedLocationId(locationId);
    setPhysicalQty("");
    setErrorMessage("");
    setSuccessResult(null);
  }

  async function handleAdjustment(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessResult(null);

    if (!selectedVariant) {
      setErrorMessage("SKU wajib dipilih.");
      return;
    }

    if (!selectedLocation) {
      setErrorMessage("Lokasi wajib dipilih.");
      return;
    }

    if (
      parsedPhysicalQty === null ||
      !Number.isInteger(parsedPhysicalQty) ||
      parsedPhysicalQty < 0
    ) {
      setErrorMessage(
        "Stok fisik harus berupa angka 0 atau lebih."
      );
      return;
    }

    if (difference === 0) {
      setErrorMessage(
        "Tidak ada selisih. Stok sistem dan stok fisik sama."
      );
      return;
    }

    if (!referenceNo.trim()) {
      setErrorMessage(
        "Reference wajib diisi."
      );
      return;
    }

    if (!reason.trim()) {
      setErrorMessage(
        "Alasan adjustment wajib diisi."
      );
      return;
    }

    const direction =
      difference !== null && difference > 0
        ? "ADJUSTMENT IN"
        : "ADJUSTMENT OUT";

    const confirmed = window.confirm(
      [
        "Konfirmasi Stock Adjustment",
        "",
        `SKU: ${selectedVariant.sku}`,
        `Lokasi: ${selectedLocation.location_code}`,
        `Stok sistem: ${formatNumber(systemQty)}`,
        `Stok fisik: ${formatNumber(parsedPhysicalQty)}`,
        `${direction}: ${formatNumber(adjustmentQty)} pcs`,
        "",
        "Lanjutkan adjustment?",
      ].join("\n")
    );

    if (!confirmed) {
      return;
    }

    setProcessing(true);

    const { data, error } = await supabase.rpc(
      "adjust_stock_to_physical",
      {
        p_variant_id:
          selectedVariant.variant_id,
        p_location_id:
          selectedLocation.location_id,
        p_physical_qty:
          parsedPhysicalQty,
        p_reference_no:
          referenceNo.trim(),
        p_reason:
          reason.trim(),
        p_notes:
          notes.trim() || null,
      }
    );

    if (error) {
      setErrorMessage(error.message);
      setProcessing(false);
      return;
    }

    const result =
      ((data ?? [])[0] as
        | AdjustmentResult
        | undefined) ?? null;

    if (!result) {
      setErrorMessage(
        "Adjustment berhasil diproses tetapi hasil transaksi tidak ditemukan."
      );
      setProcessing(false);
      return;
    }

    setSuccessResult(result);
    setProcessing(false);
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
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
                    Stock Adjustment
                  </h1>

                  <p className="mt-2 text-sm text-slate-500">
                    Sesuaikan stok sistem berdasarkan
                    hasil stok fisik aktual
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

            {successResult &&
              selectedVariant &&
              selectedLocation && (
                <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                  <div className="text-lg font-semibold text-emerald-900">
                    Stock adjustment berhasil
                  </div>

                  <p className="mt-1 text-sm text-emerald-800">
                    Inventory dan movement history sudah
                    diperbarui.
                  </p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        SKU
                      </div>

                      <div className="mt-1 break-all font-semibold">
                        {selectedVariant.sku}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Movement
                      </div>

                      <div className="mt-1 font-semibold">
                        #{successResult.new_movement_no}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Type
                      </div>

                      <div className="mt-1 font-semibold">
                        {successResult.adjustment_type ===
                        "adjustment_in"
                          ? "Adjustment In"
                          : "Adjustment Out"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Before
                      </div>

                      <div className="mt-1 font-semibold">
                        {formatNumber(
                          successResult.system_qty_before
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        After
                      </div>

                      <div className="mt-1 font-semibold">
                        {formatNumber(
                          successResult.physical_qty_after
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={resetAdjustment}
                      className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white"
                    >
                      Adjustment Lagi
                    </button>

                    <Link
                      href="/stock-movement"
                      className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium"
                    >
                      Lihat Movement
                    </Link>
                  </div>
                </section>
              )}

            {errorMessage && (
              <section className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5">
                <div className="font-semibold text-red-800">
                  Adjustment gagal
                </div>

                <div className="mt-1 break-words text-sm text-red-700">
                  {errorMessage}
                </div>
              </section>
            )}

            {!successResult && (
              <>
                <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Step 1
                    </div>

                    <h2 className="mt-1 text-lg font-semibold">
                      Cari SKU
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      Cari SKU yang akan disesuaikan
                      berdasarkan hasil stock opname.
                    </p>
                  </div>

                  <form
                    onSubmit={handleSearch}
                    className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
                  >
                    <input
                      value={searchInput}
                      onChange={(event) =>
                        setSearchInput(
                          event.target.value
                        )
                      }
                      placeholder="Contoh: T290Butter"
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                    />

                    <button
                      type="submit"
                      disabled={searching}
                      className="shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {searching
                        ? "Searching..."
                        : "Search SKU"}
                    </button>

                    {(searchInput ||
                      selectedVariant) && (
                      <button
                        type="button"
                        onClick={resetAdjustment}
                        className="shrink-0 rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm"
                      >
                        Reset
                      </button>
                    )}
                  </form>

                  {searchResults.length > 0 && (
                    <div className="mt-6">
                      <div className="mb-3 text-sm text-slate-500">
                        {formatNumber(
                          searchResults.length
                        )}{" "}
                        SKU ditemukan
                      </div>

                      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                        {searchResults.map(
                          (item) => {
                            const active =
                              selectedVariant?.variant_id ===
                              item.variant_id;

                            return (
                              <div
                                key={
                                  item.variant_id
                                }
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
                                    {
                                      item.product_name
                                    }
                                  </div>

                                  <div className="mt-1 text-xs text-slate-500">
                                    {
                                      item.product_code
                                    }
                                    {" • "}
                                    {item.color ?? "-"}
                                    {" • "}
                                    Size{" "}
                                    {item.size ?? "-"}
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

                                <button
                                  type="button"
                                  disabled={
                                    active ||
                                    loadingVariant
                                  }
                                  onClick={() =>
                                    handleSelectVariant(
                                      item.variant_id
                                    )
                                  }
                                  className={
                                    active
                                      ? "shrink-0 rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium"
                                      : "shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                                  }
                                >
                                  {active
                                    ? "Selected"
                                    : "Pilih SKU"}
                                </button>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  )}
                </section>

                {selectedVariant && (
                  <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        SKU Terpilih
                      </div>

                      <div className="mt-2 break-all text-xl font-bold">
                        {selectedVariant.sku}
                      </div>

                      <div className="mt-1 text-sm text-slate-500">
                        {
                          selectedVariant.product_name
                        }
                      </div>

                      <div className="mt-3 inline-flex rounded-lg bg-slate-100 px-3 py-2 text-sm">
                        Total stock:{" "}
                        <span className="ml-1 font-semibold">
                          {formatNumber(
                            selectedVariant.total_qty
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="mt-6 border-t border-slate-200 pt-5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Step 2
                      </div>

                      <h2 className="mt-1 text-lg font-semibold">
                        Pilih Lokasi
                      </h2>

                      <p className="mt-1 text-sm text-slate-500">
                        Pilih rack yang sedang dilakukan
                        stock opname.
                      </p>

                      <div className="mt-5">
                        <select
                          value={selectedLocationId}
                          onChange={(event) =>
                            handleSelectLocation(
                              event.target.value
                            )
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500"
                        >
                          <option value="">
                            Pilih lokasi
                          </option>

                          {locations.map(
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
                                |{" "}
                                {
                                  location.area_code
                                }{" "}
                                | Stock:{" "}
                                {formatNumber(
                                  location.current_qty
                                )}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    </div>
                  </section>
                )}

                {selectedVariant &&
                  selectedLocation && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="mb-6">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Step 3
                        </div>

                        <h2 className="mt-1 text-lg font-semibold">
                          Stock Opname
                        </h2>

                        <p className="mt-1 text-sm text-slate-500">
                          Masukkan jumlah stok fisik
                          aktual yang ditemukan di rack.
                        </p>
                      </div>

                      <div className="mb-6 grid gap-4 sm:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-4">
                          <div className="text-xs text-slate-500">
                            Location
                          </div>

                          <div className="mt-1 font-semibold">
                            {
                              selectedLocation.location_code
                            }
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            {
                              selectedLocation.area_code
                            }
                          </div>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-4">
                          <div className="text-xs text-slate-500">
                            System Stock
                          </div>

                          <div className="mt-1 text-xl font-bold">
                            {formatNumber(
                              systemQty
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-4">
                          <div className="text-xs text-slate-500">
                            Physical Stock
                          </div>

                          <div className="mt-1 text-xl font-bold">
                            {parsedPhysicalQty === null
                              ? "-"
                              : formatNumber(
                                  parsedPhysicalQty
                                )}
                          </div>
                        </div>
                      </div>

                      <form
                        onSubmit={handleAdjustment}
                        className="space-y-5"
                      >
                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Stok Fisik Aktual
                            <span className="ml-1 text-red-500">
                              *
                            </span>
                          </label>

                          <input
                            type="number"
                            min="0"
                            step="1"
                            required
                            value={physicalQty}
                            onChange={(event) =>
                              setPhysicalQty(
                                event.target.value
                              )
                            }
                            placeholder="Masukkan hasil hitung fisik"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        {difference !== null && (
                          <div
                            className={
                              difference === 0
                                ? "rounded-xl border border-slate-200 bg-slate-50 p-5"
                                : difference > 0
                                  ? "rounded-xl border border-emerald-200 bg-emerald-50 p-5"
                                  : "rounded-xl border border-amber-200 bg-amber-50 p-5"
                            }
                          >
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Hasil Perhitungan
                            </div>

                            {difference === 0 ? (
                              <div className="mt-2 font-semibold text-slate-900">
                                Tidak ada selisih stok
                              </div>
                            ) : (
                              <>
                                <div className="mt-2 text-lg font-bold">
                                  {difference > 0
                                    ? "Adjustment In"
                                    : "Adjustment Out"}
                                </div>

                                <div className="mt-1 text-sm">
                                  Selisih:{" "}
                                  <span className="font-bold">
                                    {formatNumber(
                                      adjustmentQty
                                    )}{" "}
                                    pcs
                                  </span>
                                </div>

                                <div className="mt-1 text-sm text-slate-600">
                                  {formatNumber(
                                    systemQty
                                  )}{" "}
                                  →{" "}
                                  {formatNumber(
                                    parsedPhysicalQty
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Reference
                            <span className="ml-1 text-red-500">
                              *
                            </span>
                          </label>

                          <input
                            required
                            value={referenceNo}
                            onChange={(event) =>
                              setReferenceNo(
                                event.target.value
                              )
                            }
                            placeholder="Contoh: SO-2026-001"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Alasan Adjustment
                            <span className="ml-1 text-red-500">
                              *
                            </span>
                          </label>

                          <select
                            required
                            value={reason}
                            onChange={(event) =>
                              setReason(
                                event.target.value
                              )
                            }
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500"
                          >
                            <option value="">
                              Pilih alasan
                            </option>

                            <option value="Stock opname">
                              Stock opname
                            </option>

                            <option value="Selisih fisik">
                              Selisih fisik
                            </option>

                            <option value="Kesalahan pencatatan">
                              Kesalahan pencatatan
                            </option>

                            <option value="Barang ditemukan">
                              Barang ditemukan
                            </option>

                            <option value="Koreksi inventory">
                              Koreksi inventory
                            </option>
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Notes{" "}
                            <span className="font-normal text-slate-400">
                              (optional)
                            </span>
                          </label>

                          <textarea
                            rows={4}
                            value={notes}
                            onChange={(event) =>
                              setNotes(
                                event.target.value
                              )
                            }
                            placeholder="Tambahkan keterangan jika diperlukan..."
                            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        <div className="border-t border-slate-200 pt-5">
                          <button
                            type="submit"
                            disabled={
                              processing ||
                              difference === null ||
                              difference === 0
                            }
                            className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-40 sm:w-auto"
                          >
                            {processing
                              ? "Processing..."
                              : "Confirm Adjustment"}
                          </button>
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