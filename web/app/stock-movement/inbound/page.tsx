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

type QcResult = "NORMAL" | "DEFECT" | "REJECT";

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

type DestinationLocationRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  current_qty: number;
};

type InboundResult = {
  new_movement_no: number | string;
  destination_qty_after: number | string;
};

const qcOptions: {
  code: QcResult;
  title: string;
  description: string;
}[] = [
  {
    code: "NORMAL",
    title: "Normal",
    description: "QC pass / siap jual",
  },
  {
    code: "DEFECT",
    title: "Defect",
    description: "Ada cacat tetapi masih tercatat sebagai stok",
  },
  {
    code: "REJECT",
    title: "Reject",
    description: "Tidak lolos QC / dipisahkan",
  },
];

export default function InboundStockPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<
    SearchSkuRow[]
  >([]);

  const [selectedVariant, setSelectedVariant] =
    useState<VariantRow | null>(null);

  const [qcResult, setQcResult] =
    useState<QcResult | "">("");

  const [destinationLocations, setDestinationLocations] =
    useState<DestinationLocationRow[]>([]);

  const [destinationId, setDestinationId] =
    useState("");

  const [quantity, setQuantity] = useState("");
  const [referenceNo, setReferenceNo] =
    useState("");
  const [notes, setNotes] = useState("");

  const [searching, setSearching] = useState(false);
  const [loadingVariant, setLoadingVariant] =
    useState(false);
  const [loadingLocations, setLoadingLocations] =
    useState(false);
  const [receiving, setReceiving] = useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [successResult, setSuccessResult] =
    useState<InboundResult | null>(null);

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

  const selectedDestination =
    destinationLocations.find(
      (location) =>
        location.location_id === destinationId
    ) ?? null;

  function resetInbound() {
    setSearchInput("");
    setSearchResults([]);
    setSelectedVariant(null);
    setQcResult("");
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
      "search_inbound_skus",
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

    setQcResult("");
    setDestinationLocations([]);
    setDestinationId("");
    setQuantity("");

    const {
      data: variantData,
      error: variantError,
    } = await supabase.rpc(
      "get_inbound_variant",
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

    setSelectedVariant(variant);
    setLoadingVariant(false);
  }

  async function handleSelectQc(
    selectedQc: QcResult
  ) {
    if (!selectedVariant) {
      return;
    }

    setQcResult(selectedQc);
    setDestinationId("");
    setDestinationLocations([]);
    setErrorMessage("");
    setLoadingLocations(true);

    const { data, error } = await supabase.rpc(
      "get_inbound_destination_locations",
      {
        p_variant_id:
          selectedVariant.variant_id,
        p_area_code: selectedQc,
      }
    );

    if (error) {
      setErrorMessage(error.message);
      setLoadingLocations(false);
      return;
    }

    setDestinationLocations(
      (data ?? []) as DestinationLocationRow[]
    );

    setLoadingLocations(false);
  }

  async function handleInbound(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessResult(null);

    if (!selectedVariant) {
      setErrorMessage("SKU wajib dipilih.");
      return;
    }

    if (!qcResult) {
      setErrorMessage(
        "QC Result wajib dipilih."
      );
      return;
    }

    if (!destinationId) {
      setErrorMessage(
        "Lokasi tujuan wajib dipilih."
      );
      return;
    }

    const inboundQty = Number(quantity);

    if (
      !Number.isInteger(inboundQty) ||
      inboundQty <= 0
    ) {
      setErrorMessage(
        "Quantity harus berupa angka lebih dari 0."
      );
      return;
    }

    setReceiving(true);

    const { data, error } = await supabase.rpc(
      "receive_inbound_stock",
      {
        p_variant_id:
          selectedVariant.variant_id,
        p_to_location_id: destinationId,
        p_quantity: inboundQty,
        p_reference_no:
          referenceNo.trim() || null,
        p_notes: notes.trim() || null,
      }
    );

    if (error) {
      setErrorMessage(error.message);
      setReceiving(false);
      return;
    }

    const result =
      ((data ?? [])[0] as
        | InboundResult
        | undefined) ?? null;

    if (!result) {
      setErrorMessage(
        "Inbound berhasil diproses tetapi hasil transaksi tidak ditemukan."
      );
      setReceiving(false);
      return;
    }

    setSuccessResult(result);
    setReceiving(false);
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
                    Inbound Stock
                  </h1>

                  <p className="mt-2 text-sm text-slate-500">
                    Terima barang masuk, lakukan QC,
                    lalu tempatkan ke area stok yang
                    sesuai
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
              selectedVariant && (
                <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                  <div className="text-lg font-semibold text-emerald-900">
                    Inbound stock berhasil
                  </div>

                  <p className="mt-1 text-sm text-emerald-800">
                    Inventory dan movement history
                    sudah diperbarui.
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
                        QC Result
                      </div>

                      <div className="mt-1 font-semibold">
                        {qcResult}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Destination
                      </div>

                      <div className="mt-1 font-semibold">
                        {selectedDestination
                          ?.location_code ?? "-"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Stock After
                      </div>

                      <div className="mt-1 font-semibold">
                        {formatNumber(
                          successResult.destination_qty_after
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-emerald-800">
                    Movement #
                    {successResult.new_movement_no}
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={resetInbound}
                      className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white"
                    >
                      Inbound Lagi
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
                  Inbound gagal
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
                      Cari SKU barang yang akan
                      diterima masuk.
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
                        onClick={resetInbound}
                        className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-center text-sm"
                      >
                        Reset
                      </button>
                    )}
                  </form>

                  {searchResults.length >
                    0 && (
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
                                    {item.color ??
                                      "-"}
                                    {" • "}
                                    Size{" "}
                                    {item.size ??
                                      "-"}
                                  </div>

                                  <div className="mt-2 text-xs text-slate-500">
                                    Current total
                                    stock:{" "}
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
                        Current total stock:{" "}
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
                        Hasil QC
                      </h2>

                      <p className="mt-1 text-sm text-slate-500">
                        Pilih kondisi barang setelah
                        proses quality control.
                      </p>

                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        {qcOptions.map(
                          (option) => {
                            const active =
                              qcResult ===
                              option.code;

                            return (
                              <button
                                key={
                                  option.code
                                }
                                type="button"
                                onClick={() =>
                                  handleSelectQc(
                                    option.code
                                  )
                                }
                                disabled={
                                  loadingLocations
                                }
                                className={
                                  active
                                    ? "rounded-xl border-2 border-slate-900 bg-slate-50 p-4 text-left"
                                    : "rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
                                }
                              >
                                <div className="font-semibold">
                                  {option.title}
                                </div>

                                <div className="mt-1 text-xs text-slate-500">
                                  {
                                    option.description
                                  }
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
                  qcResult && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="mb-6">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Step 3
                        </div>

                        <h2 className="mt-1 text-lg font-semibold">
                          Detail Inbound
                        </h2>

                        <p className="mt-1 text-sm text-slate-500">
                          Rack yang tersedia hanya
                          dari area{" "}
                          <span className="font-semibold">
                            {qcResult}
                          </span>
                          .
                        </p>
                      </div>

                      <form
                        onSubmit={handleInbound}
                        className="space-y-5"
                      >
                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Destination Rack
                          </label>

                          <select
                            required
                            value={
                              destinationId
                            }
                            onChange={(event) =>
                              setDestinationId(
                                event.target
                                  .value
                              )
                            }
                            disabled={
                              loadingLocations
                            }
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500 disabled:opacity-50"
                          >
                            <option value="">
                              {loadingLocations
                                ? "Loading rack..."
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

                          {!loadingLocations &&
                            destinationLocations.length ===
                              0 && (
                              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                Belum ada rack aktif
                                untuk area{" "}
                                {qcResult}.
                              </div>
                            )}
                        </div>

                        {selectedDestination && (
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div className="rounded-xl bg-slate-50 p-4">
                              <div className="text-xs text-slate-500">
                                Destination
                              </div>

                              <div className="mt-1 font-semibold">
                                {
                                  selectedDestination.location_code
                                }
                              </div>
                            </div>

                            <div className="rounded-xl bg-slate-50 p-4">
                              <div className="text-xs text-slate-500">
                                QC Area
                              </div>

                              <div className="mt-1 font-semibold">
                                {
                                  selectedDestination.area_code
                                }
                              </div>
                            </div>

                            <div className="rounded-xl bg-slate-50 p-4">
                              <div className="text-xs text-slate-500">
                                Current Stock
                              </div>

                              <div className="mt-1 text-xl font-bold">
                                {formatNumber(
                                  selectedDestination.current_qty
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Quantity
                          </label>

                          <input
                            type="number"
                            min="1"
                            step="1"
                            required
                            value={quantity}
                            onChange={(event) =>
                              setQuantity(
                                event.target
                                  .value
                              )
                            }
                            placeholder="Masukkan qty barang masuk"
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
                                event.target
                                  .value
                              )
                            }
                            placeholder="Contoh: PO-001 / SJ-001"
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
                                event.target
                                  .value
                              )
                            }
                            placeholder="Catatan barang masuk..."
                            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        <div className="border-t border-slate-200 pt-5">
                          <button
                            type="submit"
                            disabled={
                              receiving ||
                              !destinationId
                            }
                            className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                          >
                            {receiving
                              ? "Processing..."
                              : "Confirm Inbound"}
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