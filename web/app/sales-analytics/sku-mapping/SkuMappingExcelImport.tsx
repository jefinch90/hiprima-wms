"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

type Status = "pending" | "verified" | "rejected";
type Category = "fashion" | "non_fashion" | "unclassified";

type Alias = {
  id: string;
  iseller_sku: string;
  variant_id: string | null;
  category: Category;
  review_status: Status;
  notes: string | null;
  updated_at: string;
};

type Variant = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
};

type SheetData = {
  sheet: string;
  data: unknown[][];
};

type Prepared = {
  line: number;
  sku: string;
  masterSku: string;
  category: Category;
  status: "verified" | "rejected";
  variantId: string | null;
  notes: string | null;
  original: Alias;
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const skuKey = (value: unknown) =>
  String(value ?? "").trim().toUpperCase();

const cell = (row: unknown[], index: number) =>
  index < 0 ? "" : String(row[index] ?? "").trim();

function findColumn(headers: string[], candidates: string[]) {
  return headers.findIndex((h) => candidates.includes(h));
}

function parseCategory(value: string): Category | null {
  const key = normalize(value);
  if (["fashion", "produk_fashion"].includes(key)) return "fashion";
  if (["non_fashion", "nonfashion", "packaging", "kemasan"].includes(key)) {
    return "non_fashion";
  }
  if (["", "unclassified", "belum_diklasifikasikan"].includes(key)) {
    return "unclassified";
  }
  return null;
}

function parseDecision(value: string): Status | null {
  const key = normalize(value);

  if (["verified", "terverifikasi", "sudah_diverifikasi",
    "approved", "approve", "disetujui", "setuju",
    "cocok", "sesuai"].includes(key)) return "verified";

  if (["rejected", "ditolak", "reject",
    "tidak_cocok", "tidak_sesuai"].includes(key)) return "rejected";

  if (["", "pending", "belum_dicek", "belum_diperiksa",
    "menunggu", "perlu_cek", "revisi",
    "cek_ulang", "belum_diverifikasi"].includes(key)) return "pending";

  // Status pemeriksaan yang belum selesai tidak boleh disetujui otomatis.
  if (/^(belum|menunggu|perlu|butuh|pending)(_|$)/.test(key)) {
    return "pending";
  }

  return null;
}

export default function SkuMappingExcelImport({
  onCompleted,
}: {
  onCompleted: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [prepared, setPrepared] = useState<Prepared[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [filename, setFilename] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [result, setResult] = useState("");
  const [processed, setProcessed] = useState(false);

  async function checkAdmin() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Silakan login kembali.");

    const { data, error } = await supabase
      .from("profiles")
      .select("role,is_active")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (error || !data?.is_active ||
      !["owner", "admin"].includes(String(data.role))) {
      throw new Error("Akses import hanya untuk Owner/Admin aktif.");
    }
  }

  async function getAliases(): Promise<Alias[]> {
    const all: Alias[] = [];

    for (let offset = 0; offset < 10000; offset += 1000) {
      const { data, error } = await supabase
        .from("iseller_sku_aliases")
        .select("id,iseller_sku,variant_id,category,review_status,notes,updated_at")
        .order("id")
        .range(offset, offset + 999);

      if (error) throw new Error(error.message);
      all.push(...((data ?? []) as Alias[]));
      if ((data ?? []).length < 1000) return all;
    }

    throw new Error("Jumlah alias melebihi batas keamanan import.");
  }

  async function getVariants(): Promise<Variant[]> {
    const all: Variant[] = [];

    for (let offset = 0; offset < 20000; offset += 1000) {
      const { data, error } = await supabase
        .from("product_variants")
        .select("id,sku,color,size")
        .order("id")
        .range(offset, offset + 999);

      if (error) throw new Error(error.message);
      all.push(...((data ?? []) as Variant[]));
      if ((data ?? []).length < 1000) return all;
    }

    throw new Error("Jumlah Master SKU melebihi batas import.");
  }

  async function prepare(file?: File) {
    setPrepared([]);
    setErrors([]);
    setSkipped(0);
    setConfirmation(false);
    setProcessed(false);
    setResult("");
    setFilename(file?.name ?? "");

    if (!file) return;

    setLoading(true);

    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        throw new Error("Gunakan Excel .xlsx hasil verifikasi tim.");
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error("File terlalu besar. Maksimal 5 MB.");
      }

      await checkAdmin();

      const { default: readExcelFile } =
        await import("read-excel-file/browser");

      const sheets = await readExcelFile(file);

      let table: unknown[][] = [];
      let headerAt = -1;
      let headers: string[] = [];

      for (const sheet of sheets) {
        const rows = sheet.data;

        for (let i = 0; i < Math.min(rows.length, 30); i++) {
          const normalized = (rows[i] ?? []).map(normalize);

          if (findColumn(normalized, [
            "sku_iseller", "sku_seller",
            "sku_iseller_original", "sku_iseller_asli"
          ]) >= 0) {
            table = rows;
            headerAt = i;
            headers = normalized;
            break;
          }
        }

        if (headerAt >= 0) break;
      }

      if (headerAt < 0) {
        throw new Error("Kolom SKU iSeller tidak ditemukan di Excel.");
      }

      const cols = {
        sku: findColumn(headers, [
          "sku_iseller", "sku_seller",
          "sku_iseller_original", "sku_iseller_asli"
        ]),
        master: findColumn(headers, [
          "sku_wms_final", "sku_final_wms",
          "sku_master_wms", "sku_wms",
          "sku_wms_final_isi_tim"
        ]),
        category: findColumn(headers, [
          "kategori_final", "kategori_produk_final",
          "kategori_final_isi_tim"
        ]),
        decision: findColumn(headers, [
          "keputusan_tim", "keputusan_final"
        ]),
        status: findColumn(headers, [
          "status_review", "status_verifikasi",
          "status_final"
        ]),
        notes: findColumn(headers, [
          "catatan_tim", "catatan",
          "catatan_verifikasi"
        ]),
        pic: findColumn(headers, [
          "pic", "penanggung_jawab"
        ])
      };

      if (cols.master < 0 || cols.category < 0 ||
        (cols.status < 0 && cols.decision < 0)) {
        throw new Error(
          "Excel memerlukan SKU WMS Final, Kategori Final, " +
          "dan Status Review atau Keputusan Tim."
        );
      }

      const [aliases, variants] = await Promise.all([
        getAliases(), getVariants()
      ]);

      const aliasMap = new Map(
        aliases.map((a) => [skuKey(a.iseller_sku), a])
      );

      const variantMap = new Map<string, Variant[]>();

      for (const variant of variants) {
        const key = skuKey(variant.sku);
        const existing = variantMap.get(key) ?? [];
        existing.push(variant);
        variantMap.set(key, existing);
      }

      const valid: Prepared[] = [];
      const problems: string[] = [];
      const seen = new Set<string>();
      let ignored = 0;

      for (let index = headerAt + 1; index < table.length; index++) {
        const row = table[index] ?? [];
        const sku = skuKey(cell(row, cols.sku));
        if (!sku) continue;

        const line = index + 1;
        const statusRaw = cell(row, cols.status);
        const decisionRaw = cell(row, cols.decision);

        const review = parseDecision(statusRaw);
        const decision = parseDecision(decisionRaw);

        // Status asing adalah kesalahan validasi.
        // Jangan menganggapnya Pending otomatis.
        if (review === null || decision === null) {
          problems.push(
            `Baris ${line}: Status/keputusan tidak dikenal. ` +
            `Status="${statusRaw || "-"}", ` +
            `Keputusan="${decisionRaw || "-"}".`
          );
          continue;
        }

        if (
          review !== "pending" &&
          decision !== "pending" &&
          review !== decision
        ) {
          problems.push(
            `Baris ${line}: Status dan keputusan bertentangan.`
          );
          continue;
        }

        const finalStatus =
          decision !== "pending" ? decision : review;

        if (finalStatus === "pending") {
          ignored++;
          continue;
        }

        if (seen.has(sku)) {
          problems.push(`Baris ${line}: SKU duplikat ${sku}.`);
          continue;
        }
        seen.add(sku);

        const original = aliasMap.get(sku);

        if (!original) {
          problems.push(`Baris ${line}: SKU ${sku} tidak ada di daftar alias.`);
          continue;
        }

        const rawCategory = cell(row, cols.category);
        const category = parseCategory(rawCategory);

        if (!category) {
          problems.push(`Baris ${line}: Kategori tidak dikenal.`);
          continue;
        }

        const masterSku = cell(row, cols.master);
        let variantId: string | null = null;

        if (finalStatus === "verified") {
          if (category === "unclassified") {
            problems.push(`Baris ${line}: Kategori wajib ditentukan.`);
            continue;
          }

          if (category === "fashion") {
            if (!masterSku) {
              problems.push(`Baris ${line}: SKU WMS Final wajib diisi.`);
              continue;
            }

            const matches = variantMap.get(skuKey(masterSku)) ?? [];

            if (matches.length !== 1) {
              problems.push(
                `Baris ${line}: SKU WMS "${masterSku}" ` +
                (matches.length ? "ambigu." : "tidak ditemukan.")
              );
              continue;
            }

            variantId = matches[0].id;
          } else if (masterSku) {
            problems.push(
              `Baris ${line}: Non-Fashion tidak boleh memiliki SKU WMS Final.`
            );
            continue;
          }
        }

        const notes = cell(row, cols.notes);
        const pic = cell(row, cols.pic);

        const finalNotes = [
          notes || original.notes || "",
          pic ? `PIC: ${pic}` : ""
        ].filter(Boolean).join(" | ") || null;

        valid.push({
          line,
          sku,
          masterSku: finalStatus === "verified" ? masterSku : "",
          category: finalStatus === "rejected" ? "unclassified" : category,
          status: finalStatus,
          variantId,
          notes: finalNotes,
          original
        });
      }

      setPrepared(valid);
      setErrors(problems);
      setSkipped(ignored);

      setResult(
        `${valid.length} SKU siap diproses; ` +
        `${ignored} Pending dilewati; ` +
        `${problems.length} masalah. Database belum berubah.`
      );

    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "Gagal membaca Excel."
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function applyImport() {
    if (!confirmation || loading || processed ||
      !prepared.length || errors.length) return;

    setLoading(true);
    setResult("Memproses import...");

    const failures: string[] = [];
    let success = 0;

    try {
      await checkAdmin();

      for (const item of prepared) {
        try {
          // Optimistic locking: tolak perubahan bila
          // SKU telah diedit setelah preview dibuat.
          const { data: updated, error } = await supabase
            .from("iseller_sku_aliases")
            .update({
              category: item.category,
              variant_id: item.variantId,
              notes: item.notes,
              review_status:
                item.status === "verified" ? "pending" : "rejected"
            })
            .eq("id", item.original.id)
            .eq("updated_at", item.original.updated_at)
            .select("id,updated_at,review_status")
            .maybeSingle();

          if (error) throw new Error(error.message);

          if (!updated) {
            throw new Error(
              "Data berubah sejak preview. Ulangi pemeriksaan."
            );
          }

          if (item.status === "verified") {
            // Tahap kedua diperlukan karena trigger database
            // mengembalikan mapping yang berubah ke Pending.
            const { data: approved, error: approvalError } = await supabase
              .from("iseller_sku_aliases")
              .update({ review_status: "verified" })
              .eq("id", item.original.id)
              .eq("updated_at", updated.updated_at)
              .select("id,review_status")
              .maybeSingle();

            if (approvalError ||
              approved?.review_status !== "verified") {
              throw new Error(
                approvalError?.message ||
                "Draft tersimpan, tetapi persetujuan gagal."
              );
            }
          }

          success++;
        } catch (error) {
          failures.push(
            `${item.sku}: ` +
            (error instanceof Error ? error.message : "Gagal")
          );
        }
      }

      setProcessed(true);
      setErrors(failures);
      setResult(
        `${success} dari ${prepared.length} mapping berhasil. ` +
        `${failures.length} gagal. Import ulang untuk revisi/kegagalan.`
      );

      onCompleted();
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "Import gagal."
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mb-5 min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold">
        Import Excel Verifikasi SKU
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-500">
        Gunakan file Excel hasil pengecekan tim. Hanya baris dengan
        keputusan Verified atau Rejected yang diproses.
        Baris Pending tidak diubah.
      </p>

      <input
        type="file"
        accept=".xlsx"
        disabled={loading}
        className="mt-4 block w-full min-w-0 rounded-xl border border-slate-300 p-3 text-sm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void prepare(file);
        }}
      />

      {filename && (
        <p className="mt-2 break-all text-xs text-slate-500">{filename}</p>
      )}

      {result && (
        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">{result}</p>
      )}

      {errors.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="font-semibold text-red-700">
            {errors.length} masalah ditemukan
          </p>
          <div className="mt-2 max-h-40 overflow-auto text-xs text-red-700">
            {errors.slice(0, 30).map((error, index) => (
              <p key={index} className="py-1">{error}</p>
            ))}
          </div>
          {errors.length > 30 && (
            <p className="mt-2 text-xs">Masalah lainnya tidak ditampilkan.</p>
          )}
        </div>
      )}

      {prepared.length > 0 && !processed && (
        <>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <span>Siap: <b>{prepared.length}</b></span>
            <span>Verified: <b>{
              prepared.filter((p) => p.status === "verified").length
            }</b></span>
            <span>Rejected: <b>{
              prepared.filter((p) => p.status === "rejected").length
            }</b></span>
            <span>Pending dilewati: <b>{skipped}</b></span>
          </div>

          <div className="mt-4 w-full overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3">SKU iSeller</th>
                  <th className="p-3">SKU WMS Final</th>
                  <th className="p-3">Kategori</th>
                  <th className="p-3">Keputusan</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {prepared.slice(0, 20).map((row) => (
                  <tr key={row.sku}>
                    <td className="p-3 font-semibold">{row.sku}</td>
                    <td className="p-3">{row.masterSku || "-"}</td>
                    <td className="p-3">{row.category}</td>
                    <td className="p-3">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {prepared.length > 20 && (
            <p className="mt-2 text-xs text-slate-500">
              Preview 20 dari {prepared.length} baris yang telah divalidasi.
            </p>
          )}

          <label className="mt-5 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmation}
              disabled={loading || errors.length > 0}
              onChange={(event) => setConfirmation(event.target.checked)}
              className="mt-1"
            />
            <span>
              Saya sudah memeriksa hasil tim dan menyetujui
              perubahan SKU Mapping yang ditampilkan.
            </span>
          </label>

          <button
            type="button"
            disabled={!confirmation || loading || errors.length > 0}
            onClick={() => void applyImport()}
            className="mt-4 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {loading ? "Memproses..." : `Terapkan ${prepared.length} Mapping`}
          </button>
        </>
      )}
    </section>
  );
}
