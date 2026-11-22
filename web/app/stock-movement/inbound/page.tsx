"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

// HIPRIMA_INBOUND_QC_BATCH_V43K - Satu SKU, satu penerimaan, tiga hasil QC.
type QcCode = "NORMAL" | "DEFECT" | "REJECT";
type Sku = {
  variant_id: string;
  sku: string;
  product_name: string;
  product_code: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  total_qty: number;
};
type Rack = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  current_qty: number;
};
type ReceiptItem = {
  qc: QcCode;
  qty: number;
  location_id: string;
  movement_no: number;
};
type Receipt = {
  receipt_no: string;
  request_id: string;
  total_qty: number;
  items: ReceiptItem[];
};

const codes: QcCode[] = ["NORMAL", "DEFECT", "REJECT"];
const labels: Record<QcCode, string> = {
  NORMAL: "Normal",
  DEFECT: "Defect",
  REJECT: "Reject",
};
const hints: Record<QcCode, string> = {
  NORMAL: "Siap jual",
  DEFECT: "Barang cacat, stok terpisah",
  REJECT: "Tidak lolos QC, stok terpisah",
};
const field = "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500";
const number = (n: number) => n.toLocaleString("id-ID");
const newId = () => globalThis.crypto?.randomUUID?.() ?? "";

export default function InboundStockPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [backendReady, setBackendReady] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Sku[]>([]);
  const [chosen, setChosen] = useState<Sku | null>(null);
  const [racks, setRacks] = useState<Record<QcCode, Rack[]>>({NORMAL: [], DEFECT: [], REJECT: []});
  const [rackIds, setRackIds] = useState<Record<QcCode, string>>({NORMAL: "", DEFECT: "", REJECT: ""});
  const [totalText, setTotalText] = useState("");
  const [defectText, setDefectText] = useState("0");
  const [rejectText, setRejectText] = useState("0");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const {data: {user}} = await supabase.auth.getUser();
      if (!active) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      // Cek versi fungsi hanya membaca kesiapan backend; tidak menulis stok.
      const {data, error} = await supabase.rpc("wms_inbound_qc_version");
      if (active) setBackendReady(!error && data === "V4.3K");
    })();
    return () => {active = false;};
  }, [router, supabase]);

  const total = Number(totalText);
  const defect = Number(defectText);
  const reject = Number(rejectText);
  const validNumbers =
    totalText.trim() !== "" && [total, defect, reject].every(n => Number.isSafeInteger(n) && n >= 0) && total > 0;
  const normal = validNumbers ? total - defect - reject : 0;
  const qtyByQc: Record<QcCode, number> = {NORMAL: normal, DEFECT: defect, REJECT: reject};
  const splitValid = validNumbers && normal >= 0;
  const racksValid = splitValid && codes.every(qc => qtyByQc[qc] === 0 || !!rackIds[qc]);
  const recommendedNormal =
    racks.NORMAL.length > 1 &&
    Number(racks.NORMAL[0]?.current_qty ?? 0) > 0 &&
    Number(racks.NORMAL[0]?.current_qty ?? 0) >
      Number(racks.NORMAL[1]?.current_qty ?? 0)
      ? racks.NORMAL[0]
      : null;

  function invalidateRequest() {
    setRequestId(newId());
    setErrorText("");
  }

  function reset() {
    setSearch(""); setResults([]); setChosen(null);
    setRacks({NORMAL: [], DEFECT: [], REJECT: []});
    setRackIds({NORMAL: "", DEFECT: "", REJECT: ""});
    setTotalText(""); setDefectText("0"); setRejectText("0");
    setReference(""); setNotes(""); setRequestId(newId());
    setErrorText(""); setReceipt(null);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!search.trim() || loading) return;
    setLoading(true); setErrorText(""); setResults([]);
    try {
      const {data, error} = await supabase.rpc("search_inbound_skus", {
        p_search: search.trim(), p_limit: 20,
      });
      if (error) throw error;
      setResults((data ?? []) as Sku[]);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Gagal mencari SKU.");
    } finally {setLoading(false);}
  }

  async function selectSku(id: string) {
    if (loading) return;
    setLoading(true); setErrorText(""); setReceipt(null);
    try {
      const {data: skuRows, error: skuError} = await supabase.rpc("get_inbound_variant", {p_variant_id: id});
      if (skuError) throw skuError;
      const item = (skuRows as Sku[] | null)?.[0];
      if (!item) throw Error("SKU tidak ditemukan.");

      const responses = await Promise.all(codes.map(qc =>
        supabase.rpc("get_inbound_destination_locations", {p_variant_id: id, p_area_code: qc})
      ));
      const nextRacks: Record<QcCode, Rack[]> = {NORMAL: [], DEFECT: [], REJECT: []};
      const nextIds: Record<QcCode, string> = {NORMAL: "", DEFECT: "", REJECT: ""};
      for (let i = 0; i < codes.length; i++) {
        if (responses[i].error) throw responses[i].error;
        const qc = codes[i];
        nextRacks[qc] = (responses[i].data ?? []) as Rack[];
        // HIPRIMA_INBOUND_RACK_RECOMMENDATION_V43K
        // Sarankan rak Normal yang sudah memiliki stok SKU terbanyak.
        // Jangan menebak jika stok kosong atau ada peringkat yang sama.
        const available = nextRacks[qc];
        if (qc === "NORMAL" && available.length > 1) {
          available.sort((a, b) =>
            Number(b.current_qty ?? 0) - Number(a.current_qty ?? 0)
          );
          const best = Number(available[0]?.current_qty ?? 0);
          const second = Number(available[1]?.current_qty ?? 0);
          if (best > 0 && best > second) {
            nextIds[qc] = available[0].location_id;
          }
        }
        if (available.length === 1) {
          nextIds[qc] = available[0].location_id;
        }
      }
      setChosen(item); setRacks(nextRacks); setRackIds(nextIds);
      setTotalText(""); setDefectText("0"); setRejectText("0");
      setRequestId(newId());
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Gagal membaca SKU/lokasi.");
    } finally {setLoading(false);}
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !chosen || !backendReady || !racksValid) return;
    const id = requestId || newId();
    if (!id) {setErrorText("Browser tidak dapat membuat identitas transaksi.");return;}
    setRequestId(id);
    const items = codes.filter(qc => qtyByQc[qc] > 0).map(qc => ({
      qc, qty: qtyByQc[qc], location_id: rackIds[qc],
    }));
    if (!window.confirm(`Konfirmasi inbound ${total} pcs untuk ${chosen.sku}?\nNormal ${normal}, Defect ${defect}, Reject ${reject}.\nStok LIVE akan bertambah setelah konfirmasi.`)) return;
    setBusy(true); setErrorText("");
    try {
      const {data, error} = await supabase.rpc("wms_receive_inbound_qc_batch", {
        p_request_id: id,
        p_variant_id: chosen.variant_id,
        p_expected_qty: total,
        p_items: items,
        p_reference_no: reference.trim() || null,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      const saved = data as Receipt | null;
      if (!saved?.receipt_no || saved.total_qty !== total) {
        throw Error("Hasil penerimaan belum dapat diverifikasi. Jangan membuat transaksi baru; hubungi Admin dengan ID: " + id);
      }
      setReceipt(saved);
    } catch (e) {
      setErrorText((e instanceof Error ? e.message : "Inbound gagal.") + " Jika koneksi terputus, ulangi dengan data sama agar tidak menggandakan stok.");
    } finally {setBusy(false);}
  }

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-8">
          <div className="mx-auto max-w-[1100px] space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">PT Prima Berkah Mulia</p>
                <h1 className="mt-1 text-3xl font-bold">Inbound Stock</h1>
                <p className="mt-2 text-sm text-slate-600">Terima satu SKU, pisahkan hasil QC dalam satu transaksi.</p>
              </div>
              <Link href="/stock-movement" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">Kembali ke Movement</Link>
            </header>

            {!backendReady && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Inbound Gabungan belum diaktifkan di database. Pencarian dan pratinjau tetap dapat digunakan; tombol konfirmasi terkunci sampai fungsi V4.3K disetujui dan dipasang.
            </div>}
            {errorText && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorText}</div>}

            {receipt ? <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <h2 className="text-xl font-bold text-emerald-900">Inbound berhasil dicatat</h2>
              <p className="mt-1 text-sm text-emerald-900">Nomor penerimaan: <b>{receipt.receipt_no}</b>  -  Total {number(receipt.total_qty)} pcs</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">{receipt.items.map(row =>
                <div key={row.qc} className="rounded-xl bg-white p-3 text-sm"><b>{labels[row.qc]}: {number(row.qty)} pcs</b><div className="text-xs text-slate-500">Movement #{row.movement_no}</div></div>
              )}</div>
              <button type="button" onClick={reset} className="mt-4 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Inbound Berikutnya</button>
            </section> : <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-bold">1. Cari SKU</h2>
                <form className="mt-3 flex flex-wrap gap-2" onSubmit={handleSearch}>
                  <input className={field + " flex-1"} value={search} placeholder="Cari SKU atau nama produk" onChange={e => setSearch(e.target.value)} />
                  <button className="shrink-0 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white" disabled={loading}>Cari</button>
                  <button type="button" onClick={reset} className="shrink-0 rounded-xl border px-4 py-3 text-sm">Reset</button>
                </form>
                {results.length > 0 && <div className="mt-3 divide-y rounded-xl border">{results.map(row =>
                  <div key={row.variant_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0"><b className="break-all">{row.sku}</b><p className="text-sm text-slate-600">{row.product_name}  |  {row.color || "-"}  |  {row.size || "-"}</p><p className="text-xs text-slate-500">Stok saat ini: {number(row.total_qty)}</p></div>
                    <button type="button" disabled={loading || chosen?.variant_id === row.variant_id} className="rounded-lg border px-4 py-2 text-sm disabled:bg-slate-100" onClick={() => void selectSku(row.variant_id)}>{chosen?.variant_id === row.variant_id ? "Dipilih" : "Pilih"}</button>
                  </div>
                )}</div>}
              </section>

              {chosen && <form onSubmit={submit} className="space-y-5">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="font-bold">2. Hasil QC  -  {chosen.sku}</h2>
                  <p className="mt-1 text-sm text-slate-500">Isi total, Defect, dan Reject. Jumlah Normal dihitung otomatis.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <label className="text-sm font-medium">Total Diterima<input type="number" min="1" step="1" required className={field + " mt-2"} value={totalText} onChange={e => {setTotalText(e.target.value);invalidateRequest();}} placeholder="Contoh 100" /></label>
                    <label className="text-sm font-medium">Defect<input type="number" min="0" step="1" required className={field + " mt-2"} value={defectText} onChange={e => {setDefectText(e.target.value);invalidateRequest();}} /></label>
                    <label className="text-sm font-medium">Reject<input type="number" min="0" step="1" required className={field + " mt-2"} value={rejectText} onChange={e => {setRejectText(e.target.value);invalidateRequest();}} /></label>
                  </div>
                  <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
                    <b>Normal otomatis: {splitValid ? number(normal) : " - "} pcs</b>
                    <p className={splitValid ? "mt-1 text-slate-600" : "mt-1 text-red-700"}>{splitValid ? `Normal ${normal} + Defect ${defect} + Reject ${reject} = Total ${total} pcs` : "Jumlah Defect + Reject tidak boleh melebihi total, dan semua angka harus bilangan bulat."}</p>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="font-bold">3. Lokasi barang</h2>
                  <p className="mt-1 text-sm text-slate-500">Rak dipilih otomatis jika hanya tersedia satu lokasi aktif dalam setiap area QC.</p>
                  <div className="mt-4 grid gap-3">
                    {codes.map(qc => <div key={qc} className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[130px_100px_minmax(0,1fr)] sm:items-center">
                      <div><b className="text-sm">{labels[qc]}</b><p className="text-xs text-slate-500">{hints[qc]}</p></div>
                      <span className="text-sm font-semibold">{splitValid ? number(qtyByQc[qc]) : " - "} pcs</span>
                      {qtyByQc[qc] > 0 && splitValid ?
                        <select className={field} value={rackIds[qc]} required onChange={e => {setRackIds(prev => ({...prev, [qc]: e.target.value}));invalidateRequest();}}>
                          <option value="">Pilih rak {labels[qc]}</option>
                          {racks[qc].map(r => <option key={r.location_id} value={r.location_id}>{r.location_code}  -  {r.location_name} (stok {number(r.current_qty)})</option>)}
                        </select> : <span className="text-xs text-slate-400">Tidak ada barang kategori ini</span>}
                      {qc === "NORMAL" && recommendedNormal && splitValid && qtyByQc.NORMAL > 0 && (
                        <p className="text-xs text-emerald-800 sm:col-span-3">
                          Rekomendasi: rak {recommendedNormal.location_code}
                          {" "} (stok SKU {number(recommendedNormal.current_qty)} pcs).
                          Pastikan lokasi fisik dan kapasitas rak sesuai.
                          Pilihan dapat diganti.
                        </p>
                      )}
                      {splitValid && qtyByQc[qc] > 0 && racks[qc].length === 0 && <p className="text-sm text-red-700 sm:col-span-3">Belum ada rak aktif untuk {labels[qc]}. Hubungi Admin.</p>}
                    </div>)}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="font-bold">4. Konfirmasi penerimaan</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium">Referensi PO / Surat Jalan (opsional)<input className={field + " mt-2"} value={reference} onChange={e => {setReference(e.target.value);invalidateRequest();}} placeholder="Nomor PO / SJ" /></label>
                    <label className="text-sm font-medium">Catatan (opsional)<input className={field + " mt-2"} value={notes} onChange={e => {setNotes(e.target.value);invalidateRequest();}} placeholder="Catatan QC" /></label>
                  </div>
                  <p className="mt-3 text-xs text-slate-600">Satu konfirmasi akan mencatat seluruh kategori QC dalam satu transaksi. Jika satu kategori gagal, semuanya dibatalkan.</p>
                  <button type="submit" disabled={busy || loading || !backendReady || !racksValid} className="mt-4 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400">{busy ? "Memproses..." : `Konfirmasi Inbound ${splitValid ? number(total) : ""} pcs`}</button>
                </section>
              </form>}
            </>}
          </div>
        </main>
      </div>
    </div>
  );
}