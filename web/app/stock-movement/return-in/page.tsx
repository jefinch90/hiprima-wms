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

type DestinationLocationRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  current_qty: number | string;
};

type ReturnResult = {
  new_movement_no: number | string;
  destination_qty_after: number | string;
  destination_area: string;
};

type QcResult = "NORMAL" | "DEFECT" | "REJECT";

export default function ReturnInPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<
    SearchSkuRow[]
  >([]);

  const [selectedVariant, setSelectedVariant] =
    useState<VariantRow | null>(null);

  const [qcResult, setQcResult] =
    useState<QcResult | null>(null);

  const [destinationLocations, setDestinationLocations] =
    useState<DestinationLocationRow[]>([]);

  const [destinationId, setDestinationId] = useState("");

  const [quantity, setQuantity] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const [searching, setSearching] = useState(false);
  const [loadingVariant, setLoadingVariant] =
    useState(false);
  const [loadingLocations, setLoadingLocations] =
    useState(false);
  const [processing, setProcessing] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

  const [successResult, setSuccessResult] =
    useState<ReturnResult | null>(null);

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

  const selectedDestination =
    destinationLocations.find(
      (location) =>
        location.location_id === destinationId
    ) ?? null;

  const formatNumber = (
    value: number | string | null | undefined
  ) => Number(value ?? 0).toLocaleString("id-ID");

  function resetReturn() {
    setSearchInput("");
    setSearchResults([]);
    setSelectedVariant(null);

    setQcResult(null);

    setDestinationLocations([]);
    setDestinationId("");

    setQuantity("");
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
      "search_return_skus",
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

    setQcResult(null);
    setDestinationLocations([]);
    setDestinationId("");

    setQuantity("");
    setReferenceNo("");
    setReason("");
    setNotes("");

    const {
      data: variantData,
      error: variantError,
    } = await supabase.rpc(
      "get_return_variant",
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

  async function handleQcResult(
    result: QcResult
  ) {
    if (!selectedVariant) {
      return;
    }

    setQcResult(result);
    setDestinationLocations([]);
    setDestinationId("");

    setErrorMessage("");
    setSuccessResult(null);

    setLoadingLocations(true);

    const { data, error } = await supabase.rpc(
      "get_return_in_destination_locations",
      {
        p_variant_id:
          selectedVariant.variant_id,
        p_qc_result: result,
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

  async function handleReturn(
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
        "Hasil QC wajib dipilih."
      );
      return;
    }

    if (!selectedDestination) {
      setErrorMessage(
        "Destination rack wajib dipilih."
      );
      return;
    }

    const returnQty = Number(quantity);

    if (
      !Number.isInteger(returnQty) ||
      returnQty <= 0
    ) {
      setErrorMessage(
        "Quantity harus berupa angka lebih dari 0."
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
        "Alasan return wajib diisi."
      );
      return;
    }

    const confirmed = window.confirm(
      [
        "Konfirmasi Return In",
        "",
        `SKU: ${selectedVariant.sku}`,
        `Hasil QC: ${qcResult}`,
        `Destination: ${selectedDestination.location_code}`,
        `Qty: ${formatNumber(returnQty)} pcs`,
        `Reference: ${referenceNo.trim()}`,
        "",
        "Lanjutkan Return In?",
      ].join("\n")
    );

    if (!confirmed) {
      return;
    }

    setProcessing(true);

    const { data, error } = await supabase.rpc(
      "receive_return_stock",
      {
        p_variant_id:
          selectedVariant.variant_id,
        p_to_location_id:
          selectedDestination.location_id,
        p_quantity: returnQty,
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
        | ReturnResult
        | undefined) ?? null;

    if (!result) {
      setErrorMessage(
        "Return berhasil diproses tetapi hasil transaksi tidak ditemukan."
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
                <div className="min-w-0">
                  <h1 className="text-3xl font-bold">
                    Return In
                  </h1>

                  <p className="mt-2 text-sm text-slate-500">
                    Terima barang return dari customer,
                    lakukan QC, lalu masukkan ke area stok
                    yang sesuai
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
              selectedDestination && (
                <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                  <div className="text-lg font-semibold text-emerald-900">
                    Return In berhasil
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
                        #
                        {
                          successResult.new_movement_no
                        }
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Area
                      </div>

                      <div className="mt-1 font-semibold">
                        {
                          successResult.destination_area
                        }
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Rack
                      </div>

                      <div className="mt-1 font-semibold">
                        {
                          selectedDestination.location_code
                        }
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

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={resetReturn}
                      className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white"
                    >
                      Return Lagi
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
                  Return In gagal
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
                      Cari SKU barang yang dikembalikan
                      oleh customer.
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
                        onClick={resetReturn}
                        className="shrink-0 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm"
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
                                    Current total stock:{" "}
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
                        Current total stock:
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
                        Tentukan kondisi barang return
                        setelah diperiksa.
                      </p>

                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <button
                          type="button"
                          onClick={() =>
                            handleQcResult("NORMAL")
                          }
                          className={
                            qcResult === "NORMAL"
                              ? "rounded-xl border-2 border-slate-900 bg-slate-50 p-5 text-left"
                              : "rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-slate-400"
                          }
                        >
                          <div className="font-semibold">
                            Normal
                          </div>

                          <div className="mt-1 text-sm text-slate-500">
                            Lolos QC / siap kembali ke
                            stok jual
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleQcResult("DEFECT")
                          }
                          className={
                            qcResult === "DEFECT"
                              ? "rounded-xl border-2 border-slate-900 bg-slate-50 p-5 text-left"
                              : "rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-slate-400"
                          }
                        >
                          <div className="font-semibold">
                            Defect
                          </div>

                          <div className="mt-1 text-sm text-slate-500">
                            Ada cacat tetapi masih
                            tercatat sebagai stok
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleQcResult("REJECT")
                          }
                          className={
                            qcResult === "REJECT"
                              ? "rounded-xl border-2 border-slate-900 bg-slate-50 p-5 text-left"
                              : "rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-slate-400"
                          }
                        >
                          <div className="font-semibold">
                            Reject
                          </div>

                          <div className="mt-1 text-sm text-slate-500">
                            Tidak lolos QC / dipisahkan
                          </div>
                        </button>
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
                          Detail Return In
                        </h2>

                        <p className="mt-1 text-sm text-slate-500">
                          Rack yang tersedia hanya dari
                          area{" "}
                          <span className="font-semibold">
                            {qcResult}
                          </span>
                          .
                        </p>
                      </div>

                      <form
                        onSubmit={handleReturn}
                        className="space-y-5"
                      >
                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Destination Rack
                            <span className="ml-1 text-red-500">
                              *
                            </span>
                          </label>

                          <select
                            required
                            disabled={
                              loadingLocations
                            }
                            value={destinationId}
                            onChange={(event) =>
                              setDestinationId(
                                event.target.value
                              )
                            }
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500 disabled:opacity-50"
                          >
                            <option value="">
                              {loadingLocations
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
                              <div className="mt-2 text-sm text-red-600">
                                Tidak ada rack aktif untuk
                                area {qcResult}.
                              </div>
                            )}
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Quantity
                            <span className="ml-1 text-red-500">
                              *
                            </span>
                          </label>

                          <input
                            type="number"
                            min="1"
                            step="1"
                            required
                            value={quantity}
                            onChange={(event) =>
                              setQuantity(
                                event.target.value
                              )
                            }
                            placeholder="Masukkan qty barang return"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

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
                            placeholder="Contoh: RET-001 / ORDER-12345"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />

                          <div className="mt-2 text-xs text-slate-400">
                            Bisa isi nomor order,
                            invoice, return ID, atau
                            referensi transaksi.
                          </div>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Alasan Return
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

                            <option value="Return customer">
                              Return customer
                            </option>

                            <option value="Salah size / warna">
                              Salah size / warna
                            </option>

                            <option value="Barang defect">
                              Barang defect
                            </option>

                            <option value="Barang tidak sesuai">
                              Barang tidak sesuai
                            </option>

                            <option value="Gagal kirim / RTS">
                              Gagal kirim / RTS
                            </option>

                            <option value="Komplain customer">
                              Komplain customer
                            </option>

                            <option value="Lainnya">
                              Lainnya
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
                            placeholder="Tambahkan keterangan barang return..."
                            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        {selectedDestination && (
                          <div className="rounded-xl bg-slate-50 p-5">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Destination Summary
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <div>
                                <div className="text-xs text-slate-500">
                                  Area
                                </div>

                                <div className="mt-1 font-semibold">
                                  {
                                    selectedDestination.area_code
                                  }
                                </div>
                              </div>

                              <div>
                                <div className="text-xs text-slate-500">
                                  Rack
                                </div>

                                <div className="mt-1 font-semibold">
                                  {
                                    selectedDestination.location_code
                                  }
                                </div>
                              </div>

                              <div>
                                <div className="text-xs text-slate-500">
                                  Current Stock
                                </div>

                                <div className="mt-1 font-semibold">
                                  {formatNumber(
                                    selectedDestination.current_qty
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="border-t border-slate-200 pt-5">
                          <button
                            type="submit"
                            disabled={
                              processing ||
                              !destinationId ||
                              destinationLocations.length ===
                                0
                            }
                            className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-40 sm:w-auto"
                          >
                            {processing
                              ? "Processing..."
                              : "Confirm Return In"}
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