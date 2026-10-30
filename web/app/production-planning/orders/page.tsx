"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { lifecycleLabel } from "@/utils/productionLifecycleLabels";
import { createClient } from "@/utils/supabase/client";

type Vendor = { id: string; vendor_name: string };
type Order = { id: string; po_number: string; vendor_id: string; order_date: string; eta_date: string | null; status: string; notes: string | null };
type Line = { id: string; po_id: string; po_number: string; po_status: string; vendor_name: string; source_sku: string; source_product_name: string | null; variant_id: string | null; ordered_qty: number; cancelled_qty: number; received_qty: number; remaining_qty: number; confirmed_incoming_qty: number; progress: string; tracking_status: string; eta_date: string | null; seasonal_approved_at: string | null; verified_vendor_lifecycle?: string | null };
type Initial = { source_key: string; source_row: number; source_date: string; vendor_raw: string; product_name: string | null; sku_raw: string; ordered_qty: number; unit_hpp: number | null; source_note: string | null; progress: string; imported_po_id: string | null };
type Candidate = { movement_id: string; movement_no: number; quantity: number; received_at: string };
type Variant = { id: string; sku: string; color: string | null; size: string | null };
const money = (n: number) => new Intl.NumberFormat("id-ID").format(Number(n || 0));
const display = (s: string) => ({UNCONFIRMED:"Belum Dikonfirmasi",IN_PRODUCTION:"Dalam Produksi",READY_AT_VENDOR:"Ready at Vendor",IN_TRANSIT:"Dalam Pengiriman",PARTIAL_RECEIVED:"Diterima Sebagian",SUDAH_DITERIMA:"Selesai Diterima",SKU_BELUM_MAPPING:"SKU Belum Mapping",DRAFT_BELUM_FINAL:"Draft Belum Final"} as Record<string,string>)[s] || s;
const nowDate = () => new Date().toLocaleDateString("en-CA", {timeZone:"Asia/Jakarta"});

export default function ProductionOrdersPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [vendors,setVendors]=useState<Vendor[]>([]);
  const [orders,setOrders]=useState<Order[]>([]);
  const [lines,setLines]=useState<Line[]>([]);
  const [initial,setInitial]=useState<Initial[]>([]);
  const [profileRole,setProfileRole]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [tab,setTab]=useState<"po"|"initial">("po");
  const [selected,setSelected]=useState("");
  const [vendorId,setVendorId]=useState("");
  const [poNumber,setPoNumber]=useState("");
  const [poDate,setPoDate]=useState(nowDate());
  const [poEta,setPoEta]=useState("");
  const [groupKey,setGroupKey]=useState("");
  const [sku,setSku]=useState("");
  const [qty,setQty]=useState("");
  const [variantMatches,setVariantMatches]=useState<Variant[]>([]);
  const [variantId,setVariantId]=useState("");
  const [mapLineId,setMapLineId]=useState("");
  const [candidates,setCandidates]=useState<Record<string,Candidate[]>>({});
  const [receiptChoice,setReceiptChoice]=useState<Record<string,string>>({});

  const reload = useCallback(async () => {
    const [o,l,e,v] = await Promise.all([
      supabase.from("wms_po_orders").select("id,po_number,vendor_id,order_date,eta_date,status,notes").order("created_at",{ascending:false}).limit(500),
      supabase.from("wms_po_line_overview").select("*").limit(2500),
      supabase.from("wms_po_excel_initial").select("*").order("source_row").limit(500),
      supabase.from("wms_vendor_master").select("id,vendor_name").eq("is_active",true).order("vendor_name")
    ]);
    for (const res of [o,l,e,v]) if(res.error) throw res.error;
    setOrders((o.data || []) as Order[]);
    setLines((l.data || []) as Line[]);
    setInitial((e.data || []) as Initial[]);
    setVendors((v.data || []) as Vendor[]);
  },[supabase]);

  useEffect(() => {let alive = true;
    (async () => {try {
      const {data:{user},error:au}=await supabase.auth.getUser();
      if(au) throw au;
      if(!user) {router.replace("/login");return;}
      const {data:p,error:ep}=await supabase.from("profiles").select("role,is_active").eq("id",user.id).single();
      if(ep) throw ep;
      if(!p?.is_active || !["owner","admin","warehouse_manager"].includes(String(p.role))) throw new Error("Akun tidak punya akses Production Order.");
      if(!alive) return;
      setProfileRole(p.role);
      await reload();
    }catch(x){if(alive)setError((x as Error).message);}finally{if(alive)setLoading(false);}})();
    return ()=>{alive=false;};
  },[reload,router,supabase]);

  const owner = ["owner","admin"].includes(profileRole);
  async function run<T>(label:string,fn:()=>Promise<T>) {
    setBusy(true);setError("");setMessage("");
    try {await fn();await reload();setMessage(label+" berhasil.");}
    catch(x){setError((x as Error).message || String(x));}
    finally{setBusy(false);}
  }
  async function call(name:string,args:Record<string,unknown>) {
    const {data,error:rpcError}=await supabase.rpc(name,args);
    if(rpcError) throw rpcError;
    return data;
  }
  async function lookupSku(){
    setError("");setVariantMatches([]);setVariantId("");
    const clean=sku.trim();if(!clean) return;
    const {data,error:e}=await supabase.from("product_variants")
      .select("id,sku,color,size").ilike("sku",`%${clean.replaceAll("%","")}%`).eq("is_active",true).limit(25);
    if(e) setError(e.message); else setVariantMatches((data||[]) as Variant[]);
  }
  const selectedOrder=orders.find(o=>o.id===selected);
  const selectedLines=lines.filter(l=>l.po_id===selected);
  const groups=useMemo(()=> {
    const map=new Map<string,{key:string;vendor:string;date:string;rows:number;qty:number;ready:number;imported:number}>();
    for(const x of initial){const key=x.vendor_raw+"|"+x.source_date;
      const g=map.get(key)||{key,vendor:x.vendor_raw,date:x.source_date,rows:0,qty:0,ready:0,imported:0};
      g.rows++;g.qty+=x.ordered_qty;if(x.progress==="READY_AT_VENDOR")g.ready+=x.ordered_qty;
      if(x.imported_po_id)g.imported++;
      map.set(key,g);
    }
    return Array.from(map.values()).sort((a,b)=>a.date.localeCompare(b.date));
  },[initial]);
  const activeQty=lines.reduce((a,x)=>a+x.confirmed_incoming_qty,0);
  const sumOrdered=lines.reduce((a,x)=>a+(x.po_status==="FINAL"?x.ordered_qty:0),0);
  const receivedQty=lines.reduce((a,x)=>a+(x.po_status==="FINAL"?x.received_qty:0),0);
  const initialQty=initial.reduce((a,x)=>a+x.ordered_qty,0);
  const readyQty=initial.reduce((a,x)=>a+(x.progress==="READY_AT_VENDOR"?x.ordered_qty:0),0);
  const btn="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40";
  const inp="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  const soft="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";

  return <div className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-900 lg:flex">
    <Sidebar/>
    <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold">Production Order & Incoming</h1><p className="text-sm text-slate-500">PO Final, Ready at Vendor, pengiriman, dan penerimaan WMS</p></div>
          <button className={soft} disabled={busy} onClick={()=>void run("Refresh",reload)}>Refresh Data</button>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Data Excel awal masih <b>Review/Draft</b>. Barang Ready berarti selesai diproduksi di vendor, <b>bukan</b> sudah diterima gudang. Incoming aktif hanya dari PO Final; stok bertambah hanya melalui Inbound WMS.</div>
        {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {message && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
        {loading ? <p>Memuat data...</p> : <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[["Data Excel (Review)",initialQty],["Ready di Vendor (Excel)",readyQty],["Incoming PO Final",activeQty],["Sudah Diterima PO Final",receivedQty]].map(([label,value])=><div key={String(label)} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{money(Number(value))} <span className="text-xs font-normal">pcs</span></p></div>)}
          </div>
          <div className="flex flex-wrap gap-2"><button className={tab==="po"?btn:soft} onClick={()=>setTab("po")}>PO & Penerimaan</button><button className={tab==="initial"?btn:soft} onClick={()=>setTab("initial")}>Data Excel Awal ({initial.length} baris)</button></div>
          {tab==="initial" ? <section className="space-y-3 rounded-xl border bg-white p-4">
            <h2 className="text-lg font-bold">Review PO dari Excel</h2><p className="text-sm text-slate-600">Satu kelompok vendor + tanggal belum tentu satu PO resmi. Periksa nomor PO dan pemetaan vendor sebelum mengubahnya menjadi Draft. Tidak ada incoming aktif sampai PO difinalisasi.</p>
            <div className="overflow-x-auto"><table className="min-w-[820px] w-full text-left text-sm"><thead><tr className="border-b bg-slate-100"><th className="p-2">Tanggal</th><th className="p-2">Vendor Sumber</th><th className="p-2">Baris</th><th className="p-2">Qty</th><th className="p-2">Ready</th><th className="p-2">Sudah Dipindah</th><th className="p-2">Tindakan</th></tr></thead><tbody>{groups.map(g=><tr key={g.key} className="border-b"><td className="p-2">{g.date}</td><td className="p-2">{g.vendor}</td><td className="p-2">{g.rows}</td><td className="p-2">{money(g.qty)}</td><td className="p-2">{money(g.ready)}</td><td className="p-2">{g.imported}/{g.rows}</td><td className="p-2"><button disabled={busy||g.imported===g.rows} className={soft} onClick={()=>{setGroupKey(g.key);setPoDate(g.date);setPoNumber("");setVendorId("");}}>Pilih Grup</button></td></tr>)}</tbody></table></div>
            {groupKey && <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4"><b>Konversi kelompok {groupKey} menjadi PO Draft</b><p className="text-xs text-slate-600">Bukan approval final. Pilih vendor yang benar, isi nomor PO resmi. Bila satu tanggal/vendor ternyata lebih dari satu PO, jangan konversi kelompok ini dulu.</p>
              <div className="grid gap-3 md:grid-cols-3"><input className={inp} placeholder="Nomor PO resmi" value={poNumber} onChange={e=>setPoNumber(e.target.value)} /><select className={inp} value={vendorId} onChange={e=>setVendorId(e.target.value)}><option value="">Pilih Vendor Terverifikasi</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_name}</option>)}</select><button className={btn} disabled={!vendorId||!poNumber.trim()||busy} onClick={()=>void run("Konversi ke Draft",async()=>{const g=groups.find(g=>g.key===groupKey);if(!g)throw Error("Grup tidak ditemukan");const out=await call("wms_po_import_group",{p_vendor_raw:g.vendor,p_source_date:g.date,p_vendor_id:vendorId,p_po_number:poNumber.trim()}) as {po_id:string;lines:number;unmapped:number};setSelected(out.po_id);setTab("po");setGroupKey("");setMessage(`${out.lines} baris, ${out.unmapped} belum mapping.`);})}>Buat PO Draft</button></div>
            </div>}
          </section> : <>
            <section className="space-y-3 rounded-xl border bg-white p-4">
              <h2 className="text-lg font-bold">Buat PO Baru (Draft)</h2>
              <div className="grid gap-3 md:grid-cols-5"><input className={inp} placeholder="Nomor PO resmi" value={poNumber} onChange={e=>setPoNumber(e.target.value)}/><select className={inp} value={vendorId} onChange={e=>setVendorId(e.target.value)}><option value="">Pilih vendor</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_name}</option>)}</select><input className={inp} type="date" value={poDate} onChange={e=>setPoDate(e.target.value)}/><input className={inp} type="date" value={poEta} onChange={e=>setPoEta(e.target.value)}/><button className={btn} disabled={busy||!poNumber.trim()||!vendorId||!poDate} onClick={()=>void run("Buat PO Draft",async()=>{const id=await call("wms_po_create",{p_po_number:poNumber.trim(),p_vendor_id:vendorId,p_order_date:poDate,p_eta_date:poEta||null});setSelected(String(id));setPoNumber("");})}>Buat Draft</button></div>
            </section>
            <section className="space-y-3 rounded-xl border bg-white p-4"><h2 className="text-lg font-bold">Daftar PO</h2><p className="text-xs text-slate-500">Qty Final dipesan: {money(sumOrdered)} pcs. Pilih PO untuk melihat item, progres, dan penerimaan.</p>
              <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b bg-slate-100"><th className="p-2">Nomor PO</th><th className="p-2">Tanggal</th><th className="p-2">Vendor</th><th className="p-2">Status</th><th className="p-2">Belum Datang</th></tr></thead><tbody>{orders.map(o=><tr key={o.id} className={`cursor-pointer border-b ${selected===o.id?"bg-blue-50":"hover:bg-slate-50"}`} onClick={()=>setSelected(o.id)}><td className="p-2 font-semibold">{o.po_number}</td><td className="p-2">{o.order_date}</td><td className="p-2">{vendors.find(v=>v.id===o.vendor_id)?.vendor_name||"—"}</td><td className="p-2">{o.status}</td><td className="p-2">{money(lines.filter(l=>l.po_id===o.id).reduce((a,x)=>a+x.remaining_qty,0))} pcs</td></tr>)}</tbody></table></div>
            </section>
            {selectedOrder && <section className="space-y-3 rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">{selectedOrder.po_number}</h2><p className="text-sm text-slate-500">{display(selectedOrder.status)} · Estimasi: {selectedOrder.eta_date||"belum ditetapkan"}</p></div><div className="flex flex-wrap gap-2">{selectedOrder.status==="DRAFT" && owner && <button disabled={busy} className={btn} onClick={()=>{if(window.confirm("Finalkan PO ini? Setelah Final, qty dan mapping tidak dapat diubah."))void run("Finalisasi PO",async()=>{await call("wms_po_finalize",{p_po_id:selected});});}}>Finalkan PO (Owner/Admin)</button>}{selectedOrder.status==="FINAL"&&owner&&<button className={soft} disabled={busy} onClick={()=>{if(window.confirm("Tutup PO hanya jika semua qty sudah diterima atau dibatalkan?"))void run("Tutup PO",async()=>{await call("wms_po_close",{p_po_id:selected});});}}>Tutup PO</button>}{owner&&(selectedOrder.status==="DRAFT"||selectedOrder.status==="FINAL")&&<button className={soft} disabled={busy} onClick={()=>{if(window.confirm("Batalkan seluruh PO? Tidak ada stok yang akan diubah."))void run("Batalkan PO",async()=>{await call("wms_po_cancel_order",{p_po_id:selected});});}}>Batalkan PO</button>}</div></div>
              {selectedOrder.status==="DRAFT"&&<div className="space-y-2 rounded-lg bg-slate-50 p-3"><b className="text-sm">Tambah SKU ke PO</b><div className="grid gap-2 md:grid-cols-5"><input className={inp} value={sku} onChange={e=>setSku(e.target.value)} placeholder="Cari SKU master"/><button className={soft} onClick={()=>void lookupSku()}>Cari SKU</button><select className={inp} value={variantId} onChange={e=>setVariantId(e.target.value)}><option value="">Pilih hasil</option>{variantMatches.map(v=><option value={v.id} key={v.id}>{v.sku} {v.color||""} {v.size||""}</option>)}</select><input className={inp} type="number" min="1" placeholder="Qty PO" value={qty} onChange={e=>setQty(e.target.value)}/><button className={btn} disabled={busy||!variantId||!(Number(qty)>0)} onClick={()=>void run("Tambah SKU",async()=>{await call("wms_po_add_line",{p_po_id:selected,p_variant_id:variantId,p_qty:Number(qty)});setQty("");setSku("");setVariantId("");setVariantMatches([]);})}>Tambah</button></div></div>}
              <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-left text-sm"><thead><tr className="border-b bg-slate-100"><th className="p-2">SKU / Produk</th><th className="p-2">Qty PO</th><th className="p-2">Diterima</th><th className="p-2">Belum Datang</th><th className="p-2">Progres Vendor</th><th className="p-2">Status</th><th className="p-2">Tindakan</th></tr></thead><tbody>{selectedLines.map(l=><tr key={l.id} className="border-b align-top"><td className="p-2"><b>{l.source_sku}</b><p className="text-xs text-slate-500">{l.source_product_name}</p>{l.verified_vendor_lifecycle&&<p className="text-xs font-semibold text-slate-600">Lifecycle Produk: {lifecycleLabel(l.verified_vendor_lifecycle)}</p>}{!l.variant_id&&<span className="text-xs font-bold text-red-700">Belum mapping Master</span>}</td><td className="p-2">{l.ordered_qty}</td><td className="p-2">{l.received_qty}</td><td className="p-2 font-bold">{l.remaining_qty}</td><td className="p-2">{display(l.progress)}</td><td className="p-2">{display(l.tracking_status)}</td><td className="space-y-1 p-2">
                <select className={soft} disabled={busy||!['DRAFT','FINAL'].includes(l.po_status)} value={l.progress} onChange={e=>void run("Update progres",async()=>{await call("wms_po_set_progress",{p_line_id:l.id,p_progress:e.target.value,p_eta_date:null});})}><option value="UNCONFIRMED">Belum Dikonfirmasi</option><option value="IN_PRODUCTION">Dalam Produksi</option><option value="READY_AT_VENDOR">Ready at Vendor</option><option value="IN_TRANSIT">Dalam Pengiriman</option></select>
                {l.po_status==="DRAFT" && <button className={soft} disabled={busy} onClick={()=>{const value=window.prompt("Qty PO untuk "+l.source_sku+" (angka positif):",String(l.ordered_qty));if(value!==null && Number.isInteger(Number(value)) && Number(value)>0)void run("Update Qty PO",async()=>{await call("wms_po_set_draft_qty",{p_line_id:l.id,p_qty:Number(value)});});}}>Ubah Qty PO</button>}
                {owner && (l.po_status==="DRAFT"||l.po_status==="FINAL")&&<button className={soft} disabled={busy} onClick={()=>{const value=window.prompt("Total qty DIBATALKAN (bukan tambahan), maksimum "+(l.ordered_qty-l.received_qty)+" pcs:",String(l.cancelled_qty));if(value!==null && Number.isInteger(Number(value)) && Number(value)>=0)void run("Update pembatalan",async()=>{await call("wms_po_cancel_qty",{p_line_id:l.id,p_cancel_qty:Number(value)});});}}>Qty Batal</button>}
                {(l.po_status==="DRAFT"||l.po_status==="FINAL")&&<button className={soft} disabled={busy} onClick={()=>{const value=window.prompt("Tanggal estimasi tiba YYYY-MM-DD (kosongkan untuk tidak mengubah)",l.eta_date||"");if(value&&/^\d{4}-\d{2}-\d{2}$/.test(value))void run("Update ETA",async()=>{await call("wms_po_set_progress",{p_line_id:l.id,p_progress:l.progress,p_eta_date:value});});}}>Ubah ETA</button>}
                {l.po_status==="DRAFT" && !l.variant_id&&<button className={soft} onClick={()=>{setMapLineId(l.id);setSku(l.source_sku);setTab("po");}}>Mapping SKU</button>}
                {l.po_status==="DRAFT"&&owner&&l.verified_vendor_lifecycle==="Seasonal"&&(l.seasonal_approved_at?<span className="text-xs font-semibold text-emerald-700">Seasonal disetujui</span>:<button className={soft} disabled={busy} onClick={()=>void run("Approval Seasonal",async()=>{await call("wms_po_approve_seasonal",{p_line_id:l.id});})}>Approval Seasonal</button>)}
                {l.po_status==="FINAL"&&l.variant_id&&<button className={soft} disabled={busy} onClick={()=>void run("Cari Inbound",async()=>{const a=await call("wms_po_inbound_candidates",{p_line_id:l.id});setCandidates(x=>({...x,[l.id]:(a||[]) as Candidate[]}));})}>Cari Inbound</button>}
                {candidates[l.id] && <div className="flex gap-2"><select className={soft} value={receiptChoice[l.id]||""} onChange={e=>setReceiptChoice(x=>({...x,[l.id]:e.target.value}))}><option value="">Pilih inbound diposting</option>{candidates[l.id].map(c=><option key={c.movement_id} value={c.movement_id}>#{c.movement_no} · {c.quantity} pcs</option>)}</select><button className={btn} disabled={busy||!receiptChoice[l.id]} onClick={()=>void run("Tautkan inbound",async()=>{await call("wms_po_link_inbound",{p_line_id:l.id,p_movement_id:receiptChoice[l.id]});setCandidates(x=>{const next={...x};delete next[l.id];return next;});})}>Tautkan</button></div>}
              </td></tr>)}</tbody></table></div>
              {mapLineId && selectedLines.some(l=>l.id===mapLineId) && <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3"><b>Mapping SKU ke Master</b><div className="flex flex-wrap gap-2"><input className="min-w-[180px] flex-1 rounded-lg border p-2" value={sku} onChange={e=>setSku(e.target.value)}/><button className={soft} onClick={()=>void lookupSku()}>Cari Master SKU</button><select className={soft} value={variantId} onChange={e=>setVariantId(e.target.value)}><option value="">Pilih SKU valid</option>{variantMatches.map(v=><option key={v.id} value={v.id}>{v.sku} {v.color||""} {v.size||""}</option>)}</select><button className={btn} disabled={!variantId||busy} onClick={()=>void run("Simpan mapping",async()=>{await call("wms_po_map_line",{p_line_id:mapLineId,p_variant_id:variantId});setMapLineId("");setVariantId("");setSku("");setVariantMatches([]);})}>Simpan</button><button className={soft} onClick={()=>setMapLineId("")}>Batal</button></div></div>}
              <p className="text-xs text-slate-500">Saat barang tiba: posting di Inbound WMS dengan <b>Referensi = {selectedOrder.po_number}</b> dan SKU yang sesuai; setelah itu klik Cari Inbound → Tautkan. Stok hanya bertambah sekali, dari transaksi Inbound.</p>
            </section>}
          </>}
        </>}
      </div>
    </main>
  </div>;
}
