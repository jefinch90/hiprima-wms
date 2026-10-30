"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { lifecycleLabel } from "@/utils/productionLifecycleLabels";
import { createClient } from "@/utils/supabase/client";
import { wmsToast, wmsConfirm } from "@/utils/wmsNotifications";

type Role = "owner" | "admin" | "warehouse_manager";
type Lifecycle = "On Produksi" | "Hold" | "Seasonal" | "Discontinue";
type MoqType = "PER_PRODUCT" | "PER_COLOR" | "BY_REQUEST" | "UNSPECIFIED";
type Review = "DRAFT" | "VERIFIED" | "REJECTED";
type Mapping = "CANDIDATE_ONLY" | "NO_MODEL_CODE" | "NOT_IN_MASTER" | "AMBIGUOUS_CODE";

type Vendor = { id: string; vendor_name: string; is_active: boolean };
type Candidate = {
  parameter_id: string;
  source_row: number;
  source_product_name: string;
  product_code: string | null;
  vendor_name: string;
  lead_time_days: number;
  lifecycle_status: Lifecycle;
  moq_raw: string | null;
  moq_quantity: number | null;
  moq_type: MoqType;
  review_status: Review;
  master_match_count: number;
  master_mapping_status: Mapping;
  candidate_master_id: string | null;
};
type Master = { id: string; product_code: string | null; name: string | null };
type EditState = {
  vendor_id: string;
  product_code: string;
  lead_time_days: string;
  lifecycle_status: Lifecycle;
  moq_type: MoqType;
  moq_quantity: string;
  reviewer_notes: string;
};

const lifecycleValues: Lifecycle[] = ["On Produksi", "Hold", "Seasonal", "Discontinue"];
const moqLabels: Record<MoqType, string> = {
  PER_PRODUCT: "Per Produk", PER_COLOR: "Per Warna",
  BY_REQUEST: "By Request", UNSPECIFIED: "Belum ditentukan"
};
const matchLabels: Record<Mapping, string> = {
  CANDIDATE_ONLY: "Kandidat Master unik",
  NO_MODEL_CODE: "Kode belum ada",
  NOT_IN_MASTER: "Tidak ditemukan",
  AMBIGUOUS_CODE: "Kode ambigu"
};
const nf = (v: number) => new Intl.NumberFormat("id-ID").format(v);
const inputStyle = "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-800 focus:outline-none";

export default function VendorManagementPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [role, setRole] = useState<Role | null>(null);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [master, setMaster] = useState<Record<string, Master>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState("ALL");
  const [lifeFilter, setLifeFilter] = useState("ALL");
  const [reviewFilter, setReviewFilter] = useState("ALL");
  const [mappingFilter, setMappingFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [newVendor, setNewVendor] = useState("");
  const [showAddVendor, setShowAddVendor] = useState(false);
  const canEdit = role === "owner" || role === "admin";
  // Global notifications for meaningful actions (not search/filter/navigation).
  useEffect(() => {
    if (notice) wmsToast.success("Berhasil", notice);
  }, [notice]);
  useEffect(() => {
    if (error) wmsToast.error("Perlu perhatian", error);
  }, [error]);

  const refresh = useCallback(async () => {
    const [records, directory] = await Promise.all([
      supabase.from("wms_vendor_product_candidates").select("*").order("source_row", { ascending: true }),
      supabase.from("wms_vendor_master").select("id,vendor_name,is_active").order("vendor_name")
    ]);
    if (records.error) throw records.error;
    if (directory.error) throw directory.error;
    const next = (records.data ?? []) as Candidate[];
    if (!next.length) throw new Error("Data vendor tidak ditemukan. Periksa akses dan batch import.");
    const nextVendors = (directory.data ?? []) as Vendor[];
    // Product names are an optional aid. An inaccessible product does NOT count as verified.
    const ids = Array.from(new Set(next.map(x => x.candidate_master_id).filter((x): x is string => !!x)));
    const names: Record<string, Master> = {};
    if (ids.length) {
      const result = await supabase.from("products").select("id,product_code,name").in("id", ids);
      if (!result.error) for (const item of (result.data ?? []) as Master[]) names[item.id] = item;
    }
    setRows(next);
    setVendors(nextVendors);
    setMaster(names);
  }, [supabase]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) { router.replace("/login"); return; }
        const { data: profile, error: pError } = await supabase
          .from("profiles").select("role,is_active").eq("id", user.id).single();
        if (pError) throw pError;
        if (!profile?.is_active || !["owner", "admin", "warehouse_manager"].includes(profile.role)) {
          throw new Error("Anda tidak memiliki akses Vendor Management.");
        }
        if (live) setRole(profile.role as Role);
        await refresh();
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Gagal memuat data vendor.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [supabase, router, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(x => (
      (!q || [x.source_product_name, x.product_code ?? "", x.vendor_name].join(" ").toLowerCase().includes(q)) &&
      (vendorFilter === "ALL" || x.vendor_name === vendorFilter) &&
      (lifeFilter === "ALL" || x.lifecycle_status === lifeFilter) &&
      (reviewFilter === "ALL" || x.review_status === reviewFilter) &&
      (mappingFilter === "ALL" || x.master_mapping_status === mappingFilter)
    ));
  }, [rows, query, vendorFilter, lifeFilter, reviewFilter, mappingFilter]);
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);
  const active = rows.filter(x => x.lifecycle_status === "On Produksi");
  const avg = active.length ? active.reduce((a,x) => a + x.lead_time_days, 0) / active.length : 0;
  const missing = rows.filter(x => x.master_mapping_status !== "CANDIDATE_ONLY").length;
  const draft = rows.filter(x => x.review_status !== "VERIFIED").length;

  const openEditor = (x: Candidate) => {
    const vendor = vendors.find(v => v.vendor_name === x.vendor_name);
    setSelected(x);
    setEdit({
      vendor_id: vendor?.id ?? "", product_code: x.product_code ?? "",
      lead_time_days: String(x.lead_time_days), lifecycle_status: x.lifecycle_status,
      moq_type: x.moq_type, moq_quantity: x.moq_quantity == null ? "" : String(x.moq_quantity),
      reviewer_notes: ""
    });
    setConfirmed(false); setError(""); setNotice("");
  };

  const save = async (verify: boolean) => {
    if (!selected || !edit || !canEdit || saving) return;
    const lead = Number(edit.lead_time_days);
    const code = edit.product_code.trim().toUpperCase();
    const qty = Number(edit.moq_quantity);
    const needsQuantity = edit.moq_type === "PER_PRODUCT" || edit.moq_type === "PER_COLOR";
    if (!edit.vendor_id || !Number.isInteger(lead) || lead < 1 || lead > 365) {
      setError("Pilih vendor dan isi lead time 1–365 hari."); return;
    }
    if (code && !/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(code)) {
      setError("Kode produk hanya boleh huruf, angka, - dan _."); return;
    }
    if (needsQuantity && (!Number.isInteger(qty) || qty < 1)) {
      setError("MOQ Per Produk/Per Warna wajib berupa angka lebih dari nol."); return;
    }
    const candidateUnchanged = code === (selected.product_code ?? "").trim().toUpperCase();
    if (verify && (!confirmed || !candidateUnchanged || !code ||
      !selected.candidate_master_id || !master[selected.candidate_master_id] ||
      selected.master_mapping_status !== "CANDIDATE_ONLY" ||
      selected.master_match_count !== 1 || !selected.candidate_master_id)) {
      setError("Verifikasi hanya boleh dilakukan untuk kandidat Master unik yang sudah dicek, tanpa mengubah kode produk."); return;
    }
    if (verify) {
      const accepted = await wmsConfirm({
        title: "Verifikasi parameter vendor?",
        message: `Anda akan memverifikasi parameter ${selected.source_product_name}. Pastikan kode Master, vendor, lead time, MOQ, dan status produksi sudah diperiksa.`,
        confirmLabel: "Ya, Verifikasi",
        cancelLabel: "Periksa Lagi"
      });
      if (!accepted) return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = {
        vendor_id: edit.vendor_id,
        product_code: code || null,
        lead_time_days: lead,
        lifecycle_status: edit.lifecycle_status,
        moq_type: edit.moq_type,
        moq_quantity: needsQuantity ? qty : null,
        moq_scope_raw: edit.moq_type === "PER_PRODUCT" ? "Per Produk" :
          edit.moq_type === "PER_COLOR" ? "Per Warna" : null,
        moq_raw: needsQuantity ? String(qty) : edit.moq_type === "BY_REQUEST" ? "By Request" : null,
        review_status: (verify ? "VERIFIED" : "DRAFT") as Review,
        reviewed_at: verify ? new Date().toISOString() : null,
        reviewer_notes: edit.reviewer_notes.trim() || (verify ? "Diverifikasi manual pada Vendor Management" : null)
      };
      const { data, error: updateError } = await supabase.from("wms_vendor_product_parameters")
        .update(payload).eq("id", selected.parameter_id).select("id").single();
      if (updateError) throw updateError;
      if (!data) throw new Error("Perubahan tidak tersimpan. Periksa hak akses.");
      await refresh();
      setSelected(null); setEdit(null); setConfirmed(false);
      setNotice(verify ? "Parameter berhasil diverifikasi secara manual." : "Perubahan disimpan sebagai Draft.");
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan parameter."); }
    finally { setSaving(false); }
  };

  const addVendor = async () => {
    if (!canEdit || saving) return;
    const value = newVendor.trim();
    if (value.length < 2 || value.length > 120) { setError("Nama vendor harus 2–120 karakter."); return; }
    setSaving(true); setError("");
    try {
      const { error: insertError } = await supabase.from("wms_vendor_master").insert({ vendor_name: value });
      if (insertError) throw insertError;
      await refresh(); setShowAddVendor(false); setNewVendor("");
      setNotice("Vendor baru berhasil ditambahkan.");
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menambah vendor."); }
    finally { setSaving(false); }
  };

  const resetPage = () => setPage(1);
  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-8">
          <div className="mx-auto w-full min-w-0 max-w-[1500px] space-y-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Hi.PRIMA WMS / Production Planning</p>
                <h1 className="mt-2 text-2xl font-bold md:text-3xl">Vendor Management</h1>
                <p className="mt-2 text-sm text-slate-500">Lead time, MOQ, lifecycle produk, dan verifikasi kandidat Master.</p>
              </div>
              <Link href="/production-planning" className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Kembali ke Planning</Link>
            </header>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <strong>Vendor Parameter — Draft.</strong> Data ini belum digunakan untuk menghasilkan PO atau mengubah target stok Production Planning. Kandidat Master unik belum otomatis berarti Verified.
            </div>

            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
            {loading ? <div className="rounded-xl bg-white p-8 text-sm">Memuat data Vendor Management...</div> : <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                {[
                  ["Vendor", nf(vendors.length)], ["Total Produk", nf(rows.length)],
                  ["Aktif (Regular)", nf(active.length)], ["Perlu Review", nf(draft)],
                  ["Lead Time Aktif", avg.toLocaleString("id-ID", {maximumFractionDigits:1}) + " hari"]
                ].map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-xl font-bold md:text-2xl">{value}</div>
                  </div>)}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <strong>{missing} produk</strong> belum memiliki kandidat Master unik. Baris tersebut dapat diedit, tetapi tidak dapat diverifikasi sampai kodenya cocok dengan tepat satu Master.
              </div>
              <section className="rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                  <div><h2 className="font-semibold">Parameter Produk Vendor</h2><p className="mt-1 text-xs text-slate-500">{nf(filtered.length)} dari {nf(rows.length)} produk</p></div>
                  {canEdit && <button onClick={() => {setShowAddVendor(true); setError("");}} className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">+ Tambah Vendor</button>}
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
                  <input className={inputStyle} placeholder="Cari produk, kode, vendor..." value={query} onChange={e => {setQuery(e.target.value); resetPage();}} />
                  <select className={inputStyle} value={vendorFilter} onChange={e => {setVendorFilter(e.target.value); resetPage();}}>
                    <option value="ALL">Semua Vendor</option>
                    {vendors.map(v => <option key={v.id} value={v.vendor_name}>{v.vendor_name}</option>)}
                  </select>
                  <select className={inputStyle} value={lifeFilter} onChange={e => {setLifeFilter(e.target.value); resetPage();}}>
                    <option value="ALL">Semua Status Produk</option>
                    {lifecycleValues.map(s => <option key={s} value={s}>{lifecycleLabel(s)}</option>)}
                  </select>
                  <select className={inputStyle} value={mappingFilter} onChange={e => {setMappingFilter(e.target.value); resetPage();}}>
                    <option value="ALL">Semua Mapping</option>
                    {Object.entries(matchLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  <select className={inputStyle} value={reviewFilter} onChange={e => {setReviewFilter(e.target.value); resetPage();}}>
                    <option value="ALL">Semua Review</option>
                    <option value="DRAFT">Draft</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option>
                  </select>
                </div>
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="min-w-[1170px] w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600"><tr>
                      {["Kode / Produk", "Vendor", "Lead Time", "MOQ", "Lifecycle", "Master WMS", "Review", "Aksi"].map(h => <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {visible.map(x => <tr key={x.parameter_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3"><div className="font-bold text-slate-800">{x.product_code || "Belum ada kode"}</div><div className="mt-1 max-w-[300px] text-slate-500">{x.source_product_name}</div></td>
                        <td className="px-4 py-3">{x.vendor_name}</td>
                        <td className="px-4 py-3 tabular-nums">{x.lead_time_days} hari</td>
                        <td className="px-4 py-3">{x.moq_quantity ? `${nf(x.moq_quantity)} pcs · ` : ""}{moqLabels[x.moq_type]}</td>
                        <td className="px-4 py-3"><span className={`rounded-lg px-2 py-1 ${x.lifecycle_status === "On Produksi" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>{lifecycleLabel(x.lifecycle_status)}</span></td>
                        <td className="px-4 py-3"><div>{matchLabels[x.master_mapping_status]}</div>{x.candidate_master_id && master[x.candidate_master_id] && <div className="mt-1 max-w-[190px] text-slate-500">{master[x.candidate_master_id].product_code} · {master[x.candidate_master_id].name}</div>}</td>
                        <td className="px-4 py-3"><span className="font-semibold">{x.review_status}</span></td>
                        <td className="px-4 py-3">{canEdit ? <button className="rounded-lg border border-slate-300 px-3 py-2 font-semibold hover:bg-slate-100" onClick={() => openEditor(x)}>Edit / Review</button> : <span className="text-slate-400">Read only</span>}</td>
                      </tr>)}
                    </tbody>
                  </table>
                  {filtered.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Tidak ada produk sesuai filter.</p>}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4">
                  <p className="text-xs text-slate-500">Halaman {current} / {pages} · {nf(filtered.length)} produk</p>
                  <div className="flex gap-2">
                    <button disabled={current <= 1} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40" onClick={() => setPage(Math.max(1,current-1))}>Sebelumnya</button>
                    <button disabled={current >= pages} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40" onClick={() => setPage(Math.min(pages,current+1))}>Berikutnya</button>
                  </div>
                </div>
              </section>
            </>}
            {showAddVendor && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/45 p-4"><section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
              <h3 className="font-semibold">Tambah Vendor</h3>{error && <p className="mt-2 text-sm text-rose-700">{error}</p>}<div className="mt-3 flex flex-wrap gap-2">
                <input className={inputStyle + " sm:max-w-sm"} placeholder="Nama vendor baru" value={newVendor} onChange={e => setNewVendor(e.target.value)} />
                <button disabled={saving} onClick={() => void addVendor()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Simpan Vendor</button>
                <button onClick={() => setShowAddVendor(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Batal</button>
              </div>
            </section></div>}
            {selected && edit && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 sm:p-6"><section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-300 bg-white p-5 shadow-xl">
              <div className="flex flex-wrap items-start justify-between gap-3"><div>
                <h2 className="text-lg font-bold">Edit / Review Parameter</h2><p className="mt-1 text-sm text-slate-500">{selected.source_product_name}</p>
              </div><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => {setSelected(null);setEdit(null);setError("");}}>Tutup</button></div>
              {error && <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-1 text-xs font-medium">Vendor
                  <select value={edit.vendor_id} onChange={e => setEdit({...edit, vendor_id:e.target.value})} className={inputStyle}>
                    <option value="">Pilih Vendor</option>{vendors.filter(v => v.is_active || v.id === edit.vendor_id).map(v => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium">Kode Produk
                  <input className={inputStyle} value={edit.product_code} onChange={e => setEdit({...edit,product_code:e.target.value})} placeholder="Contoh: BZ40" />
                </label>
                <label className="space-y-1 text-xs font-medium">Lead Time (hari)
                  <input type="number" min={1} max={365} className={inputStyle} value={edit.lead_time_days} onChange={e => setEdit({...edit,lead_time_days:e.target.value})} />
                </label>
                <label className="space-y-1 text-xs font-medium">Lifecycle
                  <select className={inputStyle} value={edit.lifecycle_status} onChange={e => setEdit({...edit,lifecycle_status:e.target.value as Lifecycle})}>
                    {lifecycleValues.map(v => <option key={v} value={v}>{lifecycleLabel(v)}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium">Tipe MOQ
                  <select className={inputStyle} value={edit.moq_type} onChange={e => setEdit({...edit,moq_type:e.target.value as MoqType})}>
                    {Object.entries(moqLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
                {(edit.moq_type === "PER_PRODUCT" || edit.moq_type === "PER_COLOR") && <label className="space-y-1 text-xs font-medium">MOQ (pcs)
                  <input type="number" min={1} className={inputStyle} value={edit.moq_quantity} onChange={e => setEdit({...edit,moq_quantity:e.target.value})} />
                </label>}
              </div>
              <label className="mt-4 block space-y-1 text-xs font-medium">Catatan Review
                <textarea rows={2} className={inputStyle} value={edit.reviewer_notes} onChange={e => setEdit({...edit,reviewer_notes:e.target.value})} placeholder="Alasan perubahan / hasil pengecekan vendor" />
              </label>
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                <p><strong>Matching:</strong> {matchLabels[selected.master_mapping_status]} · Kandidat: {selected.candidate_master_id ? (master[selected.candidate_master_id]?.product_code || selected.candidate_master_id) : "Tidak ada"}</p>
                <p className="mt-1">Jika kode diubah, simpan sebagai Draft terlebih dahulu. Verifikasi baru tersedia setelah kandidat Master dihitung ulang.</p>
              </div>
              {selected.master_mapping_status === "CANDIDATE_ONLY" && selected.master_match_count === 1 && selected.candidate_master_id && master[selected.candidate_master_id] &&
                <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />Saya sudah memeriksa kecocokan kode produk dengan Master WMS dan menyetujui verifikasi parameter ini.</label>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={saving} onClick={() => void save(false)} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold disabled:opacity-40">Simpan Draft</button>
                <button disabled={saving || !confirmed || selected.master_mapping_status !== "CANDIDATE_ONLY" || !selected.candidate_master_id || !master[selected.candidate_master_id] || edit.product_code.trim().toUpperCase() !== (selected.product_code ?? "").trim().toUpperCase()} onClick={() => void save(true)} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Verifikasi Manual</button>
              </div>
            </section></div>}
            <p className="pb-4 text-xs text-slate-500">Vendor source: snapshot impor terbaru. Perubahan parameter hanya memengaruhi Master Vendor, bukan stok, histori sales, forecast aktif, atau PO.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
