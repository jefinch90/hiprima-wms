"use client";

import Link from "next/link";

import { useEffect, useMemo, useState } from "react";

import { readSheet } from "read-excel-file/browser";

import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type SaleRow = {
  import_id?: string;
  source_row_no: number;
  sale_date: string;
  product_title: string;
  product_type: string;
  sku: string;
  variant_name: string;
  source_channel: string;
  source_account: string;
  source_user: string;
  sale_hour: string;
  unit_price: number;
  orders_count: number;
  units_sold: number;
  gross_sales: number;
  refund_amount: number;
  units_returned: number;
  discount_amount: number;
  promotion_amount: number;
  net_sales: number;
};

type ImportBatch = {
  id: string;
  file_name: string;
  status: string;
  expected_rows: number;
  created_at: string;
  period_start: string | null;
  period_end: string | null;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;

  const text = String(value ?? "").trim();

  if (!text) return 0;

  const cleaned = text.replace(/[^\d,.-]/g, "");

  if (
    /^-?\d{1,3}(\.\d{3})+$/.test(cleaned)
  ) {
    return Number(cleaned.replace(/\./g, ""));
  }

  if (
    /^-?\d{1,3}(,\d{3})+$/.test(cleaned)
  ) {
    return Number(cleaned.replace(/,/g, ""));
  }

  return Number(cleaned.replace(",", "."));
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof value === "number") {
    const date = new Date(
      Date.UTC(1899, 11, 30) +
      Math.floor(value) * 86400000
    );
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString().slice(0, 10);
  }

  const text = String(value ?? "").trim();

  const matched = text.match(
    /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/
  );

  if (matched) {
    const months = [
      "january", "february", "march",
      "april", "may", "june",
      "july", "august", "september",
      "october", "november", "december"
    ];

    const month = months.indexOf(
      matched[1].toLowerCase()
    );

    const day = Number(matched[2]);
    const year = Number(matched[3]);

    if (month < 0) return null;

    const date = new Date(Date.UTC(year, month, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day
    ) return null;

    return date.toISOString().slice(0, 10);
  }

  const iso = text.match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!iso) return null;

  const date = new Date(`${text}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === text
      ? text
      : null;
}

function rupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function integer(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

function parseIseller(rows: unknown[][]): SaleRow[] {
  const headerIndex = rows.findIndex((row) => {
    const values = row.map(normalize);

    return (
      values.includes("judul produk") &&
      values.includes("nomor sku") &&
      values.includes("unit terjual") &&
      values.includes("penjualan bersih") &&
      values.includes("unit dikembalikan")
    );
  });

  if (headerIndex < 0) {
    throw new Error(
      "Gunakan Excel iSeller dengan header laporan penjualan yang benar."
    );
  }

  const headers = rows[headerIndex].map(normalize);

  const column = (name: string) =>
    headers.indexOf(name);

  const required = [
    "judul produk",
    "hari",
    "tipe produk",
    "nomor sku",
    "nama varian",
    "channel",
    "akun",
    "jam",
    "harga",
    "pesanan",
    "unit terjual",
    "penjualan kotor",
    "pengembalian dana",
    "unit dikembalikan",
    "diskon",
    "promosi",
    "penjualan bersih"
  ];

  const missing = required.filter(
    (name) => column(name) < 0
  );

  if (missing.length) {
    throw new Error(
      "Kolom tidak lengkap: " + missing.join(", ")
    );
  }

  const get = (
    row: unknown[],
    name: string
  ): unknown => row[column(name)];

  const result: SaleRow[] = [];
  const keys = new Set<string>();

  let invalid = 0;

  for (
    let i = headerIndex + 1;
    i < rows.length;
    i++
  ) {
    const row = rows[i];

    if (
      !row ||
      row.every(
        (v) =>
          v == null ||
          String(v).trim() === ""
      )
    ) continue;

    const title = String(
      get(row, "judul produk") ?? ""
    ).trim();

    if (
      ["total", "totals"].includes(normalize(title))
    ) continue;

    const sku = String(
      get(row, "nomor sku") ?? ""
    ).trim();

    const saleDate = parseDate(
      get(row, "hari")
    );

    const type = String(
      get(row, "tipe produk") ?? ""
    ).trim();

    const variant = String(
      get(row, "nama varian") ?? ""
    ).trim();

    const channel = String(
      get(row, "channel") ?? ""
    ).trim();

    const account = String(
      get(row, "akun") ?? ""
    ).trim();

    const sourceUser = column("pengguna") >= 0
      ? String(get(row, "pengguna") ?? "").trim()
      : "";

    const hour = String(
      get(row, "jam") ?? ""
    ).trim();

    const price = parseNumber(
      get(row, "harga")
    );

    const orders = parseNumber(
      get(row, "pesanan")
    );

    const units = parseNumber(
      get(row, "unit terjual")
    );

    const gross = parseNumber(
      get(row, "penjualan kotor")
    );

    const refund = parseNumber(
      get(row, "pengembalian dana")
    );

    const returned = parseNumber(
      get(row, "unit dikembalikan")
    );

    const discount = parseNumber(
      get(row, "diskon")
    );

    const promo = parseNumber(
      get(row, "promosi")
    );

    const net = parseNumber(
      get(row, "penjualan bersih")
    );

    const amounts = [
      price, orders, units, gross,
      refund, returned, discount,
      promo, net
    ];

    const invalidRow =
      !title ||
      !sku ||
      !saleDate ||
      !hour ||
      !amounts.every(Number.isFinite) ||
      ![orders, units, returned].every(
        Number.isInteger
      ) ||
      [
        price, orders, units, gross,
        refund, returned, discount, promo
      ].some((n) => n < 0) ||
      Math.abs(
        gross - refund - discount - promo - net
      ) > 0.02;

    if (invalidRow) {
      invalid++;
      continue;
    }

    const key = JSON.stringify([
      saleDate,
      sku.toLowerCase(),
      title.toLowerCase(),
      type.toLowerCase(),
      variant.toLowerCase(),
      channel.toLowerCase(),
      account.toLowerCase(),
      sourceUser.toLowerCase(),
      hour.toLowerCase(),
      price
    ]);

    if (keys.has(key)) {
      invalid++;
      continue;
    }

    keys.add(key);

    result.push({
      source_row_no: i + 1,
      sale_date: saleDate,
      product_title: title,
      product_type: type,
      sku,
      variant_name: variant,
      source_channel: channel,
      source_account: account,
      source_user: sourceUser,
      sale_hour: hour,
      unit_price: price,
      orders_count: orders,
      units_sold: units,
      gross_sales: gross,
      refund_amount: refund,
      units_returned: returned,
      discount_amount: discount,
      promotion_amount: promo,
      net_sales: net
    });
  }

  if (invalid > 0) {
    throw new Error(
      `${invalid} baris tidak valid atau duplikat. ` +
      "Import dibatalkan agar data tetap akurat."
    );
  }

  if (!result.length) {
    throw new Error(
      "Tidak ada transaksi untuk diimpor."
    );
  }

  return result;
}

async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  const digest = await crypto.subtle.digest(
    "SHA-256",
    buffer
  );

  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export default function SalesAnalyticsPage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SaleRow[]>([]);
  const [skippedExisting, setSkippedExisting] = useState(0);
  const [skippedToday, setSkippedToday] = useState(0);
  const [newestImportedDate, setNewestImportedDate] = useState<string | null>(null);

  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [batches, setBatches] = useState<ImportBatch[]>([]);

  const [showAllHistory, setShowAllHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);

  async function loadBatches() {
    const pageSize = showAllHistory ? 20 : 5;
    const currentPage = showAllHistory ? historyPage : 1;

    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabase
      .from("iseller_import_batches")
      .select(
        "id,file_name,status,expected_rows,created_at,period_start,period_end",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setBatches((data ?? []) as ImportBatch[]);
    setHistoryTotal(count ?? 0);
  }

  useEffect(() => {
    void loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAllHistory, historyPage]);

  async function handleFile(selected: File) {
    setErrorMessage("");
    setSuccessMessage("");
    setPreview([]);
    setSkippedExisting(0);
    setSkippedToday(0);
    setNewestImportedDate(null);
    setFile(null);
    setProgress(0);
    setParsing(true);

    try {
      if (!selected.name.toLowerCase().endsWith(".xlsx")) {
        throw new Error(
          "Gunakan file Excel .xlsx hasil export iSeller."
        );
      }

      const rows = (await readSheet(
        selected
      )) as unknown as unknown[][];

      const parsed = parseIseller(rows);
      const hasUserColumn = rows.some((row) =>
        row.map(normalize).includes("pengguna") &&
        row.map(normalize).includes("nomor sku")
      );

      const { data: latestBatch, error: latestError } = await supabase
        .from("iseller_import_batches")
        .select("period_end")
        .eq("status", "completed")
        .not("period_end", "is", null)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) throw new Error(latestError.message);

      const latestDate = latestBatch?.period_end ?? null;
      const jakartaParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const datePart = (type: string) =>
        jakartaParts.find((part) => part.type === type)?.value ?? "";
      const todayJakarta = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;

      const newRows = parsed.filter(
        (row) => (!latestDate || row.sale_date > latestDate) &&
          row.sale_date < todayJakarta
      );

      const oldRows = parsed.filter(
        (row) => latestDate !== null && row.sale_date <= latestDate
      ).length;
      const todayRows = parsed.filter(
        (row) => row.sale_date >= todayJakarta
      ).length;

      if (!hasUserColumn) {
        throw new Error(
          "Kolom Pengguna belum ditemukan. Export ulang 18 kolom dari iSeller agar WhatsApp tidak hilang."
        );
      }

      if (newRows.length === 0) {
        throw new Error(
          `Tidak ada tanggal penjualan baru yang lengkap untuk diimport. ` +
          `Terakhir diimport: ${latestDate ?? "belum ada"}. ` +
          `${oldRows} baris lama dan ${todayRows} baris hari ini dilewati.`
        );
      }

      setFile(selected);
      setPreview(newRows);
      setSkippedExisting(oldRows);
      setSkippedToday(todayRows);
      setNewestImportedDate(latestDate);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Gagal membaca file Excel."
      );
    } finally {
      setParsing(false);
    }
  }

  const summary = useMemo(() => {
    if (!preview.length) return null;

    const dates = preview.map(
      (row) => row.sale_date
    );

    const sum = (
      getValue: (row: SaleRow) => number
    ) =>
      preview.reduce(
        (total, row) => total + getValue(row),
        0
      );

    return {
      rows: preview.length,

      sku: new Set(
        preview.map((row) => row.sku.toLowerCase())
      ).size,

      units: sum((row) => row.units_sold),

      returned: sum(
        (row) => row.units_returned
      ),

      orders: sum(
        (row) => row.orders_count
      ),

      gross: sum(
        (row) => row.gross_sales
      ),

      refunds: sum(
        (row) => row.refund_amount
      ),

      discount: sum(
        (row) => row.discount_amount
      ),

      promotion: sum(
        (row) => row.promotion_amount
      ),

      net: sum(
        (row) => row.net_sales
      ),

      types: new Set(
        preview.map(
          (row) => row.product_type
        ).filter(Boolean)
      ).size,

      hours: new Set(
        preview.map((row) => row.sale_hour)
      ).size,

      start: dates.reduce(
        (a, b) => a < b ? a : b
      ),

      end: dates.reduce(
        (a, b) => a > b ? a : b
      ),

      users: new Set(preview.map((row) => normalize(row.source_user)).filter(Boolean)).size,

      whatsapp: preview.filter((row) =>
        normalize(row.source_channel) === "pos" &&
        !/^BAZAR(?:\s|$)/i.test(row.product_title.trim()) &&
        normalize(row.source_user) === "admin online"
      ).length,

      offline: preview.filter((row) =>
        normalize(row.source_channel) === "pos" &&
        !/^BAZAR(?:\s|$)/i.test(row.product_title.trim()) &&
        normalize(row.source_user) === "kasir 1 store"
      ).length,

      unknownPos: preview.filter((row) =>
        normalize(row.source_channel) === "pos" &&
        !/^BAZAR(?:\s|$)/i.test(row.product_title.trim()) &&
        !["admin online", "kasir 1 store"].includes(normalize(row.source_user))
      ).length,

      bazar: preview.filter(
        (row) =>
          normalize(row.source_channel) === "pos" &&
          /^BAZAR(?:\s|$)/i.test(
            row.product_title.trim()
          )
      ).length
    };
  }, [preview]);

  async function handleImport() {
    if (!file || !summary || uploading) return;

    setUploading(true);
    setProgress(0);
    setErrorMessage("");
    setSuccessMessage("");

    let createdBatchId: string | null = null;

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        throw new Error(
          "Sesi login tidak ditemukan."
        );
      }

      const fileHash = await hashFile(file);

      const { data: existing, error: checkError } =
        await supabase
          .from("iseller_import_batches")
          .select("id,status")
          .eq("file_sha256", fileHash)
          .maybeSingle();

      if (checkError) {
        throw new Error(checkError.message);
      }

      if (existing) {
        throw new Error(
          "File ini sudah pernah didaftarkan. " +
            "Import ulang dibatalkan untuk mencegah duplikasi."
        );
      }

      // Prevent importing overlapping reporting periods.
      // Existing completed imports remain untouched.
      const { data: overlapping, error: overlapError } =
        await supabase
          .from("iseller_import_batches")
          .select("file_name,period_start,period_end")
          .eq("status", "completed")
          .lte("period_start", summary.end)
          .gte("period_end", summary.start)
          .limit(1);

      if (overlapError) {
        throw new Error(overlapError.message);
      }

      if (overlapping && overlapping.length > 0) {
        const previous = overlapping[0];

        throw new Error(
          "Periode laporan bertumpang tindih dengan import sebelumnya: " +
          previous.file_name +
          " (" +
          previous.period_start +
          " s/d " +
          previous.period_end +
          "). Import dibatalkan untuk mencegah data ganda."
        );
      }

      const { data: batch, error: batchError } =
        await supabase
          .from("iseller_import_batches")
          .insert({
            file_name: file.name,
            file_sha256: fileHash,
            period_start: summary.start,
            period_end: summary.end,
            expected_rows: preview.length,
            status: "uploading",
            created_by: user.id,
          })
          .select("id")
          .single();

      if (batchError || !batch) {
        throw new Error(
          batchError?.message ??
            "Gagal membuat batch import."
        );
      }

      createdBatchId = batch.id;

      const chunkSize = 250;

      for (
        let offset = 0;
        offset < preview.length;
        offset += chunkSize
      ) {
        const chunk = preview
          .slice(offset, offset + chunkSize)
          .map((row) => ({
            ...row,
            import_id: createdBatchId,
          }));

        const { error } = await supabase
          .from("iseller_sales_daily")
          .insert(chunk);

        if (error) {
          throw new Error(error.message);
        }

        setProgress(
          Math.round(
            (Math.min(
              offset + chunkSize,
              preview.length
            ) /
              preview.length) *
              100
          )
        );
      }

      const { error: finalizeError } =
        await supabase.rpc("finalize_iseller_import", {
          p_import_id: createdBatchId,
        });

      if (finalizeError) {
        throw new Error(finalizeError.message);
      }

      createdBatchId = null;

      setSuccessMessage(
        `${integer(preview.length)} baris ` +
          "berhasil diimpor ke Sales Analytics."
      );

      setPreview([]);
      setFile(null);
      setSkippedExisting(0);
      setSkippedToday(0);
      setProgress(100);

      await loadBatches();
    } catch (error) {
      if (createdBatchId) {
        const { error: cleanupError } =
          await supabase
            .from("iseller_import_batches")
            .delete()
            .eq("id", createdBatchId);

        if (cleanupError) {
          setErrorMessage(
            "Import gagal dan batch sementara belum " +
              "dapat dibersihkan: " +
              cleanupError.message
          );
          setUploading(false);
          return;
        }
      }

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Import gagal."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">
          <div className="mx-auto w-full min-w-0 max-w-[1400px]">
            <div className="mb-8">
              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <h1 className="mt-2 text-3xl font-bold">
                Sales Analytics
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Import data iSeller untuk analisis
                penjualan dan perencanaan produksi.
              </p>
              <div className="mt-5">
                <Link
                  href="/sales-analytics/dashboard"
                  className="inline-flex items-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Buka Dashboard Sales Analytics →
                </Link>
              </div>
            </div>

            {errorMessage && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            {successMessage && (
              <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                {successMessage}
              </div>
            )}

            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">
                Import Excel iSeller
              </h2>

              <p className="mt-2 text-sm text-slate-500">
                Gunakan Export Root Table,
                format Excel 18 kolom (termasuk Pengguna) dan Semua Channel.
              </p>

              <div className="mt-5">
                <input
                  type="file"
                  accept=".xlsx"
                  disabled={uploading || parsing}
                  onChange={(event) => {
                    const selected =
                      event.target.files?.[0];

                    if (selected) {
                      void handleFile(selected);
                    }

                    event.target.value = "";
                  }}
                  className="block w-full min-w-0 rounded-xl border border-slate-300 p-3 text-sm"
                />
              </div>

              {parsing && (
                <p className="mt-4 text-sm text-slate-500">
                  Membaca dan memvalidasi Excel...
                </p>
              )}

              {summary && (
                <div className="mt-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      ["Baris Data", integer(summary.rows)],
                      ["SKU Unik", integer(summary.sku)],
                      ["Pengguna Unik", integer(summary.users)],
                      ["Baris WhatsApp", integer(summary.whatsapp)],
                      ["Baris Offline Store", integer(summary.offline)],
                      ["POS Perlu Review", integer(summary.unknownPos)],
                      ["Baris Lama Dilewati", integer(skippedExisting)],
                      ["Unit Terjual", integer(summary.units)],
                      [
                        "Penjualan Kotor",
                        rupiah(summary.gross),
                      ],
                      [
                        "Pengembalian Dana",
                        rupiah(summary.refunds),
                      ],
                      [
                        "Jumlah Pesanan (agregat)",
                        integer(summary.orders),
                      ],
                      [
                        "Unit Dikembalikan",
                        integer(summary.returned),
                      ],
                      ["Diskon", rupiah(summary.discount)],
                      ["Promosi", rupiah(summary.promotion)],
                      [
                        "Penjualan Bersih",
                        rupiah(summary.net),
                      ],
                      [
                        "Kategori Produk",
                        integer(summary.types),
                      ],
                      [
                        "Jam Penjualan",
                        integer(summary.hours),
                      ],
                      [
                        "Baris Bazar",
                        integer(summary.bazar),
                      ],
                      [
                        "Periode",
                        `${summary.start} s/d ${summary.end}`,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="text-xs text-slate-500">
                          {label}
                        </div>

                        <div className="mt-2 break-words text-lg font-bold">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Data ini hanya untuk analitik.
                    Import tidak akan mengurangi stok.
                    BAZAR diprioritaskan, Admin Online = WhatsApp,
                    Kasir 1 Store = Offline Store.
                    POS dengan pengguna lain masih perlu review.
                    {newestImportedDate && (
                      <span className="mt-2 block">
                        Impor terakhir sampai {newestImportedDate}. Data tanggal sebelumnya
                        ({integer(skippedExisting)} baris) dilewati otomatis.
                      </span>
                    )}
                    {skippedToday > 0 && (
                      <span className="mt-2 block">
                        {integer(skippedToday)} baris hari ini dilewati karena belum sehari penuh.
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => void handleImport()}
                    className="mt-5 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {uploading
                      ? `Mengimpor... ${progress}%`
                      : "Import Data ke WMS"}
                  </button>
                </div>
              )}
            </section>

            <section className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-6">
                <div>
                  <h2 className="text-lg font-semibold">
                    Riwayat Import
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    {showAllHistory
                      ? `${historyTotal} riwayat import`
                      : "5 import terbaru"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowAllHistory(!showAllHistory);
                    setHistoryPage(1);
                  }}
                  className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {showAllHistory
                    ? "Tampilkan 5 Terbaru"
                    : "Lihat Semua Riwayat"}
                </button>
              </div>

              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-4">Tanggal Import</th>
                      <th className="p-4">Nama File</th>
                      <th className="p-4">Periode Data</th>
                      <th className="p-4">Baris</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {batches.map((batch) => (
                      <tr key={batch.id}>
                        <td className="whitespace-nowrap p-4">
                          {new Date(
                            batch.created_at
                          ).toLocaleString("id-ID")}
                        </td>

                        <td className="max-w-[280px] break-all p-4">
                          {batch.file_name}
                        </td>

                        <td className="whitespace-nowrap p-4">
                          {batch.period_start && batch.period_end
                            ? `${batch.period_start} s/d ${batch.period_end}`
                            : "-"}
                        </td>

                        <td className="whitespace-nowrap p-4">
                          {integer(batch.expected_rows)}
                        </td>

                        <td className="p-4">
                          <span className={
                            batch.status === "completed"
                              ? "rounded-lg bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                              : batch.status === "failed"
                              ? "rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"
                              : "rounded-lg bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
                          }>
                            {batch.status === "completed"
                              ? "Berhasil"
                              : batch.status === "failed"
                              ? "Gagal"
                              : "Diproses"}
                          </span>
                        </td>
                      </tr>
                    ))}

                    {batches.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-10 text-center text-slate-500"
                        >
                          Belum ada histori import.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {showAllHistory && historyTotal > 20 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4">
                  <p className="text-sm text-slate-500">
                    Halaman {historyPage} dari{" "}
                    {Math.ceil(historyTotal / 20)}
                  </p>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={historyPage <= 1}
                      onClick={() =>
                        setHistoryPage((page) =>
                          Math.max(1, page - 1)
                        )
                      }
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
                    >
                      Previous
                    </button>

                    <button
                      type="button"
                      disabled={
                        historyPage >= Math.ceil(historyTotal / 20)
                      }
                      onClick={() =>
                        setHistoryPage((page) => page + 1)
                      }
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
