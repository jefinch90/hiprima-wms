"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

// Hi.PRIMA V4.3M — satu vendor + Surat Jalan, banyak SKU, satu transaksi atomik.
// Backend wajib tersedia sebelum tombol POSTED dapat digunakan.
type Qc = "NORMAL" | "DEFECT" | "REJECT";
type Vendor = { id: string; name: string };
type Sku = {
  variant_id: string;
  sku: string;
  product_name: string;
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
type Line = {
  sku: Sku;
  total: string;
  defect: string;
  reject: string;
  racks: Record<Qc, Rack[]>;
  destinations: Record<Qc, string>;
};
type PostedLine = {
  sku: string;
  variant_id: string;
  total_qty: number;
  items: Array<{qc: Qc; qty: number; movement_no: number}>;
};
type Posted = {
  receipt_no: string;
  request_id: string;
  total_qty: number;
  line_count: number;
  lines: PostedLine[];
};

const qcs: Qc[] = ["NORMAL", "DEFECT", "REJECT"];
const formatQty = (n: number) => n.toLocaleString("id-ID");
const field = "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-600";
const secondary = "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm hover:bg-slate-50 disabled:opacity-50";
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? "";
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parsed(line: Line) {
  const texts = [line.total, line.defect, line.reject];
  if (texts.some(t => !/^\d+$/.test(t.trim()))) return null;
  const [total, defect, reject] = texts.map(Number);
  if (![total, defect, reject].every(Number.isSafeInteger) || total <= 0 || total > 999999999 || defect + reject > total) return null;
  const quantities: Record<Qc, number> = { NORMAL: total - defect - reject, DEFECT: defect, REJECT: reject };
  const racksValid = qcs.every(qc => quantities[qc] === 0 || line.racks[qc].some(r => r.location_id === line.destinations[qc]));
  return { total, quantities, racksValid };
}
function suggestRacks(options: Record<Qc, Rack[]>) {
  const chosen: Record<Qc, string> = { NORMAL: "", DEFECT: "", REJECT: "" };
  for (const qc of qcs) {
    if (qc === "NORMAL") {
      options[qc] = [...options[qc]].sort((a,b) => Number(b.current_qty ?? 0) - Number(a.current_qty ?? 0));
    }
    const list = options[qc];
    if (list.length === 1) chosen[qc] = list[0].location_id;
    if (qc === "NORMAL" && list.length > 1 && Number(list[0].current_qty) > 0 && Number(list[0].current_qty) > Number(list[1].current_qty)) {
      chosen[qc] = list[0].location_id;
    }
  }
  return chosen;
}

export default function InboundMultiSkuPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [backendReady, setBackendReady] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [sj, setSj] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayLocal);
  const [poReference, setPoReference] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Sku[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [requestId, setRequestId] = useState(newRequestId);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [posted, setPosted] = useState<Posted | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const {data: {user}} = await supabase.auth.getUser();
      if (!active) return;
      if (!user) { router.replace("/login"); return; }
      const [version, vendorResult] = await Promise.all([
        supabase.rpc("wms_inbound_multi_version"),
        supabase.rpc("wms_inbound_multi_vendors")
      ]);
      if (!active) return;
      setBackendReady(!version.error && version.data === "V4.3M" && !vendorResult.error);
      if (!vendorResult.error) setVendors((vendorResult.data ?? []) as Vendor[]);
    })();
    return () => { active = false; };
  }, [router, supabase]);

  function invalidate() { setRequestId(newRequestId()); setErrorText(""); }
  function reset() {
    setVendorId(""); setSj(""); setReceivedDate(todayLocal()); setPoReference(""); setNotes("");
    setSearch(""); setSearchResults([]); setLines([]); setPosted(null); setErrorText(""); setRequestId(newRequestId());
  }

  async function searchSku() {
    if (!search.trim() || loading || busy) return;
    setLoading(true); setErrorText(""); setSearchResults([]);
    try {
      const {data, error} = await supabase.rpc("search_inbound_skus", {p_search: search.trim(), p_limit: 30});
      if (error) throw error;
      setSearchResults((data ?? []) as Sku[]);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Gagal mencari SKU.");
    } finally { setLoading(false); }
  }

  async function addSku(variantId: string) {
    if (loading || busy || lines.some(l => l.sku.variant_id === variantId)) return;
    setLoading(true); setErrorText("");
    try {
      const [product, ...rackResponses] = await Promise.all([
        supabase.rpc("get_inbound_variant", {p_variant_id: variantId}),
        ...qcs.map(qc => supabase.rpc("get_inbound_destination_locations", {p_variant_id: variantId, p_area_code: qc}))
      ]);
      if (product.error) throw product.error;
      const sku = ((product.data ?? []) as Sku[])[0];
      if (!sku) throw Error("SKU tidak ditemukan.");
      const options: Record<Qc, Rack[]> = {NORMAL: [], DEFECT: [], REJECT: []};
      for (let i = 0; i < qcs.length; i++) {
        if (rackResponses[i].error) throw rackResponses[i].error;
        options[qcs[i]] = (rackResponses[i].data ?? []) as Rack[];
      }
      const destinations = suggestRacks(options);
      setLines(prev => prev.some(l => l.sku.variant_id === variantId) ? prev : [
        ...prev, {sku, total: "", defect: "0", reject: "0", racks: options, destinations}
      ]);
      invalidate();
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Gagal menambahkan SKU atau lokasi.");
    } finally { setLoading(false); }
  }

  function editQuantity(variantId: string, key: "total" | "defect" | "reject", value: string) {
    setLines(prev => prev.map(l => l.sku.variant_id === variantId ? {...l, [key]: value} : l));
    invalidate();
  }
  function editRack(variantId: string, qc: Qc, locationId: string) {
    setLines(prev => prev.map(l => l.sku.variant_id === variantId ? {
      ...l, destinations: {...l.destinations, [qc]: locationId}
    } : l));
    invalidate();
  }
  function deleteSku(variantId: string) {
    setLines(prev => prev.filter(l => l.sku.variant_id !== variantId));
    invalidate();
  }

  const validLines = lines.length > 0 && lines.every(l => {const r = parsed(l); return !!r && r.racksValid;});
  const totalPcs = lines.reduce((sum, line) => sum + (parsed(line)?.total ?? 0), 0);
  const vendorName = vendors.find(v => v.id === vendorId)?.name ?? "";
  const canPost = backendReady && !busy && !loading && !!vendorId && !!sj.trim() && sj.trim().length <= 120 &&
    !!receivedDate && validLines && !!requestId && !posted;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPost) { setErrorText("Lengkapi vendor, Surat Jalan, seluruh SKU, hasil QC dan lokasi rak."); return; }
    const docLines = lines.map(l => {
      const values = parsed(l)!;
      return {
        variant_id: l.sku.variant_id,
        total_qty: values.total,
        items: qcs.filter(qc => values.quantities[qc] > 0).map(qc => ({
          qc, qty: values.quantities[qc], location_id: l.destinations[qc]
        }))
      };
    });
    const summary = lines.map(l => `${l.sku.sku}: ${parsed(l)!.total} pcs`).join("\n");
    if (!window.confirm(`KONFIRMASI PENERIMAAN LIVE\nVendor: ${vendorName}\nSurat Jalan: ${sj.trim()}\n${lines.length} SKU / ${totalPcs} pcs\n\n${summary}\n\nStok LIVE bertambah jika seluruh baris berhasil. Lanjutkan?`)) return;
    setBusy(true); setErrorText("");
    try {
      const {data, error} = await supabase.rpc("wms_receive_inbound_document", {
        p_request_id: requestId,
        p_vendor_id: vendorId,
        p_delivery_note: sj.trim(),
        p_received_date: receivedDate,
        p_po_reference: poReference.trim() || null,
        p_notes: notes.trim() || null,
        p_lines: docLines
      });
      if (error) throw error;
      const saved = data as Posted | null;
      if (!saved?.receipt_no || saved.total_qty !== totalPcs || saved.line_count !== lines.length) {
        throw Error("Balasan transaksi belum dapat diverifikasi. JANGAN input ulang; hubungi Admin dengan Request ID: " + requestId);
      }
      setPosted(saved);
    } catch (e) {
      const detail = e && typeof e === "object" && "message" in e ? String(e.message) : "Inbound gagal.";
      const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
      setErrorText(code === "23505" || detail.includes("sudah tercatat") || detail.includes("sudah digunakan")
        ? `DITOLAK: Dokumen Surat Jalan ${sj.trim()} sudah tercatat atau pernah digunakan. Periksa riwayat; jangan buat ulang.`
        : detail + " Jika koneksi putus, ulangi dengan data dan Request ID yang sama; jangan membuat dokumen baru.");
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-8">
          <div className="mx-auto max-w-[1200px] space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div><p className="text-sm text-slate-500">PT Prima Berkah Mulia</p>
                <h1 className="mt-1 text-3xl font-bold">Inbound Multi-SKU</h1>
                <p className="mt-2 text-sm text-slate-600">Satu vendor + Surat Jalan, banyak SKU, satu konfirmasi.</p>
              </div>
              <Link href="/stock-movement" className={secondary}>Kembali ke Movement</Link>
            </header>
            {!backendReady && <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              Backend V4.3M belum terpasang atau tidak dapat diakses. Tombol konfirmasi terkunci. Jangan memasukkan stok lewat jalur lain.
            </div>}
            {errorText && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{errorText}</div>}

            {posted ? <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
              <h2 className="text-xl font-bold text-emerald-900">Dokumen Inbound berhasil dicatat</h2>
              <p className="mt-2 text-sm">Penerimaan <b>{posted.receipt_no}</b> · {formatQty(posted.line_count)} SKU · {formatQty(posted.total_qty)} pcs</p>
              <div className="mt-3 space-y-2">{posted.lines.map(l =>
                <div className="rounded-xl bg-white p-3 text-sm" key={l.variant_id}><b>{l.sku}</b> — {formatQty(l.total_qty)} pcs
                  <p className="mt-1 text-xs text-slate-600">{l.items.map(i => `${i.qc} ${i.qty} (Movement #${i.movement_no})`).join(" | ")}</p>
                </div>
              )}</div>
              <button type="button" onClick={reset} className="mt-4 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Dokumen Berikutnya</button>
            </section> : <form onSubmit={submit} className="space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-bold">1. Dokumen penerimaan</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-sm font-medium">Vendor (wajib)
                    <select className={field + " mt-2"} value={vendorId} required onChange={e => {setVendorId(e.target.value);invalidate();}}>
                      <option value="">Pilih vendor aktif</option>
                      {vendors.map(v => <option value={v.id} key={v.id}>{v.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium">Nomor Surat Jalan (wajib)
                    <input className={field + " mt-2"} value={sj} required maxLength={120} placeholder="Contoh: SJ-20261122-001" onChange={e => {setSj(e.target.value);invalidate();}} />
                  </label>
                  <label className="text-sm font-medium">Tanggal penerimaan
                    <input className={field + " mt-2"} type="date" required value={receivedDate} onChange={e => {setReceivedDate(e.target.value);invalidate();}} />
                  </label>
                  <label className="text-sm font-medium">Referensi PO (opsional)
                    <input className={field + " mt-2"} maxLength={120} value={poReference} onChange={e => {setPoReference(e.target.value);invalidate();}} placeholder="Nomor PO" />
                  </label>
                  <label className="text-sm font-medium sm:col-span-2">Catatan (opsional)
                    <input className={field + " mt-2"} maxLength={500} value={notes} onChange={e => {setNotes(e.target.value);invalidate();}} placeholder="Catatan penerimaan / QC" />
                  </label>
                </div>
                <p className="mt-3 text-xs text-slate-500">Satu vendor dan satu nomor Surat Jalan hanya bisa POSTED sekali. Pastikan seluruh SKU sudah dimasukkan sebelum konfirmasi.</p>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-bold">2. Tambahkan SKU / varian</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input className={field + " flex-1"} value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari SKU atau nama produk" />
                  <button type="button" className="shrink-0 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void searchSku()} disabled={loading || busy}>Cari</button>
                </div>
                {searchResults.length > 0 && <div className="mt-3 max-h-72 divide-y overflow-y-auto rounded-xl border border-slate-200">
                  {searchResults.map(r => <div className="flex flex-wrap items-center justify-between gap-2 p-3" key={r.variant_id}>
                    <div className="min-w-0"><b className="break-all text-sm">{r.sku}</b><p className="text-xs text-slate-600">{r.product_name} | {r.color ?? "-"} | {r.size ?? "-"} | Stok {formatQty(r.total_qty)}</p></div>
                    <button type="button" className={secondary} disabled={loading || busy || lines.some(l => l.sku.variant_id === r.variant_id)} onClick={() => void addSku(r.variant_id)}>
                      {lines.some(l => l.sku.variant_id === r.variant_id) ? "Sudah ditambah" : "Tambah"}
                    </button>
                  </div>)}
                </div>}
              </section>

              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">3. QC dan rak per SKU</h2><span className="text-sm text-slate-600">{lines.length} SKU</span></div>
                {lines.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">Belum ada SKU. Cari dan tambahkan varian sesuai Surat Jalan.</p>}
                {lines.map((line, idx) => {
                  const values = parsed(line);
                  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5" key={line.sku.variant_id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0"><p className="text-xs font-semibold text-slate-500">SKU #{idx + 1}</p><h3 className="break-all font-bold">{line.sku.sku}</h3><p className="text-sm text-slate-600">{line.sku.product_name} | {line.sku.color ?? "-"} | {line.sku.size ?? "-"}</p></div>
                      <button type="button" onClick={() => deleteSku(line.sku.variant_id)} disabled={busy || loading} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">Hapus</button>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      {(["total", "defect", "reject"] as const).map(key => <label key={key} className="text-sm font-medium">{key === "total" ? "Total diterima" : key === "defect" ? "Defect" : "Reject"}
                        <input type="number" min={key === "total" ? 1 : 0} step="1" required className={field + " mt-2"} value={line[key]} onChange={e => editQuantity(line.sku.variant_id, key, e.target.value)} />
                      </label>)}
                    </div>
                    <p className={"mt-3 rounded-lg p-3 text-sm " + (values ? "bg-slate-50 text-slate-700" : "bg-amber-50 text-amber-900")}>
                      {values ? `Normal ${values.quantities.NORMAL} + Defect ${values.quantities.DEFECT} + Reject ${values.quantities.REJECT} = ${values.total} pcs` : "Isi jumlah dengan bilangan bulat. Defect + Reject tidak boleh melebihi total."}
                    </p>
                    <div className="mt-3 grid gap-3">
                      {qcs.map(qc => {
                        const qty = values?.quantities[qc] ?? 0;
                        const options = line.racks[qc];
                        const candidate = qc === "NORMAL" && options.length > 1 && Number(options[0].current_qty) > Number(options[1].current_qty) && Number(options[0].current_qty) > 0 ? options[0] : null;
                        return <div className="grid min-w-0 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[100px_90px_minmax(0,1fr)] sm:items-center" key={qc}>
                          <b className="text-sm">{qc}</b><span className="text-sm">{qty} pcs</span>
                          {qty > 0 ? <select required className={field} value={line.destinations[qc]} onChange={e => editRack(line.sku.variant_id, qc, e.target.value)}>
                            <option value="">Pilih rak {qc}</option>
                            {options.map(r => <option key={r.location_id} value={r.location_id}>{r.location_code} - {r.location_name} (stok {formatQty(r.current_qty)})</option>)}
                          </select> : <span className="text-xs text-slate-400">Tidak ada barang kategori ini</span>}
                          {qc === "NORMAL" && qty > 0 && candidate && <p className="text-xs text-emerald-800 sm:col-span-3">Rekomendasi rak {candidate.location_code} (stok SKU {formatQty(candidate.current_qty)}). Pastikan kapasitas dan posisi fisik sesuai; pilihan dapat diganti.</p>}
                          {qty > 0 && options.length === 0 && <p className="text-xs text-red-700 sm:col-span-3">Tidak ada rak aktif untuk {qc}; hubungi Admin.</p>}
                        </div>;
                      })}
                    </div>
                  </article>;
                })}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-bold">4. Review dan konfirmasi dokumen</h2>
                <p className="mt-2 text-sm text-slate-700"><b>{lines.length} SKU</b> · <b>{formatQty(totalPcs)} pcs</b> · {vendorName || "Vendor belum dipilih"} · {sj.trim() || "Surat Jalan belum diisi"}</p>
                <p className="mt-2 text-xs text-slate-500">Seluruh SKU diproses atomik. Jika satu baris gagal, semua stok dan movement dibatalkan. Setelah POSTED, dokumen tidak dapat ditambah diam-diam.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="submit" disabled={!canPost} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400">
                    {busy ? "Memproses..." : `Konfirmasi Inbound ${formatQty(totalPcs)} pcs`}
                  </button>
                  <button type="button" disabled={busy} onClick={reset} className={secondary}>Reset formulir</button>
                </div>
              </section>
            </form>}
          </div>
        </main>
      </div>
    </div>
  );
}
