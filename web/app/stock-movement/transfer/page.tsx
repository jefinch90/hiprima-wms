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
  total_qty: number;
};

type VariantRow = SearchSkuRow;

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

type TransferResult = {
  new_movement_no: number | string;
  source_qty_after: number | string;
  destination_qty_after: number | string;
};

export default function TransferStockPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<SearchSkuRow[]>([]);

  const [selectedVariant, setSelectedVariant] =
    useState<VariantRow | null>(null);

  const [sourceLocations, setSourceLocations] =
    useState<SourceLocationRow[]>([]);

  const [selectedSource, setSelectedSource] =
    useState<SourceLocationRow | null>(null);

  const [destinationLocations, setDestinationLocations] =
    useState<DestinationLocationRow[]>([]);

  const [destinationId, setDestinationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");

  const [searching, setSearching] = useState(false);
  const [loadingVariant, setLoadingVariant] = useState(false);
  const [loadingDestination, setLoadingDestination] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successResult, setSuccessResult] =
    useState<TransferResult | null>(null);

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

  const formatNumber = (
    value: number | string | null | undefined
  ) => Number(value ?? 0).toLocaleString("id-ID");

  function resetTransfer() {
    setSearchInput("");
    setSearchResults([]);
    setSelectedVariant(null);
    setSourceLocations([]);
    setSelectedSource(null);
    setDestinationLocations([]);
    setDestinationId("");
    setQuantity("");
    setReferenceNo("");
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
      "search_transfer_skus",
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

    setSearchResults((data ?? []) as SearchSkuRow[]);
    setSearching(false);
  }

  async function handleSelectVariant(
    variantId: string
  ) {
    setLoadingVariant(true);
    setErrorMessage("");
    setSuccessResult(null);

    setSelectedSource(null);
    setDestinationLocations([]);
    setDestinationId("");
    setQuantity("");

    const { data: variantData, error: variantError } =
      await supabase.rpc("get_transfer_variant", {
        p_variant_id: variantId,
      });

    if (variantError) {
      setErrorMessage(variantError.message);
      setLoadingVariant(false);
      return;
    }

    const variant =
      ((variantData ?? [])[0] as VariantRow | undefined) ??
      null;

    if (!variant) {
      setErrorMessage("SKU tidak ditemukan.");
      setLoadingVariant(false);
      return;
    }

    const { data: sourceData, error: sourceError } =
      await supabase.rpc(
        "get_transfer_source_locations",
        {
          p_variant_id: variantId,
        }
      );

    if (sourceError) {
      setErrorMessage(sourceError.message);
      setLoadingVariant(false);
      return;
    }

    setSelectedVariant(variant);
    setSourceLocations(
      (sourceData ?? []) as SourceLocationRow[]
    );

    setLoadingVariant(false);
  }

  async function handleSelectSource(
    source: SourceLocationRow
  ) {
    if (!selectedVariant) {
      return;
    }

    setSelectedSource(source);
    setDestinationId("");
    setDestinationLocations([]);
    setErrorMessage("");
    setLoadingDestination(true);

    const { data, error } = await supabase.rpc(
      "get_transfer_destination_locations",
      {
        p_variant_id: selectedVariant.variant_id,
        p_from_location_id: source.location_id,
      }
    );

    if (error) {
      setErrorMessage(error.message);
      setLoadingDestination(false);
      return;
    }

    setDestinationLocations(
      (data ?? []) as DestinationLocationRow[]
    );

    setLoadingDestination(false);
  }

  async function handleTransfer(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessResult(null);

    if (!selectedVariant || !selectedSource) {
      setErrorMessage(
        "SKU dan lokasi asal wajib dipilih."
      );
      return;
    }

    if (!destinationId) {
      setErrorMessage(
        "Lokasi tujuan wajib dipilih."
      );
      return;
    }

    const transferQty = Number(quantity);

    if (
      !Number.isInteger(transferQty) ||
      transferQty <= 0
    ) {
      setErrorMessage(
        "Quantity harus berupa angka lebih dari 0."
      );
      return;
    }

    if (
      transferQty >
      Number(selectedSource.qty_on_hand)
    ) {
      setErrorMessage(
        "Quantity melebihi stok tersedia."
      );
      return;
    }

    setTransferring(true);

    const { data, error } = await supabase.rpc(
      "transfer_stock",
      {
        p_variant_id: selectedVariant.variant_id,
        p_from_location_id:
          selectedSource.location_id,
        p_to_location_id: destinationId,
        p_quantity: transferQty,
        p_reference_no:
          referenceNo.trim() || null,
        p_notes: notes.trim() || null,
      }
    );

    if (error) {
      setErrorMessage(error.message);
      setTransferring(false);
      return;
    }

    const result =
      ((data ?? [])[0] as TransferResult | undefined) ??
      null;

    if (!result) {
      setErrorMessage(
        "Transfer berhasil diproses tetapi hasil transaksi tidak ditemukan."
      );
      setTransferring(false);
      return;
    }

    setSuccessResult(result);
    setTransferring(false);
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

            {successResult && selectedVariant && (
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
                      {selectedVariant.sku}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white p-4">
                    <div className="text-xs text-slate-500">
                      Movement No
                    </div>

                    <div className="mt-1 font-semibold">
                      #{successResult.new_movement_no}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white p-4">
                    <div className="text-xs text-slate-500">
                      Source Stock After
                    </div>

                    <div className="mt-1 font-semibold">
                      {formatNumber(
                        successResult.source_qty_after
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white p-4">
                    <div className="text-xs text-slate-500">
                      Destination Stock After
                    </div>

                    <div className="mt-1 font-semibold">
                      {formatNumber(
                        successResult.destination_qty_after
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={resetTransfer}
                    className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white"
                  >
                    Transfer Lagi
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
                  Transfer gagal
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
                      Cari SKU yang stoknya ingin dipindahkan.
                    </p>
                  </div>

                  <form
                    onSubmit={handleSearch}
                    className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
                  >
                    <input
                      value={searchInput}
                      onChange={(event) =>
                        setSearchInput(event.target.value)
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
                        onClick={resetTransfer}
                        className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-center text-sm"
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
                        {searchResults.map((item) => {
                          const active =
                            selectedVariant?.variant_id ===
                            item.variant_id;

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
                        })}
                      </div>
                    </div>
                  )}
                </section>

                {selectedVariant && (
                  <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="mb-5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        SKU Terpilih
                      </div>

                      <div className="mt-2 text-xl font-bold">
                        {selectedVariant.sku}
                      </div>

                      <div className="mt-1 text-sm text-slate-500">
                        {selectedVariant.product_name}
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Step 2
                      </div>

                      <h2 className="mt-1 text-lg font-semibold">
                        Pilih Source Rack
                      </h2>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {sourceLocations.map(
                          (location) => {
                            const active =
                              selectedSource?.location_id ===
                              location.location_id;

                            return (
                              <button
                                key={location.location_id}
                                type="button"
                                onClick={() =>
                                  handleSelectSource(
                                    location
                                  )
                                }
                                className={
                                  active
                                    ? "rounded-xl border-2 border-slate-900 bg-slate-50 p-4 text-left"
                                    : "rounded-xl border border-slate-200 p-4 text-left hover:border-slate-400 hover:bg-slate-50"
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

                                  <div className="rounded-lg bg-slate-100 px-3 py-1 text-sm font-bold">
                                    {formatNumber(
                                      location.qty_on_hand
                                    )}
                                  </div>
                                </div>

                                <div className="mt-3 text-xs text-slate-500">
                                  Area:{" "}
                                  {location.area_code}
                                </div>
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>
                  </section>
                )}

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
                        onSubmit={handleTransfer}
                        className="space-y-5"
                      >
                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Destination Rack
                          </label>

                          <select
                            required
                            value={destinationId}
                            onChange={(event) =>
                              setDestinationId(
                                event.target.value
                              )
                            }
                            disabled={loadingDestination}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500 disabled:opacity-50"
                          >
                            <option value="">
                              {loadingDestination
                                ? "Loading..."
                                : "Pilih lokasi tujuan"}
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
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Quantity
                          </label>

                          <input
                            type="number"
                            min="1"
                            max={
                              selectedSource.qty_on_hand
                            }
                            step="1"
                            required
                            value={quantity}
                            onChange={(event) =>
                              setQuantity(
                                event.target.value
                              )
                            }
                            placeholder="Masukkan qty transfer"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Reference{" "}
                            <span className="font-normal text-slate-400">
                              (optional)
                            </span>
                          </label>

                          <input
                            value={referenceNo}
                            onChange={(event) =>
                              setReferenceNo(
                                event.target.value
                              )
                            }
                            placeholder="Contoh: TRF-001"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
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
                            placeholder="Catatan transfer..."
                            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        <div className="border-t border-slate-200 pt-5">
                          <button
                            type="submit"
                            disabled={
                              transferring ||
                              destinationLocations.length ===
                                0
                            }
                            className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                          >
                            {transferring
                              ? "Processing..."
                              : "Confirm Transfer"}
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