"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import SkuMappingExcelImport from "./SkuMappingExcelImport";
import { createClient } from "@/utils/supabase/client";

type ReviewStatus = "pending" | "verified" | "rejected";
type Category = "fashion" | "non_fashion" | "unclassified";

type AliasRow = {
  id: string;
  iseller_sku: string;
  source_product_name: string | null;
  source_product_type: string | null;
  audit_units_30d: number;
  candidate_variant_id: string | null;
  variant_id: string | null;
  category: Category;
  review_status: ReviewStatus;
  notes: string | null;
  reviewed_at: string | null;
};

type VariantRow = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
};

const PAGE_SIZE = 20;

function statusLabel(status: ReviewStatus) {
  if (status === "verified") return "Verified";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function statusClass(status: ReviewStatus) {
  if (status === "verified") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (status === "rejected") {
    return "bg-red-50 text-red-700";
  }

  return "bg-amber-50 text-amber-700";
}

function categoryLabel(category: Category) {
  if (category === "fashion") return "Fashion";
  if (category === "non_fashion") return "Non-Fashion";
  return "Belum Diklasifikasikan";
}

export default function SkuMappingPage() {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<AliasRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [canManage, setCanManage] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [draftCategory, setDraftCategory] =
    useState<Category>("unclassified");

  const [draftVariantId, setDraftVariantId] = useState("");
  const [draftNotes, setDraftNotes] = useState("");

  const [variantSearch, setVariantSearch] = useState("");
  const [variantResults, setVariantResults] = useState<VariantRow[]>([]);
  const [knownVariants, setKnownVariants] =
    useState<Record<string, VariantRow>>({});

  const [searchingVariant, setSearchingVariant] = useState(false);
  const [saving, setSaving] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadRows = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("iseller_sku_aliases")
      .select(
        "id,iseller_sku,source_product_name,source_product_type,audit_units_30d,candidate_variant_id,variant_id,category,review_status,notes,reviewed_at"
      )
      .order("audit_units_30d", { ascending: false })
      .limit(1000);

    if (error) {
      setErrorMessage(error.message);
    } else {
      setRows((data ?? []) as AliasRow[]);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;

      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("role,is_active")
          .eq("id", user.id)
          .maybeSingle();

        if (!active) return;

        setCanManage(
          Boolean(
            data?.is_active &&
            (data.role === "owner" || data.role === "admin")
          )
        );
      }

      if (active) void loadRows();
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [supabase, loadRows]);

  const selected = rows.find((row) => row.id === selectedId);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (
        statusFilter !== "all" &&
        row.review_status !== statusFilter
      ) return false;

      if (
        categoryFilter !== "all" &&
        row.category !== categoryFilter
      ) return false;

      if (!keyword) return true;

      return [
        row.iseller_sku,
        row.source_product_name ?? "",
        row.source_product_type ?? "",
      ].some((value) => value.toLowerCase().includes(keyword));
    });
  }, [rows, search, statusFilter, categoryFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredRows.length / PAGE_SIZE)
  );

  const visiblePage = Math.min(page, totalPages);

  const visibleRows = filteredRows.slice(
    (visiblePage - 1) * PAGE_SIZE,
    visiblePage * PAGE_SIZE
  );

  const pendingCount = rows.filter(
    (row) => row.review_status === "pending"
  ).length;

  const verifiedCount = rows.filter(
    (row) => row.review_status === "verified"
  ).length;

  const candidateCount = rows.filter(
    (row) => row.candidate_variant_id !== null
  ).length;

  async function loadVariantDetails(ids: string[]) {
    if (!ids.length) return;

    const { data } = await supabase
      .from("product_variants")
      .select("id,sku,color,size")
      .in("id", ids);

    if (data) {
      setKnownVariants((previous) => {
        const next = { ...previous };

        for (const item of data as VariantRow[]) {
          next[item.id] = item;
        }

        return next;
      });
    }
  }

  function openEditor(row: AliasRow) {
    setSelectedId(row.id);
    setDraftCategory(row.category);
    setDraftVariantId(row.variant_id ?? "");
    setDraftNotes(row.notes ?? "");
    setVariantSearch("");
    setVariantResults([]);
    setErrorMessage("");
    setSuccessMessage("");

    const ids = [
      row.candidate_variant_id,
      row.variant_id,
    ].filter((value): value is string => Boolean(value));

    void loadVariantDetails([...new Set(ids)]);
  }

  async function findVariants() {
    const keyword = variantSearch.trim().replace(/[%_]/g, "");

    if (keyword.length < 2) {
      setErrorMessage("Masukkan minimal 2 karakter SKU WMS.");
      return;
    }

    setSearchingVariant(true);
    setErrorMessage("");
    setVariantResults([]);

    const { data, error } = await supabase
      .from("product_variants")
      .select("id,sku,color,size")
      .ilike("sku", `%${keyword}%`)
      .limit(30);

    if (error) {
      setErrorMessage(error.message);
    } else {
      const variants = (data ?? []) as VariantRow[];

      setVariantResults(variants);

      setKnownVariants((previous) => {
        const next = { ...previous };

        for (const item of variants) {
          next[item.id] = item;
        }

        return next;
      });
    }

    setSearchingVariant(false);
  }

  async function saveMapping(verify: boolean) {
    if (!selected || saving || !canManage) return;

    setErrorMessage("");
    setSuccessMessage("");

    if (verify && draftCategory === "unclassified") {
      setErrorMessage("Pilih kategori produk dahulu.");
      return;
    }

    if (
      verify &&
      draftCategory === "fashion" &&
      !draftVariantId
    ) {
      setErrorMessage(
        "Produk Fashion wajib dipasangkan ke SKU Master WMS."
      );
      return;
    }

    if (draftCategory === "fashion" && draftVariantId) {
      const { data, error } = await supabase
        .from("product_variants")
        .select("id")
        .eq("id", draftVariantId)
        .maybeSingle();

      if (error || !data) {
        setErrorMessage("SKU Master WMS tidak ditemukan.");
        return;
      }
    }

    setSaving(true);

    try {
      const variantId =
        draftCategory === "fashion"
          ? draftVariantId || null
          : null;

      // Selalu simpan perubahan sebagai Pending dahulu.
      // Perubahan pada mapping Verified wajib diverifikasi ulang.
      const { error: draftError } = await supabase
        .from("iseller_sku_aliases")
        .update({
          category: draftCategory,
          variant_id: variantId,
          notes: draftNotes.trim() || null,
          review_status: "pending",
        })
        .eq("id", selected.id);

      if (draftError) throw new Error(draftError.message);

      if (verify) {
        // Aktivasi setelah data varian dan kategori tersimpan.
        const { error: verifyError } = await supabase
          .from("iseller_sku_aliases")
          .update({ review_status: "verified" })
          .eq("id", selected.id);

        if (verifyError) {
          throw new Error(
            "Draft tersimpan, tetapi verifikasi gagal: " +
            verifyError.message
          );
        }
      }

      await loadRows();

      setSuccessMessage(
        verify
          ? "SKU Mapping berhasil diverifikasi."
          : "Draft SKU Mapping berhasil disimpan."
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Gagal menyimpan SKU Mapping."
      );

      await loadRows();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen max-w-full">
        <Sidebar />

        <main className="min-w-0 flex-1 overflow-x-hidden p-5 md:p-10">
          <div className="mx-auto w-full max-w-[1500px]">

            <header className="mb-7">
              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-3xl font-bold">
                    SKU Mapping Management
                  </h1>
                  <p className="mt-2 text-sm text-slate-500">
                    Cocokkan SKU iSeller dengan Master Products WMS.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/sales-analytics/dashboard"
                    className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
                  >
                    Sales Dashboard
                  </Link>

                  <button
                    type="button"
                    onClick={() => void loadRows()}
                    disabled={loading || saving}
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>
              </div>
            </header>

            <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "Total Alias", value: rows.length },
                { label: "Pending", value: pendingCount },
                { label: "Verified", value: verifiedCount },
                { label: "Punya Kandidat", value: candidateCount },
              ].map((item) => (
                <div
                  key={item.label}
                  className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <p className="text-xs text-slate-500">
                    {item.label}
                  </p>

                  <p className="mt-2 text-2xl font-bold">
                    {item.value.toLocaleString("id-ID")}
                  </p>
                </div>
              ))}
            </section>

            {errorMessage && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            {successMessage && (
              <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                {successMessage}
              </div>
            )}

            <SkuMappingExcelImport onCompleted={() => void loadRows()} />

            <div className="mb-5 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Cari SKU, produk, atau tipe..."
                className="min-w-[180px] flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm"
              />

              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
              >
                <option value="all">Semua Status</option>
                <option value="pending">Pending</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
              </select>

              <select
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
              >
                <option value="all">Semua Kategori</option>
                <option value="fashion">Fashion</option>
                <option value="non_fashion">Non-Fashion</option>
                <option value="unclassified">Belum Diklasifikasikan</option>
              </select>
            </div>

            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">

              <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
                  <div>
                    <h2 className="font-bold">Daftar SKU iSeller</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {filteredRows.length} SKU ditemukan
                    </p>
                  </div>

                  <p className="text-xs text-slate-500">
                    Halaman {visiblePage} / {totalPages}
                  </p>
                </div>

                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="p-3">SKU iSeller</th>
                        <th className="p-3">Produk</th>
                        <th className="p-3 text-right">Unit</th>
                        <th className="p-3">Kandidat</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Aksi</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {visibleRows.map((row) => (
                        <tr
                          key={row.id}
                          className={
                            selectedId === row.id
                              ? "bg-slate-100"
                              : "hover:bg-slate-50"
                          }
                        >
                          <td className="p-3 font-semibold">
                            {row.iseller_sku}
                          </td>

                          <td className="max-w-[150px] p-2">
                            <span className="line-clamp-2">
                              {row.source_product_name || "-"}
                            </span>
                          </td>

                          <td className="p-3 text-right">
                            {row.audit_units_30d}
                          </td>

                          <td className="p-3 text-xs">
                            {row.candidate_variant_id
                              ? "Tersedia"
                              : "Manual"}
                          </td>

                          <td className="p-3">
                            <span
                              className={
                                "whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium " +
                                statusClass(row.review_status)
                              }
                            >
                              {statusLabel(row.review_status)}
                            </span>
                          </td>

                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => openEditor(row)}
                              className="whitespace-nowrap rounded-lg border border-slate-300 px-2 py-2 text-xs font-semibold hover:bg-slate-100"
                            >
                              Periksa
                            </button>
                          </td>
                        </tr>
                      ))}

                      {!loading && visibleRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="p-10 text-center text-slate-500"
                          >
                            Tidak ada SKU yang sesuai filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-4">
                  <button
                    type="button"
                    disabled={visiblePage === 1}
                    onClick={() =>
                      setPage(Math.max(1, visiblePage - 1))
                    }
                    className="rounded-lg border px-4 py-2 text-sm disabled:opacity-30"
                  >
                    Sebelumnya
                  </button>

                  <span className="text-xs text-slate-500">
                    20 SKU / halaman
                  </span>

                  <button
                    type="button"
                    disabled={visiblePage >= totalPages}
                    onClick={() => setPage(visiblePage + 1)}
                    className="rounded-lg border px-4 py-2 text-sm disabled:opacity-30"
                  >
                    Berikutnya
                  </button>
                </div>
              </section>

              <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 xl:sticky xl:top-5">
                <h2 className="text-lg font-bold">
                  Verifikasi SKU Mapping
                </h2>

                {!selected ? (
                  <p className="mt-5 text-sm leading-7 text-slate-500">
                    Klik tombol Periksa pada salah satu SKU
                    untuk menampilkan detail dan kandidat
                    SKU Master WMS.
                  </p>
                ) : (
                  <div className="mt-5 space-y-5">

                    <div className="rounded-xl bg-slate-50 p-4">
                      <p className="text-xs text-slate-500">
                        SKU iSeller
                      </p>

                      <p className="mt-1 break-all text-lg font-bold">
                        {selected.iseller_sku}
                      </p>

                      <p className="mt-2 text-sm">
                        {selected.source_product_name}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        Tipe iSeller:{" "}
                        {selected.source_product_type || "-"}
                      </p>

                      <p className="mt-2 text-xs text-slate-500">
                        Status: {statusLabel(selected.review_status)}
                      </p>
                    </div>

                    {selected.candidate_variant_id && (
                      <div className="rounded-xl border border-slate-200 p-4">
                        <p className="text-sm font-semibold">
                          Kandidat Otomatis
                        </p>

                        <p className="mt-2 break-all font-mono text-sm">
                          {knownVariants[
                            selected.candidate_variant_id
                          ]?.sku || "Memuat kode kandidat..."}
                        </p>

                        <p className="mt-2 text-xs text-slate-500">
                          Kandidat hanya berdasarkan normalisasi
                          format SKU. Belum tentu varian yang benar.
                        </p>

                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => {
                            setDraftVariantId(
                              selected.candidate_variant_id!
                            );
                            setDraftCategory("fashion");
                          }}
                          className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40"
                        >
                          Pilih Kandidat Ini
                        </button>
                      </div>
                    )}

                    <div>
                      <label className="mb-2 block text-sm font-semibold">
                        Kategori Produk
                      </label>

                      <select
                        value={draftCategory}
                        disabled={!canManage}
                        onChange={(event) =>
                          setDraftCategory(
                            event.target.value as Category
                          )
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
                      >
                        <option value="unclassified">
                          Belum Diklasifikasikan
                        </option>
                        <option value="fashion">Fashion</option>
                        <option value="non_fashion">Non-Fashion</option>
                      </select>
                    </div>

                    {draftCategory === "fashion" && (
                      <>
                        <div>
                          <label className="mb-2 block text-sm font-semibold">
                            Cari SKU Master WMS
                          </label>

                          <div className="flex gap-2">
                            <input
                              value={variantSearch}
                              disabled={!canManage}
                              onChange={(event) =>
                                setVariantSearch(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void findVariants();
                                }
                              }}
                              placeholder="Contoh: BZ51"
                              className="min-w-0 flex-1 rounded-xl border border-slate-300 p-3 text-sm"
                            />

                            <button
                              type="button"
                              disabled={!canManage || searchingVariant}
                              onClick={() => void findVariants()}
                              className="shrink-0 rounded-xl bg-slate-900 px-4 text-sm text-white disabled:opacity-40"
                            >
                              Cari
                            </button>
                          </div>
                        </div>

                        {variantResults.length > 0 && (
                          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                            {variantResults.map((variant) => (
                              <button
                                key={variant.id}
                                type="button"
                                disabled={!canManage}
                                onClick={() =>
                                  setDraftVariantId(variant.id)
                                }
                                className="w-full rounded-lg p-3 text-left text-sm hover:bg-slate-100 disabled:opacity-40"
                              >
                                <span className="block font-semibold">
                                  {variant.sku}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {variant.color || "-"} /{" "}
                                  {variant.size || "-"}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="rounded-xl bg-slate-50 p-4">
                          <p className="text-xs text-slate-500">
                            SKU WMS yang Dipilih
                          </p>

                          <p className="mt-1 break-all font-semibold">
                            {draftVariantId
                              ? knownVariants[draftVariantId]?.sku ||
                                "Varian terpilih"
                              : "Belum dipilih"}
                          </p>

                          {draftVariantId && (
                            <button
                              type="button"
                              disabled={!canManage}
                              onClick={() => setDraftVariantId("")}
                              className="mt-2 text-xs text-red-600 disabled:opacity-40"
                            >
                              Batalkan Pilihan
                            </button>
                          )}
                        </div>
                      </>
                    )}

                    {draftCategory === "non_fashion" && (
                      <p className="rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                        Produk non-fashion tidak dimasukkan
                        ke mapping produksi fashion.
                        Data penjualannya tetap tersimpan.
                      </p>
                    )}

                    <div>
                      <label className="mb-2 block text-sm font-semibold">
                        Catatan Verifikasi
                      </label>

                      <textarea
                        rows={3}
                        value={draftNotes}
                        disabled={!canManage}
                        onChange={(event) =>
                          setDraftNotes(event.target.value)
                        }
                        placeholder="Catatan pengecekan tim..."
                        className="w-full rounded-xl border border-slate-300 p-3 text-sm"
                      />
                    </div>

                    {!canManage && (
                      <p className="text-xs text-amber-700">
                        Hanya Owner dan Admin aktif yang
                        dapat mengubah SKU Mapping.
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canManage || saving}
                        onClick={() => void saveMapping(false)}
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium disabled:opacity-40"
                      >
                        Simpan Draft
                      </button>

                      <button
                        type="button"
                        disabled={!canManage || saving}
                        onClick={() => void saveMapping(true)}
                        className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {saving ? "Menyimpan..." : "Verifikasi Mapping"}
                      </button>
                    </div>

                    <p className="text-xs leading-6 text-slate-500">
                      Verifikasi hanya menyimpan hubungan SKU.
                      Tidak mengubah Master Products,
                      histori penjualan, atau inventory.
                    </p>
                  </div>
                )}
              </section>
            </div>

            <p className="mt-6 text-xs leading-6 text-slate-500">
              Audit awal: 20 September – 19 Oktober 2026.
              Kandidat format harus diverifikasi manual.
              Semua transaksi Bazar tetap menggunakan
              channel asalnya.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
