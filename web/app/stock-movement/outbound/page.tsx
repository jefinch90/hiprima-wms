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

type TransactionType =
  | "sale"
  | "sample"
  | "giveaway"
  | "internal_use"
  | "other";

type OutboundResult = {
  new_movement_no: number | string;
  source_qty_after: number | string;
  transaction_type?: string | null;
  sales_channel?: string | null;
};

export default function OutboundStockPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<
    SearchSkuRow[]
  >([]);

  const [selectedVariant, setSelectedVariant] =
    useState<VariantRow | null>(null);

  const [sourceLocations, setSourceLocations] = useState<
    SourceLocationRow[]
  >([]);

  const [selectedSource, setSelectedSource] =
    useState<SourceLocationRow | null>(null);

  const [transactionType, setTransactionType] =
    useState<TransactionType | "">("");
  const [salesChannel, setSalesChannel] = useState("");
  const [quantity, setQuantity] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");

  const [searching, setSearching] = useState(false);
  const [loadingVariant, setLoadingVariant] =
    useState(false);
  const [processing, setProcessing] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [modalError, setModalError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);

  const [successResult, setSuccessResult] =
    useState<OutboundResult | null>(null);

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

  const transactionTypeLabels: Record<string, string> = {
    sale: "Sale",
    sample: "Sample",
    giveaway: "Giveaway",
    internal_use: "Internal Use",
    other: "Other",
  };

  function resetOutbound() {
    setSearchInput("");
    setSearchResults([]);
    setSelectedVariant(null);
    setSourceLocations([]);
    setSelectedSource(null);
    setTransactionType("");
    setSalesChannel("");
    setQuantity("");
    setReferenceNo("");
    setNotes("");
    setErrorMessage("");
    setModalError("");
    setConfirmOpen(false);
    setSuccessOpen(false);
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
      "search_outbound_skus",
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

    setSelectedSource(null);
    setSourceLocations([]);
    setQuantity("");
    setReferenceNo("");
    setNotes("");

    const {
      data: variantData,
      error: variantError,
    } = await supabase.rpc(
      "get_outbound_variant",
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
      data: sourceData,
      error: sourceError,
    } = await supabase.rpc(
      "get_outbound_source_locations",
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

  function handleOutbound(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErrorMessage("");
    setModalError("");

    if (!selectedVariant) {
      setErrorMessage("SKU wajib dipilih.");
      return;
    }

    if (!selectedSource) {
      setErrorMessage("Source rack wajib dipilih.");
      return;
    }

    if (!transactionType) {
      setErrorMessage("Transaction Type wajib dipilih.");
      return;
    }

    if (
      transactionType === "sale" &&
      !salesChannel.trim()
    ) {
      setErrorMessage(
        "Sales Channel wajib dipilih untuk transaksi Sale."
      );
      return;
    }

    const outboundQty = Number(quantity);

    if (
      !Number.isInteger(outboundQty) ||
      outboundQty <= 0
    ) {
      setErrorMessage(
        "Quantity harus berupa angka lebih dari 0."
      );
      return;
    }

    if (
      outboundQty >
      Number(selectedSource.qty_on_hand)
    ) {
      setErrorMessage(
        "Quantity melebihi stok tersedia."
      );
      return;
    }

    if (!referenceNo.trim()) {
      setErrorMessage("Reference wajib diisi.");
      return;
    }

    // VALIDASI SELESAI.
    // Jangan langsung submit.
    // Tampilkan popup konfirmasi terlebih dahulu.
    setConfirmOpen(true);
  }

  async function processOutbound() {
    if (
      !selectedVariant ||
      !selectedSource ||
      !transactionType
    ) {
      setConfirmOpen(false);
      setModalError(
        "Data outbound belum lengkap. Silakan periksa kembali form."
      );
      return;
    }

    const outboundQty = Number(quantity);

    setConfirmOpen(false);
    setProcessing(true);
    setErrorMessage("");
    setModalError("");

    const { data, error } = await supabase.rpc(
      "post_outbound_transaction",
      {
        p_variant_id:
          selectedVariant.variant_id,
        p_from_location_id:
          selectedSource.location_id,
        p_quantity: outboundQty,
        p_reference_no:
          referenceNo.trim(),
        p_transaction_type:
          transactionType,
        p_sales_channel:
          transactionType === "sale"
            ? salesChannel.trim()
            : null,

        // Retained only for RPC backward compatibility.
        // Discount belongs to Sales/POS, not WMS Outbound.
        p_discount_amount: 0,

        p_notes:
          notes.trim() || null,
      }
    );

    if (error) {
      setModalError(error.message);
      setProcessing(false);
      return;
    }

    const result =
      ((data ?? [])[0] as
        | OutboundResult
        | undefined) ?? null;

    if (!result) {
      setModalError(
        "Outbound berhasil diproses tetapi hasil transaksi tidak ditemukan."
      );
      setProcessing(false);
      return;
    }

    setSuccessResult(result);
    setSuccessOpen(true);
    setProcessing(false);
  }

  function closeErrorModal() {
    setModalError("");
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
                    Outbound Stock
                  </h1>

                  <p className="mt-2 text-sm text-slate-500">
                    Keluarkan stok dari rack NORMAL dan
                    catat pergerakan barang
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
              !successOpen &&
              selectedVariant &&
              selectedSource && (
                <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                  <div className="text-lg font-semibold text-emerald-900">
                    Outbound stock berhasil
                  </div>

                  <p className="mt-1 text-sm text-emerald-800">
                    Inventory dan movement history sudah
                    diperbarui.
                  </p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                        Transaction Type
                      </div>

                      <div className="mt-1 font-semibold">
                        {transactionTypeLabels[successResult.transaction_type ?? transactionType] ?? (successResult.transaction_type ?? transactionType)}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Sales Channel
                      </div>

                      <div className="mt-1 font-semibold">
                        {successResult.sales_channel ?? "-"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Source Rack
                      </div>

                      <div className="mt-1 font-semibold">
                        {selectedSource.location_code}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <div className="text-xs text-slate-500">
                        Stock After
                      </div>

                      <div className="mt-1 font-semibold">
                        {formatNumber(
                          successResult.source_qty_after
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={resetOutbound}
                      className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white"
                    >
                      Outbound Lagi
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
                  Outbound gagal
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
                      Hanya SKU dengan stok tersedia
                      di area NORMAL yang akan muncul.
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
                        onClick={resetOutbound}
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
                                    {item.color ??
                                      "-"}
                                    {" • "}
                                    Size{" "}
                                    {item.size ??
                                      "-"}
                                  </div>

                                  <div className="mt-2 text-xs text-slate-500">
                                    Normal stock:{" "}
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
                        Normal stock:{" "}
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
                        Pilih Source Rack
                      </h2>

                      <p className="mt-1 text-sm text-slate-500">
                        Pilih rack NORMAL tempat barang
                        akan dikeluarkan.
                      </p>

                      {sourceLocations.length > 0 ? (
                        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {sourceLocations.map(
                            (location) => {
                              const active =
                                selectedSource?.location_id ===
                                location.location_id;

                              return (
                                <button
                                  key={
                                    location.location_id
                                  }
                                  type="button"
                                  onClick={() => {
                                    setSelectedSource(
                                      location
                                    );
                                    setQuantity("");
                                    setErrorMessage("");
                                  }}
                                  className={
                                    active
                                      ? "rounded-xl border-2 border-slate-900 bg-slate-50 p-4 text-left"
                                      : "rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:bg-slate-50"
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
                                    {
                                      location.area_code
                                    }
                                  </div>
                                </button>
                              );
                            }
                          )}
                        </div>
                      ) : (
                        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                          SKU ini tidak memiliki stok
                          tersedia di rack NORMAL.
                        </div>
                      )}
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
                          Detail Outbound
                        </h2>
                      </div>

                      <div className="mb-6 grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-4">
                          <div className="text-xs text-slate-500">
                            Source Rack
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
                        onSubmit={handleOutbound}
                        className="space-y-5"
                      >
                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Transaction Type
                            <span className="ml-1 text-red-500">
                              *
                            </span>
                          </label>

                          <select
                            required
                            value={transactionType}
                            onChange={(event) => {
                              const value = event.target.value as TransactionType | "";
                              setTransactionType(value);
                              if (value !== "sale") {
                                setSalesChannel("");
                              }
                              setErrorMessage("");
                            }}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500"
                          >
                            <option value="">Pilih Transaction Type</option>
                            <option value="sale">Sale</option>
                            <option value="sample">Sample</option>
                            <option value="giveaway">Giveaway</option>
                            <option value="internal_use">Internal Use</option>
                            <option value="other">Other</option>
                          </select>
                        </div>

                        {transactionType === "sale" && (
                          <div>
                            <label className="mb-2 block text-sm font-medium">
                              Sales Channel
                              <span className="ml-1 text-red-500">
                                *
                              </span>
                            </label>

                            <select
                              required
                              value={salesChannel}
                              onChange={(event) =>
                                setSalesChannel(event.target.value)
                              }
                              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500"
                            >
                              <option value="">Pilih Sales Channel</option>
                              <option value="TikTok Shop">TikTok Shop</option>
                              <option value="Shopee">Shopee</option>
                              <option value="Tokopedia">Tokopedia</option>
                              <option value="Lazada">Lazada</option>
                              <option value="Website">Website</option>
                              <option value="WhatsApp">WhatsApp</option>
                              <option value="Offline Store">Offline Store</option>
                              <option value="Bazaar/Event">Bazaar/Event</option>
                              <option value="Wholesale/Reseller">Wholesale/Reseller</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                        )}

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
                            placeholder="Masukkan qty barang keluar"
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
                            placeholder="Contoh: ORDER-12345 / INV-001"
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />

                          <p className="mt-2 text-xs text-slate-400">
                            Isi nomor order, invoice,
                            surat jalan, atau referensi
                            transaksi lainnya.
                          </p>
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
                            placeholder="Catatan tambahan jika diperlukan"
                            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                          />
                        </div>

                        <div className="border-t border-slate-200 pt-5">
                          <button
                            type="submit"
                            disabled={processing}
                            className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                          >
                            {processing
                              ? "Processing..."
                              : "Confirm Outbound"}
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

      {/* ======================================================
          POPUP KONFIRMASI OUTBOUND
          ====================================================== */}
      {confirmOpen &&
        selectedVariant &&
        selectedSource && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="outbound-confirm-title"
          >
            <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">

              <div className="border-b border-slate-200 px-6 py-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Konfirmasi Transaksi
                </div>

                <h2
                  id="outbound-confirm-title"
                  className="mt-1 text-xl font-bold"
                >
                  Yakin proses Outbound?
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  Setelah dikonfirmasi, stok inventory akan
                  berkurang dan movement akan tercatat.
                </p>
              </div>

              <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
                <div className="space-y-3">

                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="text-sm text-slate-500">
                      SKU
                    </span>

                    <span className="max-w-[65%] break-all text-right text-sm font-semibold">
                      {selectedVariant.sku}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="text-sm text-slate-500">
                      Transaction Type
                    </span>

                    <span className="text-right text-sm font-semibold">
                      {transactionTypeLabels[
                        transactionType
                      ] ?? transactionType}
                    </span>
                  </div>

                  {transactionType === "sale" && (
                    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                      <span className="text-sm text-slate-500">
                        Sales Channel
                      </span>

                      <span className="text-right text-sm font-semibold">
                        {salesChannel}
                      </span>
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="text-sm text-slate-500">
                      Quantity
                    </span>

                    <span className="text-right text-sm font-bold">
                      {formatNumber(quantity)}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="text-sm text-slate-500">
                      Source Rack
                    </span>

                    <span className="text-right text-sm font-semibold">
                      {selectedSource.location_code}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="text-sm text-slate-500">
                      Available Stock
                    </span>

                    <span className="text-right text-sm font-semibold">
                      {formatNumber(
                        selectedSource.qty_on_hand
                      )}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                    <span className="text-sm text-slate-500">
                      Reference
                    </span>

                    <span className="max-w-[65%] break-words text-right text-sm font-semibold">
                      {referenceNo.trim()}
                    </span>
                  </div>

                  {notes.trim() && (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-sm text-slate-500">
                        Notes
                      </span>

                      <span className="max-w-[65%] break-words text-right text-sm">
                        {notes.trim()}
                      </span>
                    </div>
                  )}

                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">

                <button
                  type="button"
                  onClick={() =>
                    setConfirmOpen(false)
                  }
                  disabled={processing}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium disabled:opacity-50"
                >
                  Batal
                </button>

                <button
                  type="button"
                  onClick={processOutbound}
                  disabled={processing}
                  className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {processing
                    ? "Processing..."
                    : "Ya, Proses Outbound"}
                </button>

              </div>
            </div>
          </div>
        )}

      {/* ======================================================
          POPUP ERROR
          ====================================================== */}
      {modalError && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="outbound-error-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">

            <div className="px-6 py-6">

              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-xl font-bold text-red-700">
                !
              </div>

              <h2
                id="outbound-error-title"
                className="mt-4 text-xl font-bold"
              >
                Outbound gagal
              </h2>

              <p className="mt-2 break-words text-sm leading-6 text-slate-600">
                {modalError}
              </p>

              <button
                type="button"
                onClick={closeErrorModal}
                className="mt-6 w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
              >
                Tutup
              </button>

            </div>
          </div>
        </div>
      )}

      {/* ======================================================
          POPUP SUCCESS
          ====================================================== */}
      {successOpen &&
        successResult &&
        selectedVariant &&
        selectedSource && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="outbound-success-title"
          >
            <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">

              <div className="px-6 py-6">

                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl font-bold text-emerald-700">
                  ✓
                </div>

                <h2
                  id="outbound-success-title"
                  className="mt-4 text-2xl font-bold"
                >
                  Outbound berhasil
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  Inventory dan movement history sudah
                  diperbarui.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Movement No
                    </div>

                    <div className="mt-1 font-bold">
                      #{successResult.new_movement_no}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      SKU
                    </div>

                    <div className="mt-1 break-all font-semibold">
                      {selectedVariant.sku}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Transaction Type
                    </div>

                    <div className="mt-1 font-semibold">
                      {transactionTypeLabels[
                        successResult.transaction_type ??
                          transactionType
                      ] ??
                        (successResult.transaction_type ??
                          transactionType)}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Sales Channel
                    </div>

                    <div className="mt-1 font-semibold">
                      {successResult.sales_channel ?? "-"}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Quantity
                    </div>

                    <div className="mt-1 font-bold">
                      {formatNumber(quantity)}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Source Rack
                    </div>

                    <div className="mt-1 font-semibold">
                      {selectedSource.location_code}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Reference
                    </div>

                    <div className="mt-1 break-words font-semibold">
                      {referenceNo}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">
                      Stock After
                    </div>

                    <div className="mt-1 font-bold">
                      {formatNumber(
                        successResult.source_qty_after
                      )}
                    </div>
                  </div>

                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">

                  <button
                    type="button"
                    onClick={resetOutbound}
                    className="flex-1 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
                  >
                    Outbound Lagi
                  </button>

                  <Link
                    href="/stock-movement"
                    className="flex-1 rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold"
                  >
                    Lihat Movement
                  </Link>

                </div>

              </div>
            </div>
          </div>
        )}

    </div>
  );
}