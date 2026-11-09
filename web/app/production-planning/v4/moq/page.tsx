"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

type Item = {
  variant_id?: string;
  sku_master?: string;
  product_code?: string;
  color?: string;
  vendor_name?: string;
  vendor_moq_type?: string;
  vendor_moq_quantity?: number | null;
  v4_status?: string;
  v4_net_need_before_moq?: number | null;
  v4_incoming_po_final_units?: number | null;
};

type Supply = {
  variant_id: string;
  sku: string;
  incoming_po_final_units: number | null;
};

type Outside = { sku: string; qty: number };

type Group = {
  code: string;
  vendor: string;
  type: string;
  color: string;
  skuCount: number;
  need: number;
  moq: number | null;
  minimum: number | null;
  outsideQty: number;
  status: string;
};

const num = (v: unknown): number =>
  v === null || v === undefined || v === ""
    ? 0
    : Number.isFinite(Number(v)) ? Number(v) : 0;

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat("id-ID", {
        maximumFractionDigits: 2,
      }).format(v);

export default function MOQReviewPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [outside, setOutside] = useState<Outside[]>([]);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");

  async function run() {
    if (busy) return;
    setBusy(true);
    setComplete(false);
    setItems([]);
    setOutside([]);
    setError("");
    setMessage("Memuat simulasi V4...");

    try {
      const db = createClient();
      const { data: auth, error: authError } = await db.auth.getUser();

      if (authError || !auth.user) {
        throw new Error("Sesi login WMS tidak aktif. Login ulang.");
      }

      const collected: Item[] = [];
      const seen = new Set<string>();
      let finished = false;

      for (let page = 0; page < 20; page++) {
        const { data, error: rpcError } = await db.rpc(
          "get_fashion_production_preview_v4",
          {
            p_lead_time_days: 30,
            p_review_days: 7,
            p_limit: 100,
            p_offset: page * 100,
          }
        );

        if (rpcError) throw new Error(rpcError.message);
        if (!Array.isArray(data)) {
          throw new Error("Format hasil V4 tidak sesuai.");
        }

        for (const row of data as Item[]) {
          const id = String(row.variant_id || "");
          if (!id || seen.has(id)) {
            throw new Error("Variant ID kosong atau duplikat.");
          }
          seen.add(id);
          collected.push(row);
        }

        setMessage(`${collected.length} SKU dibaca...`);

        if (data.length < 100) {
          finished = true;
          break;
        }
      }

      if (!finished || collected.length === 0) {
        throw new Error("Pengambilan SKU belum lengkap.");
      }

      // Verifikasi cakupan incoming menggunakan sumber WMS.
      const { data: supply, error: supplyError } = await db
        .from("wms_planning_supply_v4")
        .select("variant_id,sku,incoming_po_final_units")
        .gt("incoming_po_final_units", 0)
        .range(0, 999);

      if (supplyError) throw new Error(supplyError.message);
      if (!supply || supply.length >= 1000) {
        throw new Error("Daftar incoming belum lengkap.");
      }

      const excluded = (supply as Supply[])
        .filter((row) => !seen.has(row.variant_id))
        .map((row) => ({
          sku: row.sku,
          qty: num(row.incoming_po_final_units),
        }));

      setItems(collected);
      setOutside(excluded);
      setComplete(true);
      setMessage(
        `${collected.length} SKU selesai. Review MOQ siap diperiksa.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat V4.1");
      setMessage("Data belum lengkap. Jangan gunakan rekomendasi.");
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo<Group[]>(() => {
    type Acc = {
      code: string;
      vendor: string;
      type: string;
      color: string;
      skuCount: number;
      need: number;
      invalid: boolean;
      moqs: Set<number>;
      missingMoq: boolean;
    };

    const map = new Map<string, Acc>();

    for (const item of items) {
      if (item.v4_status !== "SIMULATION_ONLY") continue;

      const code = String(item.product_code || "").trim().toUpperCase();
      const vendor = String(item.vendor_name || "").trim();
      const type = String(item.vendor_moq_type || "").trim().toUpperCase();
      const color = type === "PER_COLOR"
        ? String(item.color || "").trim().toUpperCase()
        : "SEMUA WARNA";

      const key = JSON.stringify([code, vendor, type, color]);

      let group = map.get(key);
      if (!group) {
        group = {
          code, vendor, type, color,
          skuCount: 0, need: 0, invalid: false,
          moqs: new Set<number>(), missingMoq: false,
        };
        map.set(key, group);
      }

      group.skuCount++;

      if (item.v4_net_need_before_moq == null ||
          !Number.isFinite(Number(item.v4_net_need_before_moq))) {
        group.invalid = true;
      } else {
        group.need += num(item.v4_net_need_before_moq);
      }

      if (item.vendor_moq_quantity == null ||
          !Number.isFinite(Number(item.vendor_moq_quantity))) {
        group.missingMoq = true;
      } else {
        group.moqs.add(Number(item.vendor_moq_quantity));
      }
    }

    const codes = [...new Set(
      [...map.values()].map((g) => g.code).filter(Boolean)
    )].sort((a, b) => b.length - a.length);

    const outsideByCode = new Map<string, number>();

    for (const entry of outside) {
      const sku = entry.sku.toUpperCase().trim();
      // Pencocokan awalan hanya untuk flag review,
      // bukan untuk mengubah kebutuhan produksi.
      const code = codes.find((c) => sku.startsWith(c));
      if (code) {
        outsideByCode.set(
          code, (outsideByCode.get(code) || 0) + entry.qty
        );
      }
    }

    return [...map.values()].map((g) => {
      const moq = g.moqs.size === 1 ? [...g.moqs][0] : null;
      const outsideQty = outsideByCode.get(g.code) || 0;

      let status = "SIAP_REVIEW";

      if (!g.code || !g.vendor || g.invalid) {
        status = "REVIEW_DATA";
      } else if (outsideQty > 0) {
        status = "REVIEW_SKU_DI_LUAR_SIMULASI";
      } else if (g.need === 0) {
        status = "TIDAK_PERLU_PRODUKSI";
      } else if (g.type === "BY_REQUEST") {
        status = "KONFIRMASI_VENDOR";
      } else if (!["PER_PRODUCT", "PER_COLOR"].includes(g.type)) {
        status = "REVIEW_ATURAN_MOQ";
      } else if (g.type === "PER_COLOR" && !g.color) {
        status = "REVIEW_WARNA";
      } else if (g.missingMoq || moq === null ||
                 moq <= 0 || g.moqs.size !== 1) {
        status = "REVIEW_NILAI_MOQ";
      } else if (g.need < moq) {
        status = "REVIEW_KELEBIHAN_MOQ";
      }

      const minimum =
        moq !== null &&
        moq > 0 &&
        ["PER_PRODUCT", "PER_COLOR"].includes(g.type) &&
        !g.invalid &&
        g.need > 0 &&
        outsideQty === 0
          ? Math.max(Math.ceil(g.need), moq)
          : null;

      return {
        code: g.code,
        vendor: g.vendor,
        type: g.type,
        color: g.color,
        skuCount: g.skuCount,
        need: g.need,
        moq,
        minimum,
        outsideQty,
        status,
      };
    }).sort((a, b) => b.need - a.need);
  }, [items, outside]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    return groups.filter((g) => {
      const matches =
        !q ||
        `${g.code} ${g.vendor} ${g.color}`.toLowerCase().includes(q);

      if (filter === "READY") return matches && g.status === "SIAP_REVIEW";
      if (filter === "LOW") return matches &&
        g.status === "REVIEW_KELEBIHAN_MOQ";
      if (filter === "VENDOR") return matches &&
        g.status === "KONFIRMASI_VENDOR";
      if (filter === "ISSUE") return matches &&
        !["SIAP_REVIEW", "TIDAK_PERLU_PRODUKSI",
          "REVIEW_KELEBIHAN_MOQ", "KONFIRMASI_VENDOR"].includes(g.status);

      return matches;
    });
  }, [groups, search, filter]);

  const totalOutside = outside.reduce((sum, x) => sum + x.qty, 0);

  const cards = [
    ["Kelompok Model / Warna", groups.length],
    ["Memenuhi MOQ", groups.filter(g => g.status === "SIAP_REVIEW").length],
    ["Kebutuhan di Bawah MOQ", groups.filter(g => g.status === "REVIEW_KELEBIHAN_MOQ").length],
    ["Konfirmasi Vendor", groups.filter(g => g.status === "KONFIRMASI_VENDOR").length],
    ["Incoming di Luar Simulasi", `${fmt(totalOutside)} pcs`],
  ] as const;

  return (
    <main className="w-full min-w-0 max-w-full overflow-x-hidden px-4 py-6 md:px-8">
      <div className="mx-auto flex max-w-[1600px] min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">
              HI.PRIMA WMS / PRODUCTION PLANNING
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Review MOQ Produksi V4.1
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Kebutuhan bersih dikelompokkan berdasarkan model dan warna.
            </p>
          </div>
          <Link
            href="/production-planning/v4/"
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm"
          >
            Kembali ke V4
          </Link>
        </div>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>SIMULASI / REVIEW SAJA — TIDAK MEMBUAT PO.</strong>
          {" "}MOQ adalah jumlah minimum, bukan kelipatan otomatis.
          Estimasi minimum tidak berarti jumlah yang disetujui.
          Periksa freshness data penjualan, stok, distribusi SKU,
          dan approval sebelum memesan.
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Memproses..." : "Jalankan Review MOQ V4.1"}
          </button>
          <span role="status" className="text-sm text-slate-600">
            {message || "Data belum dimuat."}
          </span>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {complete && totalOutside > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>Perlu rekonsiliasi: {fmt(totalOutside)} pcs incoming tidak tercakup di preview.</strong>
            <p className="mt-1">
              {outside.map((x) => `${x.sku}: ${fmt(x.qty)} pcs`).join("; ")}
            </p>
            <p className="mt-1">
              Kebutuhan kelompok terkait tidak boleh langsung dijadikan jumlah PO.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {cards.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-2 text-xl font-bold text-slate-900">
                {value}
              </p>
            </div>
          ))}
        </div>

        <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <h2 className="font-bold text-slate-900">
                Rekomendasi Minimum — Perlu Review
              </h2>
              <p className="text-xs text-slate-500">
                {visible.length} kelompok ditampilkan.
                {complete ? " Data lengkap untuk preview yang dibaca." : " Belum lengkap."}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari produk atau vendor"
                className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="ALL">Semua Kelompok</option>
                <option value="READY">Memenuhi MOQ</option>
                <option value="LOW">Di Bawah MOQ</option>
                <option value="VENDOR">Konfirmasi Vendor</option>
                <option value="ISSUE">Masalah Data</option>
              </select>
            </div>
          </div>

          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[1150px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {[
                    "Produk", "Vendor", "Aturan MOQ", "Kelompok Warna",
                    "SKU", "Kebutuhan Bersih", "MOQ", "Estimasi Minimum",
                    "Review"
                  ].map((name) => (
                    <th key={name} className="whitespace-nowrap border-b border-slate-200 px-3 py-3">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((g, index) => (
                  <tr key={`${g.code}-${g.vendor}-${g.type}-${g.color}-${index}`}
                      className="border-b border-slate-100 align-top">
                    <td className="px-3 py-3 font-semibold">{g.code}</td>
                    <td className="px-3 py-3">{g.vendor}</td>
                    <td className="px-3 py-3">{g.type || "—"}</td>
                    <td className="px-3 py-3">{g.color}</td>
                    <td className="px-3 py-3">{g.skuCount}</td>
                    <td className="px-3 py-3 font-semibold">{fmt(g.need)}</td>
                    <td className="px-3 py-3">{fmt(g.moq)}</td>
                    <td className="px-3 py-3 font-semibold">{fmt(g.minimum)}</td>
                    <td className="px-3 py-3">
                      <span className={
                        g.status === "SIAP_REVIEW"
                          ? "font-semibold text-emerald-700"
                          : "font-semibold text-amber-700"
                      }>
                        {g.status.replaceAll("_", " ")}
                      </span>
                      {g.outsideQty > 0 && (
                        <p className="mt-1 text-xs text-red-700">
                          {fmt(g.outsideQty)} pcs incoming di luar preview
                        </p>
                      )}
                      {g.status === "REVIEW_KELEBIHAN_MOQ" &&
                       g.minimum !== null && (
                        <p className="mt-1 text-xs text-amber-700">
                          Tambahan minimum {fmt(g.minimum - g.need)} pcs
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      {complete ? "Tidak ada kelompok sesuai filter." :
                        "Jalankan review MOQ terlebih dahulu."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-xs text-slate-500">
          Perhitungan hanya untuk SKU berstatus SIMULATION_ONLY.
          Produk Hold, Discontinue, Seasonal tanpa approval, dan vendor belum
          verified tidak dimasukkan ke kelompok rekomendasi. Halaman ini
          tidak dapat membuat maupun memfinalisasi PO.
        </p>
      </div>
    </main>
  );
}