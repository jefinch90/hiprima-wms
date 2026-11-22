"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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


// HIPRIMA_PO_COMMERCIAL_V43H: Data ini hanya untuk dokumen vendor; jangan ekspor HPP internal.
type VerifiedCommercialLine = {
  id:string; sku:string; product:string; qty:number; price:number; subtotal:number;
};
type VerifiedCommercialPo = {
  poId:string; number:string; vendor:string; date:string; eta:string;
  approverRole:string; approvalDate:string; lines:VerifiedCommercialLine[];
  totalQty:number; totalAmount:number;
};
const officialAmount=(value:number)=>new Intl.NumberFormat("id-ID",{minimumFractionDigits:0,maximumFractionDigits:2}).format(value);
const officialSameMoney=(a:unknown,b:unknown)=>Math.round(Number(a)*100)===Math.round(Number(b)*100);

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
  const [etaDraft,setEtaDraft]=useState<Record<string,string>>({});
  // HIPRIMA_PO_AUTO_ETA_V43J: UI membaca asal PO, tidak mengubah ETA database.
  const [etaOrigin,setEtaOrigin]=useState<{id:string;mode:"checking"|"auto"|"manual"|"unknown"}>({id:"",mode:"checking"});
  const [groupKey,setGroupKey]=useState("");
  const [sku,setSku]=useState("");
  const [skuSearchMessage,setSkuSearchMessage]=useState("");
  const [qty,setQty]=useState("");
  const [variantMatches,setVariantMatches]=useState<Variant[]>([]);
  const [variantId,setVariantId]=useState("");
  const [mapLineId,setMapLineId]=useState("");
  const [candidates,setCandidates]=useState<Record<string,Candidate[]>>({});
  const [receiptChoice,setReceiptChoice]=useState<Record<string,string>>({});
  const [bulkSelection,setBulkSelection]=useState<Record<string,boolean>>({});
  const [bulkVendorIds,setBulkVendorIds]=useState<Record<string,string>>({});
  const [bulkNumbers,setBulkNumbers]=useState<Record<string,string>>({});
// HIPRIMA_PO_UI_V43F: filter dan navigasi PO hanya pada sisi UI.
  const [poSearch,setPoSearch]=useState("");
  const [poStatusFilter,setPoStatusFilter]=useState("ALL");
  const [poPage,setPoPage]=useState(1);
  // HIPRIMA_PO_UI_V43G: local UI search/filter/pagination, no new RPC or DB writes.
  const [poSkuQuery,setPoSkuQuery]=useState("");
  const [poProductFilter,setPoProductFilter]=useState("ALL");
  const [poSkuPage,setPoSkuPage]=useState(1);


  const [verifiedPo,setVerifiedPo]=useState<VerifiedCommercialPo|null>(null);
  const [verifiedPoBusy,setVerifiedPoBusy]=useState(false);
  const [verifiedPoMessage,setVerifiedPoMessage]=useState("");

  const [showPoPreview,setShowPoPreview]=useState(false);
  const [bulkConfirmed,setBulkConfirmed]=useState(false);

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
    const clean=sku.trim();
    if(!clean) {
      setSkuSearchMessage("Masukkan SKU untuk mulai mencari.");
      return;
    }
    setSkuSearchMessage("");
    const escaped=clean.replace(/[\\%_]/g,"\\$&");
    const {data,error:e}=await supabase.from("product_variants")
      .select("id,sku,color,size").ilike("sku",`%${escaped}%`).eq("is_active",true).limit(25);
    if(e) {
      setError(e.message);
      setSkuSearchMessage("Pencarian SKU gagal.");
    } else {
      const results=(data||[]) as Variant[];
      setVariantMatches(results);
      setSkuSearchMessage(results.length ? `${results.length} SKU ditemukan.` : "SKU aktif tidak ditemukan.");
    }
  }
  const selectedOrder=orders.find(o=>o.id===selected);
  const selectedLines=lines.filter(l=>l.po_id===selected);
  // PO dari workflow produksi memperoleh snapshot lead time dan ETA dari RPC.
  // Read-only, fail-closed bila hubungan PO tidak dapat diverifikasi.
  useEffect(()=>{
    let active=true;
    setEtaOrigin({id:selected,mode:"checking"});
    if(!selected)return ()=>{active=false;};
    void (async()=>{
      try{
        const {data,error}=await createClient().from("wms_production_po_conversion_orders")
          .select("po_id").eq("po_id",selected).limit(1);
        if(active)setEtaOrigin({id:selected,mode:error?"unknown":data?.length?"auto":"manual"});
      }catch{
        if(active)setEtaOrigin({id:selected,mode:"unknown"});
      }
    })();
    return ()=>{active=false;};
  },[selected]);
  const selectedEtaMode=etaOrigin.id===selected?etaOrigin.mode:"checking";
const poVendorName=(vendorId:string)=>vendors.find(v=>v.id===vendorId)?.vendor_name || "Vendor tidak ditemukan";
  const filteredPo=orders.filter(o=>{
    const query=poSearch.trim().toLowerCase();
    return (poStatusFilter==="ALL"||o.status===poStatusFilter) &&
      (!query||o.po_number.toLowerCase().includes(query)||poVendorName(o.vendor_id).toLowerCase().includes(query));
  });
  const poPageSize=15;
  const poPageCount=Math.max(1,Math.ceil(filteredPo.length/poPageSize));
  const poPageSafe=Math.min(poPage,poPageCount);
  const visiblePo=filteredPo.slice((poPageSafe-1)*poPageSize,poPageSafe*poPageSize);
  const selectedOrdered=selectedLines.reduce((sum,l)=>sum+l.ordered_qty,0);
  const selectedReceived=selectedLines.reduce((sum,l)=>sum+l.received_qty,0);
  const selectedRemaining=selectedLines.reduce((sum,l)=>sum+l.remaining_qty,0);
  function selectPoAndScroll(id:string){
    setSelected(id);
    setShowPoPreview(false);
    window.requestAnimationFrame(()=>document.getElementById("po-detail")?.scrollIntoView({behavior:"smooth",block:"start"}));
  }

  // PDF hanya berisi data yang benar-benar tersedia. Harga vendor disimpan terpisah
  // dan tidak boleh disimpulkan dari HPP master/angka referensi.
  async function downloadPoQuantityPdf(){
    if(!selectedOrder || selectedOrder.status!=="FINAL"){
      setError("PDF hanya untuk PO berstatus FINAL.");return;
    }
    if(selectedLines.length===0){setError("PO belum memiliki item.");return;}
    if(!window.confirm("PDF ini hanya rincian jumlah pesanan, BELUM memuat harga vendor terverifikasi. Pastikan penawaran harga resmi telah disetujui sebelum dikirim ke vendor. Lanjutkan download?")) return;
    setError("");
    try {
      const {jsPDF}=await import("jspdf");
      const pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
      const vendor=poVendorName(selectedOrder.vendor_id);
      const dateText=(value:string|null)=>value ? new Date(value+"T00:00:00").toLocaleDateString("id-ID",{day:"2-digit",month:"long",year:"numeric"}):"Belum ditentukan";
      let y=16;
      const left=16;
      const right=194;
      function pageHeader(continued=false){
        pdf.setFillColor(15,23,42);pdf.rect(0,0,210,10,"F");
        pdf.setTextColor(15,23,42);pdf.setFont("helvetica","bold");pdf.setFontSize(16);
        pdf.text("Hi.PRIMA",left,23);
        pdf.setFontSize(8);pdf.setFont("helvetica","normal");pdf.setTextColor(100,116,139);
        pdf.text("PT Prima Berkah Mulia",left,29);
        pdf.setTextColor(15,23,42);pdf.setFont("helvetica","bold");pdf.setFontSize(11);
        pdf.text(continued?"RINCIAN PO - LANJUTAN":"RINCIAN ORDER PRODUKSI",right,23,{align:"right"});
        pdf.setFont("helvetica","normal");pdf.setFontSize(8);
        pdf.text("Status: FINAL  |  Dokumen kuantitas",right,29,{align:"right"});
        y=38;
      }
      function footer(){
        pdf.setDrawColor(226,232,240);pdf.line(left,280,right,280);
        pdf.setFontSize(8);pdf.setTextColor(100,116,139);
        pdf.text("Dokumen elektronik WMS Hi.PRIMA - harga berdasarkan kesepakatan vendor terpisah",left,286);
      }
      function tableHeader(){
        pdf.setFillColor(241,245,249);pdf.rect(left,y,right-left,9,"F");
        pdf.setTextColor(30,41,59);pdf.setFont("helvetica","bold");pdf.setFontSize(8);
        pdf.text("NO",left+3,y+6);pdf.text("SKU",left+14,y+6);
        pdf.text("PRODUK",left+59,y+6);pdf.text("QTY",right-5,y+6,{align:"right"});
        y+=10;
      }
      pageHeader();
      pdf.setFont("helvetica","normal");pdf.setTextColor(51,65,85);pdf.setFontSize(9);
      pdf.text("Nomor PO",left,44);pdf.text(": "+selectedOrder.po_number,left+36,44);
      pdf.text("Vendor",left,51);pdf.text(": "+vendor,left+36,51);
      pdf.text("Tanggal PO",left,58);pdf.text(": "+dateText(selectedOrder.order_date),left+36,58);
      pdf.text("Estimasi tiba",left,65);pdf.text(": "+dateText(selectedOrder.eta_date),left+36,65);
      pdf.setDrawColor(226,232,240);pdf.line(left,71,right,71);y=77;
      tableHeader();
      selectedLines.forEach((line,index)=>{
        const sku=pdf.splitTextToSize(String(line.source_sku||"-"),40);
        const name=pdf.splitTextToSize(String(line.source_product_name||"-"),90);
        const rowH=Math.max(10,Math.max(sku.length,name.length)*4+6);
        if(y+rowH>269){footer();pdf.addPage();pageHeader(true);tableHeader();}
        if(index%2===1){pdf.setFillColor(248,250,252);pdf.rect(left,y,right-left,rowH,"F");}
        pdf.setTextColor(30,41,59);pdf.setFont("helvetica","normal");pdf.setFontSize(8);
        pdf.text(String(index+1),left+3,y+6);
        pdf.text(sku,left+14,y+6);pdf.text(name,left+59,y+6);
        pdf.setFont("helvetica","bold");pdf.text(String(line.ordered_qty),right-5,y+6,{align:"right"});
        y+=rowH;
      });
      if(y+30>269){footer();pdf.addPage();pageHeader(true);}
      pdf.setDrawColor(203,213,225);pdf.line(left,y+1,right,y+1);
      pdf.setFont("helvetica","bold");pdf.setFontSize(10);pdf.setTextColor(15,23,42);
      pdf.text("TOTAL PESANAN: "+selectedOrdered.toLocaleString("id-ID")+" pcs",right,y+9,{align:"right"});
      pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(100,116,139);
      const notes=pdf.splitTextToSize("CATATAN: Dokumen ini tidak memuat harga satuan atau total nilai PO. Lampirkan penawaran harga vendor yang telah disetujui. Jangan menggunakan HPP master sebagai harga kesepakatan tanpa verifikasi.",right-left);
      pdf.text(notes,left,y+18);
      footer();
      const safe=(s:string)=>s.replace(/[^A-Za-z0-9_-]+/g,"-").slice(0,60);
      pdf.save("PO-"+safe(selectedOrder.po_number)+"-"+safe(vendor)+"-RincianQty.pdf");
    }catch(e){setError("Gagal membuat PDF: "+(e instanceof Error?e.message:String(e)));}
  }

  useEffect(()=>{setPoSkuQuery("");setPoProductFilter("ALL");setPoSkuPage(1);},[selected]);
  const poProductName=(l:Line)=>String(l.source_product_name||"Tanpa Nama Produk").trim()||"Tanpa Nama Produk";
  const poProducts=Array.from(new Set(selectedLines.map(poProductName))).sort((a,b)=>a.localeCompare(b,"id"));
  const filteredPoLines=selectedLines.filter(l=>{
    const query=poSkuQuery.trim().toLocaleLowerCase("id");
    const matchProduct=poProductFilter==="ALL"||poProductName(l)===poProductFilter;
    const matchQuery=!query||[l.source_sku,l.source_product_name,l.progress,l.tracking_status].join(" ").toLocaleLowerCase("id").includes(query);
    return matchProduct&&matchQuery;
  }).sort((a,b)=>poProductName(a).localeCompare(poProductName(b),"id")||String(a.source_sku||"").localeCompare(String(b.source_sku||""),"id"));
  const skuPageSize=12;
  const skuPageCount=Math.max(1,Math.ceil(filteredPoLines.length/skuPageSize));
  const skuPageSafe=Math.min(poSkuPage,skuPageCount);
  const visiblePoLines=filteredPoLines.slice((skuPageSafe-1)*skuPageSize,skuPageSafe*skuPageSize);


  async function downloadPoQuantityExcel(){
    if(!selectedOrder||selectedOrder.status!=="FINAL"){
      setError("Excel hanya tersedia untuk PO FINAL.");return;
    }
    if(selectedLines.length===0){setError("PO belum memiliki item.");return;}
    const accepted=window.confirm("Excel ini hanya rincian kuantitas PO. Harga vendor dan total nilai komersial belum terverifikasi. Jangan kirim sebagai PO komersial tanpa kesepakatan harga resmi. Lanjutkan download Excel Qty?");
    if(!accepted)return;
    setError("");
    try{
      const {Workbook}=await import("exceljs");
      const workbook=new Workbook();
      workbook.creator="Hi.PRIMA WMS";
      workbook.subject="Rincian kuantitas Purchase Order - tidak mencakup harga vendor";
      const sheet=workbook.addWorksheet("Rincian PO",{views:[{state:"frozen",ySplit:8}]});
      sheet.columns=[
        {key:"no",width:7},{key:"sku",width:27},{key:"product",width:38},
        {key:"ordered",width:15},{key:"received",width:15},{key:"remaining",width:18},
        {key:"progress",width:23},{key:"eta",width:19},{key:"item_status",width:28}
      ];
      sheet.mergeCells("A1:I1");sheet.getCell("A1").value="Hi.PRIMA | PT Prima Berkah Mulia";
      sheet.getCell("A1").font={bold:true,size:16,color:{argb:"FF0F172A"}};
      sheet.getRow(1).height=28;
      sheet.mergeCells("A2:I2");sheet.getCell("A2").value="RINCIAN ORDER PRODUKSI - KUANTITAS SAJA";
      sheet.getCell("A2").font={bold:true,size:12,color:{argb:"FF334155"}};
      sheet.getCell("A3").value="Nomor PO";sheet.getCell("B3").value=selectedOrder.po_number;
      sheet.getCell("D3").value="Vendor";sheet.getCell("E3").value=poVendorName(selectedOrder.vendor_id);
      sheet.getCell("A4").value="Tanggal";sheet.getCell("B4").value=selectedOrder.order_date;
      sheet.getCell("D4").value="ETA";sheet.getCell("E4").value=selectedOrder.eta_date||"Belum ditetapkan";
      sheet.getCell("A5").value="Status";sheet.getCell("B5").value="FINAL";
      sheet.mergeCells("A6:I6");sheet.getCell("A6").value="PENTING: Tidak memuat harga vendor terverifikasi. Bukan dokumen komersial tanpa persetujuan harga.";
      sheet.getCell("A6").font={bold:true,color:{argb:"FF92400E"}};
      sheet.getCell("A6").fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFFFF3CC"}};
      sheet.getRow(6).height=27;
      const header=sheet.getRow(8);
      header.values=["No","SKU / Varian","Nama Produk","Qty PO","Diterima","Belum Datang","Progres Vendor","ETA Item","Status Item"];
      header.height=24;
      header.font={bold:true,color:{argb:"FFFFFFFF"}};
      header.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF172554"}};
      header.alignment={vertical:"middle"};
      sheet.autoFilter={from:"A8",to:"I8"};
      const sortedLines=[...selectedLines].sort((a,b)=>poProductName(a).localeCompare(poProductName(b),"id")||String(a.source_sku).localeCompare(String(b.source_sku),"id"));
      sortedLines.forEach((l,index)=>{
        const row=sheet.addRow([index+1,String(l.source_sku||""),poProductName(l),
          Number(l.ordered_qty)||0,Number(l.received_qty)||0,Number(l.remaining_qty)||0,
          display(l.progress),l.eta_date||"",display(l.tracking_status)]);
        row.alignment={vertical:"middle",wrapText:true};
        row.height=22;
        if(index%2===1)row.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF1F5F9"}};
        for(const column of [4,5,6])row.getCell(column).numFmt="#,##0";
      });
      const totalRow=sheet.addRow(["","","TOTAL",selectedOrdered,selectedReceived,selectedRemaining,"","",""]);
      totalRow.font={bold:true,color:{argb:"FF0F172A"}};
      totalRow.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFDDE8F4"}};
      totalRow.height=25;
      for(const column of [4,5,6])totalRow.getCell(column).numFmt="#,##0";
      sheet.pageSetup={paperSize:9,orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0};
      const bytes=await workbook.xlsx.writeBuffer();
      const blob=new Blob([bytes as unknown as BlobPart],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      const safe=(s:string)=>s.replace(/[^A-Za-z0-9_-]+/g,"-").slice(0,60);
      a.href=url;
      a.download="PO-"+safe(selectedOrder.po_number)+"-"+safe(poVendorName(selectedOrder.vendor_id))+"-RincianQty.xlsx";
      document.body.appendChild(a);a.click();a.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1500);
    }catch(e){setError("Gagal membuat Excel: "+(e instanceof Error?e.message:String(e)));}
  }


  // Data selalu diambil ulang ketika dokumen RESMI akan diunduh.
  useEffect(()=>{setVerifiedPo(null);setVerifiedPoMessage("");},[selected]);

  async function checkAndReadOfficialPo():Promise<VerifiedCommercialPo>{
    if(!owner)throw new Error("Hanya Owner/Admin boleh melihat atau mengekspor harga PO resmi.");
    const po=selectedOrder;
    if(!po||po.status!=="FINAL")throw new Error("PO resmi hanya dapat dibuat dari PO berstatus FINAL.");
    if(!po.eta_date)throw new Error("ETA PO belum ditetapkan. Lengkapi jadwal resmi sebelum ekspor komersial.");
    if(!selectedLines.length)throw new Error("Tidak ada detail SKU pada PO ini.");
    if(selectedLines.some(l=>Number(l.cancelled_qty)>0))throw new Error("PO memiliki pembatalan Qty; membutuhkan revisi/amendemen sebelum ekspor PO resmi.");
    if(selectedLines.some(l=>!l.variant_id||!Number.isInteger(Number(l.ordered_qty))||Number(l.ordered_qty)<=0)){
      throw new Error("Ada SKU/Qty belum valid; PO resmi diblokir.");
    }
    const {data:orderLinks,error:olError}=await supabase.from("wms_production_po_conversion_orders")
      .select("id,conversion_id,vendor_id,po_id").eq("po_id",po.id).limit(2);
    if(olError)throw new Error("Tidak dapat membaca bukti konversi PO: "+olError.message);
    if(!orderLinks||orderLinks.length!==1)throw new Error("PO lama/manual tanpa bukti konversi approval operasional. Gunakan PDF/Excel Qty; jangan menerbitkan harga komersial otomatis.");
    const link=orderLinks[0];
    if(link.vendor_id!==po.vendor_id)throw new Error("Vendor PO berbeda dengan vendor yang disetujui.");
    const {data:conversion,error:coError}=await supabase.from("wms_production_po_conversions")
      .select("id,operational_approval_id,source_batch_id,status,created_at")
      .eq("id",link.conversion_id).single();
    if(coError||!conversion)throw new Error("Bukti konversi tidak dapat diverifikasi.");
    if(conversion.status!=="COMPLETED")throw new Error("Konversi ke PO belum COMPLETED.");
    const {data:approval,error:apError}=await supabase.from("wms_production_operational_approvals")
      .select("id,status,decided_by,decided_role,decided_at")
      .eq("id",conversion.operational_approval_id).single();
    if(apError||!approval||approval.status!=="APPROVED"||!approval.decided_by||!approval.decided_at||
       !["owner","admin"].includes(String(approval.decided_role||"").toLowerCase())){
      throw new Error("Persetujuan Owner/Admin belum dapat dibuktikan.");
    }
    if(new Date(conversion.created_at).getTime()<new Date(approval.decided_at).getTime()){
      throw new Error("Urutan waktu approval dan pembuatan PO tidak valid.");
    }
    const {data:conversionLines,error:clError}=await supabase.from("wms_production_po_conversion_lines")
      .select("po_line_id,source_review_line_id,quote_id,vendor_unit_price_snapshot,currency_snapshot,ordered_qty_snapshot")
      .eq("conversion_order_id",link.id).limit(10000);
    if(clError)throw new Error("Gagal membaca snapshot harga PO: "+clError.message);
    if(!conversionLines||conversionLines.length!==selectedLines.length){
      throw new Error("Jumlah item PO tidak cocok dengan bukti snapshot; ekspor diblokir.");
    }
    const {data:approvedLines,error:alError}=await supabase.from("wms_production_operational_approval_lines")
      .select("source_review_line_id,vendor_id,variant_id,quote_id,quote_verified_at_snapshot,master_hpp_snapshot,proposed_qty,vendor_unit_price_snapshot,currency_snapshot")
      .eq("approval_id",approval.id).limit(10000);
    if(alError)throw new Error("Tidak dapat membaca detail approval: "+alError.message);
    if(!approvedLines||approvedLines.length!==conversionLines.length){
      throw new Error("Detail approval tidak lengkap dibanding baris PO.");
    }
    // HIPRIMA_PO_HPP_DEFAULT_V43J: standar HPP boleh hanya bila tersimpan pada snapshot approval.
    // Harga khusus/perubahan tetap mensyaratkan quote VERIFIED sebelum approval.
    const quoteIds=Array.from(new Set(conversionLines.map(l=>String(l.quote_id||"")).filter(Boolean)));
    const quoteResult=quoteIds.length ? await supabase.from("wms_vendor_variant_quotes")
      .select("id,vendor_id,variant_id,unit_price,currency,status,verified_by,verified_at,created_by,scope_batch_id")
      .in("id",quoteIds).limit(10000) : null;
    if(quoteResult?.error)throw new Error("Gagal memverifikasi harga khusus vendor: "+quoteResult.error.message);
    if(quoteIds.length && (quoteResult?.data?.length ?? 0)!==quoteIds.length){
      throw new Error("Bukti perubahan harga belum lengkap.");
    }
    const quoteMap=new Map((quoteResult?.data||[]).map(q=>[q.id,q]));
    const approvedMap=new Map(approvedLines.map(a=>[a.source_review_line_id,a]));
    const poLineMap=new Map(selectedLines.map(l=>[l.id,l]));
    const seenIds=new Set<string>();
    const result:VerifiedCommercialLine[]=[];
    for(const cl of conversionLines){
      if(seenIds.has(cl.po_line_id))throw new Error("Baris PO duplikat dalam conversion.");
      seenIds.add(cl.po_line_id);
      const l=poLineMap.get(cl.po_line_id);
      const al=approvedMap.get(cl.source_review_line_id);
      const q=cl.quote_id ? quoteMap.get(cl.quote_id) : null;
      if(!l||!al)throw new Error("Pemetaan item PO dan approval tidak lengkap.");
      if(al.vendor_id!==po.vendor_id||al.variant_id!==l.variant_id||
         (al.quote_id??null)!==(cl.quote_id??null)){
        throw new Error("SKU, vendor, atau sumber harga tidak sama dengan approval.");
      }
      const qty=Number(cl.ordered_qty_snapshot);
      const price=Number(cl.vendor_unit_price_snapshot);
      if(!Number.isInteger(qty)||qty<=0||!Number.isFinite(price)||price<=0||
         qty!==Number(l.ordered_qty)||qty!==Number(al.proposed_qty)||
         cl.currency_snapshot!=="IDR"||al.currency_snapshot!=="IDR"||
         !officialSameMoney(price,al.vendor_unit_price_snapshot)){
        throw new Error("Qty atau snapshot harga berbeda dari persetujuan. Ekspor ditolak.");
      }
      if(cl.quote_id){
        if(!q||q.vendor_id!==po.vendor_id||q.variant_id!==l.variant_id){
          throw new Error("Quote vendor tidak sesuai dengan PO.");
        }
        if(q.scope_batch_id&&q.scope_batch_id!==conversion.source_batch_id){
          throw new Error("Quote hanya berlaku untuk batch lain.");
        }
        if(q.status!=="VERIFIED"||!q.verified_by||!q.verified_at||
           q.verified_by===q.created_by||!al.quote_verified_at_snapshot){
          throw new Error("Harga khusus vendor belum diverifikasi independen.");
        }
        if(new Date(q.verified_at).getTime()>new Date(approval.decided_at).getTime()||
           new Date(al.quote_verified_at_snapshot).getTime()>new Date(approval.decided_at).getTime()){
          throw new Error("Verifikasi harga dilakukan setelah approval.");
        }
        if(q.currency!=="IDR"||!officialSameMoney(price,q.unit_price)){
          throw new Error("Harga quote tidak cocok dengan snapshot approval.");
        }
      }else{
        const standard=Number(al.master_hpp_snapshot);
        if(!Number.isFinite(standard)||standard<=0||al.quote_verified_at_snapshot!=null||
           !officialSameMoney(price,standard)){
          throw new Error("Harga HPP standar tidak cocok dengan snapshot approval.");
        }
      }
      if(!l.source_sku||!l.source_product_name)throw new Error("Identitas SKU/produk tidak lengkap.");
      result.push({id:l.id,sku:l.source_sku,product:l.source_product_name,
        qty,price,subtotal:Math.round(qty*price*100)/100});
    }
    result.sort((a,b)=>a.product.localeCompare(b.product,"id")||a.sku.localeCompare(b.sku,"id"));
    const totalQty=result.reduce((n,l)=>n+l.qty,0);
    const totalAmount=Math.round(result.reduce((n,l)=>n+l.subtotal,0)*100)/100;
    if(totalQty!==selectedOrdered||result.length!==selectedLines.length){
      throw new Error("Total dokumen tidak cocok dengan PO.");
    }
    return {poId:po.id,number:po.po_number,vendor:poVendorName(po.vendor_id),date:po.order_date,
      eta:po.eta_date,approverRole:String(approval.decided_role).toUpperCase(),
      approvalDate:String(approval.decided_at),lines:result,totalQty,totalAmount};
  }

  async function showOfficialPoPreview(){
    setVerifiedPoBusy(true);setVerifiedPoMessage("");setVerifiedPo(null);
    try{const doc=await checkAndReadOfficialPo();setVerifiedPo(doc);
      setVerifiedPoMessage("VERIFIED: Harga PO cocok dengan persetujuan Owner/Admin. Dokumen siap diunduh.");
    }catch(e){setVerifiedPoMessage("BELUM SIAP: "+(e instanceof Error?e.message:String(e)));}
    finally{setVerifiedPoBusy(false);}
  }

  async function exportOfficialPo(format:"pdf"|"xlsx"){
    setVerifiedPoBusy(true);setVerifiedPoMessage("");
    try{
      const doc=await checkAndReadOfficialPo();
      setVerifiedPo(doc);
      if(!window.confirm("PO Vendor "+doc.number+" untuk "+doc.vendor+". Qty "+officialAmount(doc.totalQty)+
        " pcs; nilai Rp "+officialAmount(doc.totalAmount)+". Pastikan akan dikirim ke vendor yang benar. Download?"))return;
      const safe=(s:string)=>s.replace(/[^A-Za-z0-9_-]+/g,"-").slice(0,60);
      const filename="PO-Vendor-"+safe(doc.number)+"-"+safe(doc.vendor);
      if(format==="xlsx"){
        const {Workbook}=await import("exceljs");
        const wb=new Workbook();wb.creator="Hi.PRIMA WMS";
        wb.subject="PO Vendor berdasarkan harga snapshot yang disetujui";
        const ws=wb.addWorksheet("PO Vendor",{views:[{state:"frozen",ySplit:9}]});
        ws.columns=[{key:"no",width:7},{key:"sku",width:28},{key:"product",width:40},
          {key:"qty",width:14},{key:"price",width:22},{key:"subtotal",width:26}];
        ws.mergeCells("A1:F1");ws.getCell("A1").value="Hi.PRIMA | PT Prima Berkah Mulia";
        ws.getCell("A1").font={bold:true,size:16,color:{argb:"FF0F172A"}};ws.getRow(1).height=28;
        ws.mergeCells("A2:F2");ws.getCell("A2").value="PO VENDOR - HARGA DISETUJUI";
        ws.getCell("A2").font={bold:true,size:12};
        ws.getCell("A3").value="Nomor PO";ws.getCell("B3").value=doc.number;
        ws.getCell("D3").value="Vendor";ws.getCell("E3").value=doc.vendor;
        ws.getCell("A4").value="Tanggal";ws.getCell("B4").value=doc.date;
        ws.getCell("D4").value="ETA";ws.getCell("E4").value=doc.eta;
        ws.getCell("A5").value="Disetujui";ws.getCell("B5").value=doc.approverRole;
        ws.getCell("D5").value="Waktu";ws.getCell("E5").value=doc.approvalDate;
        ws.mergeCells("A7:F7");ws.getCell("A7").value="Dokumen bersumber dari snapshot approval WMS; tidak memuat HPP/margin internal.";
        ws.getCell("A7").font={italic:true,color:{argb:"FF475569"}};
        const hdr=ws.getRow(9);hdr.values=["No","SKU / Varian","Nama Produk","Qty PO","Harga Vendor (Rp)","Subtotal (Rp)"];
        hdr.font={bold:true,color:{argb:"FFFFFFFF"}};
        hdr.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF172554"}};
        hdr.alignment={vertical:"middle"};hdr.height=24;
        ws.autoFilter={from:"A9",to:"F9"};
        doc.lines.forEach((l,i)=>{
          const row=ws.addRow([i+1,l.sku,l.product,l.qty,l.price,l.subtotal]);
          row.height=22;row.alignment={vertical:"middle",wrapText:true};
          row.getCell(4).numFmt="#,##0";
          row.getCell(5).numFmt='"Rp" #,##0.00';row.getCell(6).numFmt='"Rp" #,##0.00';
          if(i%2)row.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF1F5F9"}};
        });
        const tr=ws.addRow(["","","TOTAL",doc.totalQty,"",doc.totalAmount]);
        tr.font={bold:true};tr.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFDEE7F2"}};
        tr.getCell(6).numFmt='"Rp" #,##0.00';
        ws.pageSetup={paperSize:9,orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0};
        const bytes=await wb.xlsx.writeBuffer();
        const blob=new Blob([bytes as unknown as BlobPart],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
        const href=URL.createObjectURL(blob);const a=document.createElement("a");
        a.href=href;a.download=filename+".xlsx";document.body.appendChild(a);a.click();a.remove();
        window.setTimeout(()=>URL.revokeObjectURL(href),1500);
      }else{
        const {jsPDF}=await import("jspdf");
        const pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
        const L=14,R=196;let y=12;
        const moneyText=(n:number)=>"Rp "+officialAmount(n);
        function footer(){
          pdf.setDrawColor(203,213,225);pdf.line(L,281,R,281);
          pdf.setFontSize(7);pdf.setFont("helvetica","normal");pdf.setTextColor(100,116,139);
          pdf.text("PO Vendor - harga snapshot disetujui Owner/Admin",L,286);
          pdf.text("Hal. "+pdf.getNumberOfPages(),R,286,{align:"right"});
        }
        function head(continuation:boolean){
          pdf.setFillColor(15,23,42);pdf.rect(0,0,210,10,"F");
          pdf.setFont("helvetica","bold");pdf.setTextColor(15,23,42);pdf.setFontSize(15);
          pdf.text("Hi.PRIMA",L,22);pdf.setFontSize(11);
          pdf.text(continuation?"PURCHASE ORDER (LANJUTAN)":"PURCHASE ORDER RESMI",R,22,{align:"right"});
          pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(71,85,105);
          pdf.text("PT Prima Berkah Mulia",L,28);pdf.text("Status: FINAL / APPROVED",R,28,{align:"right"});
          y=37;
          if(!continuation){
            pdf.setTextColor(30,41,59);pdf.setFontSize(9);
            const fields=[["Nomor PO",doc.number],["Vendor",doc.vendor],["Tanggal",doc.date],
              ["ETA",doc.eta],["Approval",doc.approverRole+" - "+doc.approvalDate]];
            fields.forEach(([k,v])=>{pdf.text(k,L,y);pdf.text(": "+String(v),L+28,y);y+=6;});
            y+=2;
          }
          pdf.setFillColor(241,245,249);pdf.rect(L,y,R-L,9,"F");
          pdf.setFont("helvetica","bold");pdf.setTextColor(30,41,59);pdf.setFontSize(8);
          pdf.text("NO",L+2,y+6);pdf.text("SKU",L+14,y+6);pdf.text("PRODUK",L+55,y+6);
          pdf.text("QTY",L+121,y+6,{align:"right"});
          pdf.text("HARGA",L+149,y+6,{align:"right"});
          pdf.text("SUBTOTAL",R-2,y+6,{align:"right"});y+=10;
        }
        head(false);
        doc.lines.forEach((l,i)=>{
          const sku=pdf.splitTextToSize(l.sku,38);
          const name=pdf.splitTextToSize(l.product,57);
          const h=Math.max(10,Math.max(sku.length,name.length)*4+5);
          if(y+h>267){footer();pdf.addPage();head(true);}
          if(i%2){pdf.setFillColor(248,250,252);pdf.rect(L,y,R-L,h,"F");}
          pdf.setTextColor(30,41,59);pdf.setFont("helvetica","normal");pdf.setFontSize(8);
          pdf.text(String(i+1),L+2,y+6);pdf.text(sku,L+14,y+6);pdf.text(name,L+55,y+6);
          pdf.text(String(l.qty),L+121,y+6,{align:"right"});
          pdf.text(officialAmount(l.price),L+149,y+6,{align:"right"});
          pdf.setFont("helvetica","bold");pdf.text(officialAmount(l.subtotal),R-2,y+6,{align:"right"});
          y+=h;
        });
        if(y+29>267){footer();pdf.addPage();head(true);}
        pdf.setDrawColor(148,163,184);pdf.line(L,y+2,R,y+2);
        pdf.setTextColor(15,23,42);pdf.setFont("helvetica","bold");pdf.setFontSize(10);
        pdf.text("TOTAL "+doc.totalQty+" PCS",L+2,y+11);
        pdf.text(moneyText(doc.totalAmount),R-2,y+11,{align:"right"});
        pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(71,85,105);
        pdf.text("Ketentuan tambahan sesuai kesepakatan tertulis dengan vendor.",L,y+20);
        footer();pdf.save(filename+".pdf");
      }
      setVerifiedPoMessage("DOWNLOAD SIAP: "+filename+"."+format+". Dokumen berasal dari snapshot harga yang sudah disetujui.");
    }catch(e){setVerifiedPoMessage("GAGAL / BELUM SIAP: "+(e instanceof Error?e.message:String(e)));}
    finally{setVerifiedPoBusy(false);}
  }

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
  const bulkGroups=groups.filter(g=>Boolean(bulkSelection[g.key])&&g.imported===0);
  const bulkLines=bulkGroups.reduce((sum,g)=>sum+g.rows,0);
  const activeQty=lines.reduce((a,x)=>a+x.confirmed_incoming_qty,0);
  const sumOrdered=lines.reduce((a,x)=>a+(x.po_status==="FINAL"?x.ordered_qty:0),0);
  const receivedQty=lines.reduce((a,x)=>a+(x.po_status==="FINAL"?x.received_qty:0),0);
  const initialQty=initial.reduce((a,x)=>a+x.ordered_qty,0);
  const readyQty=initial.reduce((a,x)=>a+(x.progress==="READY_AT_VENDOR"?x.ordered_qty:0),0);
  const btn="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40";
  const inp="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  const soft="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";

  return <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6 lg:p-8">
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
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-bold">Konversi Beberapa Grup Sekaligus  -  Hanya Draft</h3>
              <p className="text-xs text-amber-800">Penting: satu grup vendor + tanggal belum tentu satu PO sebenarnya. Hanya centang grup yang sudah dipastikan satu pesanan, belum diimpor, dan vendor master-nya benar. Barang Ready at Vendor historis harus dicek apakah sudah pernah diterima sebelum PO difinalisasi.</p>
              <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">Pilih</th><th className="p-2">Tanggal / vendor sumber</th><th className="p-2">Qty / baris</th><th className="p-2">Vendor Master (wajib)</th><th className="p-2">Nomor PO historis</th></tr></thead><tbody>
                {groups.filter(g=>g.imported<g.rows).map(g=><tr key={g.key} className="border-b align-top">
                  <td className="p-2"><input type="checkbox" aria-label={`Pilih grup ${g.vendor} ${g.date}`} disabled={busy||g.imported>0} checked={Boolean(bulkSelection[g.key])} onChange={e=>setBulkSelection(s=>({...s,[g.key]:e.target.checked}))}/></td>
                  <td className="p-2">{g.date}<br/><b>{g.vendor}</b>{g.imported>0&&<p className="text-xs text-red-700">Sudah sebagian dipindah: tidak bisa diproses massal</p>}</td>
                  <td className="p-2">{money(g.qty)} pcs / {g.rows} baris</td>
                  <td className="p-2"><select className={inp} disabled={busy||g.imported>0} value={bulkVendorIds[g.key]||""} onChange={e=>setBulkVendorIds(v=>({...v,[g.key]:e.target.value}))}><option value="">Pilih vendor terverifikasi</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_name}</option>)}</select></td>
                  <td className="p-2"><input className={inp} disabled={busy||g.imported>0} aria-label={`Nomor historis ${g.vendor} ${g.date}`} value={bulkNumbers[g.key]??g.date.replaceAll("-","")} onChange={e=>setBulkNumbers(n=>({...n,[g.key]:e.target.value}))}/></td>
                </tr>)}
              </tbody></table></div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={bulkConfirmed} onChange={e=>setBulkConfirmed(e.target.checked)}/><span>Saya sudah memastikan setiap grup terpilih merupakan satu PO yang benar dan memverifikasi vendor serta nomor PO historisnya. Data hanya akan dikonversi menjadi Draft, bukan Final.</span></label>
              <div className="flex flex-wrap items-center gap-3"><button className={btn} disabled={busy||!bulkConfirmed||bulkGroups.length===0||bulkGroups.some(g=>!bulkVendorIds[g.key]||!(bulkNumbers[g.key]??g.date.replaceAll("-","")).trim())} onClick={()=>{
                const summary=`Konversi ${bulkGroups.length} grup (${bulkLines} baris) menjadi PO Draft? Tidak ada PO Final atau perubahan stok.`;
                if(!window.confirm(summary))return;
                void run(`Konversi ${bulkGroups.length} grup`,async()=>{
                  await call("wms_po_import_bulk",{p_groups:bulkGroups.map(g=>({vendor_raw:g.vendor,source_date:g.date,vendor_id:bulkVendorIds[g.key],po_number:(bulkNumbers[g.key]??g.date.replaceAll("-","")).trim(),confirmed:true}))});
                  setBulkSelection({});setBulkVendorIds({});setBulkNumbers({});setBulkConfirmed(false);setTab("po");
                });
              }}>Konversi {bulkGroups.length} Grup ke Draft</button><span className="text-xs text-slate-600">Dipilih: {bulkLines} baris. Jika satu grup gagal, semua grup dalam batch dibatalkan oleh database.</span></div>
            </div>
            {groupKey && <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4"><b>Konversi kelompok {groupKey} menjadi PO Draft</b><p className="text-xs text-slate-600">Bukan approval final. Pilih vendor yang benar, isi nomor PO resmi. Bila satu tanggal/vendor ternyata lebih dari satu PO, jangan konversi kelompok ini dulu.</p>
              <div className="grid gap-3 md:grid-cols-3"><input className={inp} placeholder="Nomor PO resmi" value={poNumber} onChange={e=>setPoNumber(e.target.value)} /><select className={inp} value={vendorId} onChange={e=>setVendorId(e.target.value)}><option value="">Pilih Vendor Terverifikasi</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_name}</option>)}</select><button className={btn} disabled={!vendorId||!poNumber.trim()||busy} onClick={()=>void run("Konversi ke Draft",async()=>{const g=groups.find(g=>g.key===groupKey);if(!g)throw Error("Grup tidak ditemukan");const out=await call("wms_po_import_group",{p_vendor_raw:g.vendor,p_source_date:g.date,p_vendor_id:vendorId,p_po_number:poNumber.trim()}) as {po_id:string;lines:number;unmapped:number};setSelected(out.po_id);setTab("po");setGroupKey("");setMessage(`${out.lines} baris, ${out.unmapped} belum mapping.`);})}>Buat PO Draft</button></div>
            </div>}
          </section> : <>
            <section className="space-y-3 rounded-xl border bg-white p-4">
              <details><summary className="cursor-pointer text-base font-bold text-slate-900">+ Buat PO Baru (Draft)</summary><div className="mt-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-5">
                <div className="flex min-h-[42px] items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-sm font-medium text-slate-700" title="Nomor asli dialokasikan secara atomik oleh Supabase saat Draft dibuat">Nomor PO otomatis</div>
                <select className={inp} value={vendorId} onChange={e=>setVendorId(e.target.value)}><option value="">Pilih vendor</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_name}</option>)}</select>
                <input className={inp} aria-label="Tanggal PO" type="date" value={poDate} onChange={e=>setPoDate(e.target.value)}/>
                <input className={inp} aria-label="Estimasi tiba PO" type="date" value={poEta} onChange={e=>setPoEta(e.target.value)}/>
                <button className={btn} disabled={busy||!vendorId||!poDate} onClick={()=>void run("Buat PO Draft otomatis",async()=>{const id=await call("wms_po_create_auto",{p_vendor_id:vendorId,p_order_date:poDate,p_eta_date:poEta||null,p_notes:null});setSelected(String(id));})}>Buat Draft</button>
              </div>
              <p className="text-xs text-slate-500">Nomor akan dibuat setelah klik Buat Draft, contoh PO-20261101-001. Nomor unik per tanggal, tidak dipakai ulang. PO historis tetap memakai nomor lama.</p>
            </div></details></section>
<section className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-lg font-bold text-slate-900">Daftar Purchase Order</h2>
                  <p className="text-sm text-slate-500">{money(filteredPo.length)} PO ditemukan. Klik Lihat Detail untuk membuka satu pesanan.</p></div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600"><span>Final dipesan: <b>{money(sumOrdered)} pcs</b></span></div>
              </div>
              <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
                <input className={inp} aria-label="Cari nomor PO atau vendor" placeholder="Cari nomor PO / nama vendor..." value={poSearch} onChange={e=>{setPoSearch(e.target.value);setPoPage(1);}} />
                <select className={inp} aria-label="Filter status PO" value={poStatusFilter} onChange={e=>{setPoStatusFilter(e.target.value);setPoPage(1);}}>
                  <option value="ALL">Semua Status</option><option value="FINAL">Final</option><option value="DRAFT">Draft</option><option value="CLOSED">Selesai</option><option value="CANCELLED">Dibatalkan</option>
                </select>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[740px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600"><tr>
                    <th className="px-4 py-3">No. PO / Tanggal</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Belum Datang</th><th className="px-4 py-3 text-right">Detail</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                  {visiblePo.map(o=>{
                    const remaining=lines.filter(l=>l.po_id===o.id).reduce((a,l)=>a+l.remaining_qty,0);
                    return <tr key={o.id} className={selected===o.id?"bg-blue-50":"hover:bg-slate-50"}>
                      <td className="px-4 py-3"><div className="font-bold text-slate-900">{o.po_number}</div><div className="mt-0.5 text-xs text-slate-500">{o.order_date}</div></td>
                      <td className="px-4 py-3 font-medium text-slate-700">{poVendorName(o.vendor_id)}</td>
                      <td className="px-4 py-3"><span className={o.status==="FINAL"?"rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800":o.status==="DRAFT"?"rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800":"rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600"}>{display(o.status)}</span></td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(remaining)} pcs</td>
                      <td className="px-4 py-3 text-right"><button type="button" className={soft} onClick={()=>selectPoAndScroll(o.id)} aria-label={"Lihat detail PO "+o.po_number}>Lihat Detail</button></td>
                    </tr>;
                  })}
                  {visiblePo.length===0&&<tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">PO tidak ditemukan. Coba ubah filter atau kata pencarian.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
                <span>Halaman {poPageSafe} dari {poPageCount}  |  {filteredPo.length} PO</span>
                <div className="flex gap-2"><button className={soft} disabled={poPageSafe<=1} onClick={()=>setPoPage(p=>Math.max(1,p-1))}>Sebelumnya</button><button className={soft} disabled={poPageSafe>=poPageCount} onClick={()=>setPoPage(p=>Math.min(poPageCount,p+1))}>Berikutnya</button></div>
              </div>
            </section>
            {selectedOrder && <section id="po-detail" className="min-w-0 scroll-mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">{selectedOrder.po_number}</h2><p className="text-sm text-slate-500">{display(selectedOrder.status)} · Estimasi: {selectedOrder.eta_date||"belum ditetapkan"}</p></div><div className="flex flex-wrap items-start gap-2"><details className="rounded-xl border border-slate-200 p-2"><summary className="cursor-pointer px-2 text-sm font-semibold text-slate-700">Tindakan Admin</summary><div className="mt-3 flex flex-wrap gap-2">{selectedOrder.status==="DRAFT" && owner && <button disabled={busy} className={btn} onClick={()=>{if(window.confirm("Finalkan PO ini? Setelah Final, qty dan mapping tidak dapat diubah."))void run("Finalisasi PO",async()=>{await call("wms_po_finalize",{p_po_id:selected});});}}>Finalkan PO (Owner/Admin)</button>}{selectedOrder.status==="FINAL"&&owner&&<button className={soft} disabled={busy} onClick={()=>{if(window.confirm("Tutup PO hanya jika semua qty sudah diterima atau dibatalkan?"))void run("Tutup PO",async()=>{await call("wms_po_close",{p_po_id:selected});});}}>Tutup PO</button>}{owner&&(selectedOrder.status==="DRAFT"||selectedOrder.status==="FINAL")&&<button className={soft} disabled={busy} onClick={()=>{if(window.confirm("Batalkan seluruh PO? Tidak ada stok yang akan diubah."))void run("Batalkan PO",async()=>{await call("wms_po_cancel_order",{p_po_id:selected});});}}>Batalkan PO</button>}</div></details></div></div>
<div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                <b>Vendor:</b> {poVendorName(selectedOrder.vendor_id)} <span className="mx-2 text-slate-300">|</span> <b>Tanggal:</b> {selectedOrder.order_date}
                <span className="mx-2 text-slate-300">|</span><b>ETA:</b> {selectedOrder.eta_date||"Belum ditetapkan"}
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[["Item SKU",selectedLines.length],["Qty Dipesan",selectedOrdered],["Diterima",selectedReceived],["Belum Datang",selectedRemaining]].map(([label,value])=><div key={String(label)} className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{money(Number(value))}</p></div>)}
              </div>

              {selectedEtaMode==="auto"&&<p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">ETA dihitung otomatis dari snapshot lead time per SKU-vendor saat PO dibuat. ETA PO mengikuti tanggal item yang paling akhir.</p>}
              {selectedEtaMode==="manual"&&<p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">PO lama atau PO manual: tanggal yang tersimpan tetap berlaku. Tidak dihitung ulang otomatis.</p>}
              {selectedEtaMode==="unknown"&&<p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Sumber PO belum dapat diverifikasi. Perubahan ETA ditahan sampai Admin memeriksa data.</p>}
              {/* HIPRIMA_PO_SIMPLE_DOCS_V43I: satu tempat untuk preview dan unduh dokumen */}
              {selectedOrder.status==="FINAL"&&<section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-3 md:p-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Dokumen PO</h3>
                  <p className="text-xs text-slate-500">Pilih jenis dokumen. Semua SKU dalam PO akan ikut di PDF dan Excel.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">Rincian Qty</p>
                      <p className="text-xs text-slate-600">Tanpa harga. Untuk daftar barang dan jumlah produksi.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={soft} aria-label="Preview rincian Qty" onClick={()=>{setShowPoPreview(v=>!v);setVerifiedPo(null);setVerifiedPoMessage("");}}>{showPoPreview?"Tutup Preview":"Preview"}</button>
                      <button type="button" className={soft} aria-label="Download PDF rincian Qty" onClick={()=>void downloadPoQuantityPdf()}>PDF</button>
                      <button type="button" className={soft} aria-label="Download Excel rincian Qty" onClick={()=>void downloadPoQuantityExcel()}>Excel</button>
                    </div>
                  </div>
                  {showPoPreview&&<div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div><p className="font-bold text-slate-900">Hi.PRIMA Â· Rincian Qty</p><p className="text-xs text-slate-500">PO {selectedOrder.po_number} Â· {poVendorName(selectedOrder.vendor_id)}</p></div>
                      <span className="text-sm font-semibold text-slate-800">{money(selectedOrdered)} pcs</span>
                    </div>
                    <div className="max-h-[350px] overflow-auto rounded-lg border border-slate-200">
                      <table className="min-w-[430px] w-full text-left text-sm">
                        <thead className="sticky top-0 bg-slate-100 text-slate-700"><tr><th className="p-2">SKU</th><th className="p-2">Produk</th><th className="p-2 text-right">Qty</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{selectedLines.map(l=><tr key={l.id}><td className="p-2 font-medium">{l.source_sku}</td><td className="p-2">{l.source_product_name||"-"}</td><td className="p-2 text-right">{money(l.ordered_qty)}</td></tr>)}</tbody>
                      </table>
                    </div>
                    <p className="text-xs text-amber-800">Tanpa harga vendor. Bukan dokumen kesepakatan harga.</p>
                  </div>}
                </div>
                {owner&&<div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">PO Vendor</p>
                      <p className="text-xs text-slate-600">Dengan harga disetujui. Harga HPP otomatis; perubahan perlu verifikasi. Approval dan ETA wajib.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={soft} disabled={verifiedPoBusy} aria-label="Preview PO Vendor" onClick={()=>{setShowPoPreview(false);void showOfficialPoPreview();}}>{verifiedPoBusy?"Memeriksa...":"Preview"}</button>
                      <button type="button" className={soft} disabled={verifiedPoBusy||verifiedPo?.poId!==selectedOrder.id} aria-label="Download PDF PO Vendor" onClick={()=>void exportOfficialPo("pdf")}>PDF</button>
                      <button type="button" className={soft} disabled={verifiedPoBusy||verifiedPo?.poId!==selectedOrder.id} aria-label="Download Excel PO Vendor" onClick={()=>void exportOfficialPo("xlsx")}>Excel</button>
                    </div>
                  </div>
                  {verifiedPoMessage&&<p role="status" className={"mt-3 rounded-lg px-3 py-2 text-sm "+(verifiedPoMessage.startsWith("VERIFIED")||verifiedPoMessage.startsWith("DOWNLOAD")?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900")}>{verifiedPoMessage}</p>}
                  {verifiedPo?.poId===selectedOrder.id&&<div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap justify-between gap-2 text-sm"><span><b>PO {verifiedPo.number}</b> Â· {verifiedPo.vendor}</span><span>ETA {verifiedPo.eta} Â· Disetujui {verifiedPo.approverRole}</span></div>
                    <div className="mt-3 max-h-[350px] overflow-auto rounded-lg border border-slate-200">
                      <table className="min-w-[690px] w-full text-left text-sm"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">SKU</th><th className="p-2">Produk</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Harga Vendor</th><th className="p-2 text-right">Subtotal</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">{verifiedPo.lines.map(l=><tr key={l.id}><td className="p-2 font-medium">{l.sku}</td><td className="p-2">{l.product}</td><td className="p-2 text-right">{money(l.qty)}</td><td className="p-2 text-right">Rp {officialAmount(l.price)}</td><td className="p-2 text-right">Rp {officialAmount(l.subtotal)}</td></tr>)}</tbody>
                      <tfoot className="bg-slate-50 font-bold"><tr><td colSpan={2} className="p-3">TOTAL</td><td className="p-3 text-right">{money(verifiedPo.totalQty)}</td><td></td><td className="p-3 text-right">Rp {officialAmount(verifiedPo.totalAmount)}</td></tr></tfoot></table>
                    </div>
                  </div>}
                </div>}
              </section>}
              {selectedOrder.status==="DRAFT"&&<div className="space-y-2 rounded-lg bg-slate-50 p-3"><b className="text-sm">Tambah SKU ke PO</b><div className="grid min-w-0 gap-2 md:grid-cols-5"><input className={inp} value={sku} onChange={e=>{setSku(e.target.value);setSkuSearchMessage("");}} placeholder="Cari SKU master"/><button className={soft} onClick={()=>void lookupSku()}>Cari SKU</button><select className={inp} value={variantId} onChange={e=>setVariantId(e.target.value)}><option value="">Pilih hasil</option>{variantMatches.map(v=><option value={v.id} key={v.id}>{v.sku} {v.color||""} {v.size||""}</option>)}</select><input className={inp} type="number" min="1" placeholder="Qty PO" value={qty} onChange={e=>setQty(e.target.value)}/><button className={btn} disabled={busy||!variantId||!(Number(qty)>0)} onClick={()=>void run("Tambah SKU",async()=>{await call("wms_po_add_line",{p_po_id:selected,p_variant_id:variantId,p_qty:Number(qty)});setQty("");setSku("");setVariantId("");setVariantMatches([]);setSkuSearchMessage("");})}>Tambah</button></div>{skuSearchMessage&&<p role="status" className="text-xs text-slate-600">{skuSearchMessage}</p>}</div>}

              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><h3 className="font-bold text-slate-900">Detail SKU per Produk</h3>
                    <p className="text-xs text-slate-500">{filteredPoLines.length} dari {selectedLines.length} SKU ditampilkan. Urut berdasarkan nama produk.</p></div>
                  <button type="button" className={soft} onClick={()=>{setPoSkuQuery("");setPoProductFilter("ALL");setPoSkuPage(1);}}>Reset Filter</button>
                </div>
                <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(190px,320px)]">
                  <input className={inp} aria-label="Cari SKU pada PO ini" placeholder="Cari SKU, produk, atau status..." value={poSkuQuery} onChange={e=>{setPoSkuQuery(e.target.value);setPoSkuPage(1);}} />
                  <select className={inp} aria-label="Filter kelompok produk" value={poProductFilter} onChange={e=>{setPoProductFilter(e.target.value);setPoSkuPage(1);}}>
                    <option value="ALL">Semua Produk ({selectedLines.length} SKU)</option>
                    {poProducts.map(name=><option key={name} value={name}>{name} ({selectedLines.filter(l=>poProductName(l)===name).length} SKU)</option>)}
                  </select>
                </div>
              </div>

<div className="overflow-x-auto"><table className="w-full min-w-[940px] text-left text-sm"><thead><tr className="border-b bg-slate-50 text-xs font-semibold text-slate-700"><th className="p-2">SKU / Produk</th><th className="p-2">Qty PO</th><th className="p-2">Diterima</th><th className="p-2">Belum Datang</th><th className="p-2">Progres Vendor</th><th className="p-2">Status</th><th className="p-2">Tindakan</th></tr></thead><tbody>{visiblePoLines.length===0&&<tr><td colSpan={7} className="p-6 text-center text-sm text-slate-500">SKU tidak ditemukan. Coba ubah pencarian atau filter produk.</td></tr>}{visiblePoLines.map(l=><tr key={l.id} className="border-b border-slate-100 align-top hover:bg-slate-50"><td className="p-2"><b>{l.source_sku}</b><p className="text-xs text-slate-500">{l.source_product_name}</p>{l.verified_vendor_lifecycle&&<p className="text-xs font-semibold text-slate-600">Lifecycle Produk: {lifecycleLabel(l.verified_vendor_lifecycle)}</p>}{!l.variant_id&&<span className="text-xs font-bold text-red-700">Belum mapping Master</span>}</td><td className="p-2">{l.ordered_qty}</td><td className="p-2">{l.received_qty}</td><td className="p-2 font-bold">{l.remaining_qty}</td><td className="p-2">{display(l.progress)}</td><td className="p-2">{display(l.tracking_status)}</td><td className="p-2"><details className="rounded-lg border border-slate-200 bg-white"><summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-800">Kelola Item</summary><div className="flex min-w-[220px] flex-col items-start gap-2 border-t border-slate-100 p-3">
                <select className={soft} disabled={busy||!['DRAFT','FINAL'].includes(l.po_status)} value={l.progress} onChange={e=>void run("Update progres",async()=>{await call("wms_po_set_progress",{p_line_id:l.id,p_progress:e.target.value,p_eta_date:null});})}><option value="UNCONFIRMED">Belum Dikonfirmasi</option><option value="IN_PRODUCTION">Dalam Produksi</option><option value="READY_AT_VENDOR">Ready at Vendor</option><option value="IN_TRANSIT">Dalam Pengiriman</option></select>
                {l.po_status==="DRAFT" && <button className={soft} disabled={busy} onClick={()=>{const value=window.prompt("Qty PO untuk "+l.source_sku+" (angka positif):",String(l.ordered_qty));if(value!==null && Number.isInteger(Number(value)) && Number(value)>0)void run("Update Qty PO",async()=>{await call("wms_po_set_draft_qty",{p_line_id:l.id,p_qty:Number(value)});});}}>Ubah Qty PO</button>}
                {owner && (l.po_status==="DRAFT"||l.po_status==="FINAL")&&<button className={soft} disabled={busy} onClick={()=>{const value=window.prompt("Total qty DIBATALKAN (bukan tambahan), maksimum "+(l.ordered_qty-l.received_qty)+" pcs:",String(l.cancelled_qty));if(value!==null && Number.isInteger(Number(value)) && Number(value)>=0)void run("Update pembatalan",async()=>{await call("wms_po_cancel_qty",{p_line_id:l.id,p_cancel_qty:Number(value)});});}}>Qty Batal</button>}
                {(l.po_status==="DRAFT"||l.po_status==="FINAL")&&(
                  selectedEtaMode==="auto"
                    ? <span className="text-xs font-semibold text-emerald-700">{l.eta_date?"ETA otomatis: "+l.eta_date:"ETA belum tercatat - periksa data lead time"}</span>
                    : selectedEtaMode==="manual"
                      ? <span className="inline-flex flex-wrap items-center gap-2 align-middle">
                  <label className="text-xs text-slate-600" htmlFor={`po-eta-${l.id}`}>ETA</label>
                  <input id={`po-eta-${l.id}`} aria-label={`Tanggal estimasi tiba untuk ${l.source_sku}`} title="Klik untuk memilih tanggal kedatangan" type="date" className={soft+" min-w-[158px] max-w-[190px]"} value={etaDraft[l.id]??l.eta_date??""}
                    onChange={e=>setEtaDraft(d=>({...d,[l.id]:e.target.value}))}
                    onClick={e=>{try{e.currentTarget.showPicker?.();}catch{}}}/>
                  <button className={soft} disabled={busy||!etaDraft[l.id]||etaDraft[l.id]===l.eta_date} onClick={()=>{const date=etaDraft[l.id];if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)){setError("Pilih tanggal estimasi dari kalender.");return;}void run("Simpan ETA",async()=>{await call("wms_po_set_progress",{p_line_id:l.id,p_progress:l.progress,p_eta_date:date});setEtaDraft(d=>{const next={...d};delete next[l.id];return next;});});}}>Simpan ETA</button>
                </span>
                      : <span className="text-xs text-amber-800">ETA menunggu pemeriksaan sumber PO</span>
                )}
                {l.po_status==="DRAFT" && !l.variant_id&&<button className={soft} onClick={()=>{setMapLineId(l.id);setSku(l.source_sku);setTab("po");}}>Mapping SKU</button>}
                {l.po_status==="DRAFT"&&owner&&l.verified_vendor_lifecycle==="Seasonal"&&(l.seasonal_approved_at?<span className="text-xs font-semibold text-emerald-700">Seasonal disetujui</span>:<button className={soft} disabled={busy} onClick={()=>void run("Approval Seasonal",async()=>{await call("wms_po_approve_seasonal",{p_line_id:l.id});})}>Approval Seasonal</button>)}
                {l.po_status==="FINAL"&&l.variant_id&&<button className={soft} disabled={busy} onClick={()=>void run("Cari Inbound",async()=>{const a=await call("wms_po_inbound_candidates",{p_line_id:l.id});setCandidates(x=>({...x,[l.id]:(a||[]) as Candidate[]}));})}>Cari Inbound</button>}
                {candidates[l.id] && <div className="flex gap-2"><select className={soft} value={receiptChoice[l.id]||""} onChange={e=>setReceiptChoice(x=>({...x,[l.id]:e.target.value}))}><option value="">Pilih inbound diposting</option>{candidates[l.id].map(c=><option key={c.movement_id} value={c.movement_id}>#{c.movement_no} · {c.quantity} pcs</option>)}</select><button className={btn} disabled={busy||!receiptChoice[l.id]} onClick={()=>void run("Tautkan inbound",async()=>{await call("wms_po_link_inbound",{p_line_id:l.id,p_movement_id:receiptChoice[l.id]});setCandidates(x=>{const next={...x};delete next[l.id];return next;});})}>Tautkan</button></div>}
              </div></details></td></tr>)}</tbody></table></div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                <span>Menampilkan {visiblePoLines.length===0?0:(skuPageSafe-1)*skuPageSize+1} - {Math.min(skuPageSafe*skuPageSize,filteredPoLines.length)} dari {filteredPoLines.length} SKU | Halaman {skuPageSafe}/{skuPageCount}</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={soft} disabled={skuPageSafe<=1} onClick={()=>setPoSkuPage(p=>Math.max(1,p-1))}>Sebelumnya</button>
                  <button type="button" className={soft} disabled={skuPageSafe>=skuPageCount} onClick={()=>setPoSkuPage(p=>Math.min(skuPageCount,p+1))}>Berikutnya</button>
                </div>
              </div>
              {mapLineId && selectedLines.some(l=>l.id===mapLineId) && <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3"><b>Mapping SKU ke Master</b><div className="flex min-w-0 flex-wrap gap-2"><input className="min-w-[180px] max-w-full flex-1 rounded-lg border p-2" value={sku} onChange={e=>{setSku(e.target.value);setSkuSearchMessage("");}}/><button className={soft} onClick={()=>void lookupSku()}>Cari Master SKU</button><select className={soft} value={variantId} onChange={e=>setVariantId(e.target.value)}><option value="">Pilih SKU valid</option>{variantMatches.map(v=><option key={v.id} value={v.id}>{v.sku} {v.color||""} {v.size||""}</option>)}</select><button className={btn} disabled={!variantId||busy} onClick={()=>void run("Simpan mapping",async()=>{await call("wms_po_map_line",{p_line_id:mapLineId,p_variant_id:variantId});setMapLineId("");setVariantId("");setSku("");setVariantMatches([]);setSkuSearchMessage("");})}>Simpan</button><button className={soft} onClick={()=>setMapLineId("")}>Batal</button></div>{skuSearchMessage&&<p role="status" className="text-xs text-slate-600">{skuSearchMessage}</p>}</div>}
              <p className="text-xs text-slate-500">Saat barang tiba: posting di Inbound WMS dengan <b>Referensi = {selectedOrder.po_number}</b> dan SKU yang sesuai; setelah itu klik Cari Inbound → Tautkan. Stok hanya bertambah sekali, dari transaksi Inbound.</p>
            </section>}
          </>}
        </>}
      </div>
  </main>;
}
