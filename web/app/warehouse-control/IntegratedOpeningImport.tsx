"use client";

import { useState } from "react";
import type { Workbook, Worksheet, Cell } from "exceljs";

type Product = {
  product_code: string;
  name: string;
  brand: string;
  category?: string | null;
  product_type: string;
};

type Variant = {
  sku: string;
  product_code: string;
  color: string;
  size: string;
  barcode?: string | null;
  hpp: number | null;
  selling_price: number | null;
  price_reason?: string | null;
};

type Rack = {
  warehouse: string;
  area: string;
  rack: string;
  name: string;
};

type Stock = {
  sku: string;
  warehouse: string;
  rack: string;
  qty: number;
};

type MasterExport = {
  products: Product[];
  variants: Variant[];
  categories: string[];
  product_types: string[];
  valuation: Record<string, number>;
};

type PriceChange = {
  sku: string;
  old_hpp: number | null;
  new_hpp: number;
  old_selling_price: number;
  new_selling_price: number;
  reason: string;
};

type MasterSummary = {
  mode: string;
  products_new: number;
  products_updated: number;
  products_archived: number;
  products_reactivated: number;
  sku_new: number;
  sku_updated: number;
  sku_archived: number;
  sku_reactivated: number;
  active_products_total: number;
  active_sku_total: number;
  hpp_changed: number;
  selling_price_changed: number;
  price_changes: PriceChange[];
};

type Preview = {
  master: MasterSummary;
  opening: {
    old_total: number;
    new_total: number;
    new_racks: number;
    new_rows: number;
    new_skus: number;
    summary: {
      warehouse: string;
      area: string;
      racks: number;
      qty: number;
    }[];
  };
  old_valuation: Record<string, number>;
  new_valuation: Record<string, number>;
  warnings: Record<string, number>;
};

export type IntegratedBatch = {
  batch_id: string;
  status: "DRAFT" | "APPLIED";
  preview: Preview;
  created_at?: string;
  applied_at?: string;
};

type Props = {
  owner: boolean;
  prep: boolean;
  busy: boolean;
  openOpnames: number;
  inTransit: number;
  batch: IntegratedBatch | null;
  setBatch: (batch: IntegratedBatch) => void;
  rpc: (
    name: string,
    params?: Record<string, unknown>
  ) => Promise<unknown>;
  run: (task: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
};

// Enable only after final release approval.
const APPLY_ENABLED: boolean = false;

const panel =
  "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 md:p-5";

const button =
  "shrink-0 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40";

const secondary =
  "shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium disabled:opacity-40";

const field =
  "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";

const fmt = (v: number | null | undefined) =>
  v == null ? "-" : Number(v).toLocaleString("id-ID");

const money = (v: number | null | undefined) =>
  v == null ? "-" : "Rp" + fmt(v);

const productHeaders = [
  "Product Code",
  "Product Name",
  "Brand",
  "Kategori",
  "Product Type"
];

const variantHeaders = [
  "SKU",
  "Product Code",
  "Warna",
  "Size",
  "Barcode",
  "HPP",
  "Harga Jual",
  "Alasan Harga"
];

const rackHeaders = [
  "Gudang","Area","Kode Rak","Nama Rak"
];

const stockHeaders = [
  "SKU","Gudang","Kode Rak","Qty"
];

function setupSheet(
  wb: Workbook,
  name: string,
  headers: string[],
  widths: number[]
) {
  const ws = wb.addWorksheet(name);

  ws.columns = headers.map((header,i) => ({
    header,
    width: widths[i] ?? 22
  }));

  ws.getRow(1).height = 26;
  ws.getRow(1).font = {
    bold: true,
    color: { argb: "FFFFFFFF" }
  };

  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" }
  };

  ws.views = [{
    state: "frozen",
    ySplit: 1
  }];

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  return ws;
}

function textColumns(ws: Worksheet, columns: number[]) {
  for (const n of columns) {
    ws.getColumn(n).numFmt = "@";
  }
}

async function saveWorkbook(wb: Workbook, name: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer as ArrayBuffer);

  const url = URL.createObjectURL(new Blob(
    [bytes],
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  ));

  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url),1000);
}

function required(value: string, label: string) {
  if (!value.trim()) throw Error(label + " wajib diisi.");
  return value.trim();
}

function readText(cell: Cell, label: string) {
  if (cell.formula) {
    throw Error(label + ": rumus tidak diperbolehkan.");
  }

  if (cell.value == null) return "";

  if (
    typeof cell.value !== "string" &&
    typeof cell.value !== "number"
  ) {
    throw Error(label + ": format sel tidak valid.");
  }

  return String(cell.value).trim();
}

function identity(cell: Cell, label: string) {
  const value = readText(cell,label);

  if (value && typeof cell.value !== "string") {
    throw Error(
      label + ": gunakan format Text untuk menjaga kode dan angka nol di depan."
    );
  }

  return value;
}

function readNumber(
  cell: Cell,
  label: string,
  integer: boolean,
  max: number
) {
  const raw = readText(cell,label);

  if (!raw) {
    throw Error(label + " wajib diisi.");
  }

  if (
    typeof cell.value !== "number" &&
    !/^\d+(?:\.\d+)?$/.test(raw)
  ) {
    throw Error(
      label + ": masukkan angka tanpa simbol atau pemisah ribuan."
    );
  }

  const value = Number(raw);

  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw Error(label + ": angka tidak valid.");
  }

  return value;
}

function sheetRows(
  wb: Workbook,
  name: string,
  headers: string[],
  limit: number
) {
  const ws = wb.getWorksheet(name);

  if (!ws) throw Error("Sheet tidak ditemukan: " + name);

  const header = ws.getRow(1);

  for (let i=0; i<headers.length; i++) {
    if (header.getCell(i+1).text.trim() !== headers[i]) {
      throw Error(
        name + ": header kolom " + (i+1) +
        " harus " + headers[i]
      );
    }
  }

  const rows: {
    cells: Cell[];
    label: string;
  }[] = [];

  ws.eachRow((row,index) => {
    if (index === 1) return;

    const cells = headers.map((_,i) =>
      row.getCell(i+1)
    );

    row.eachCell(cell => {
      if (Number(cell.col) > headers.length &&
          cell.value != null && cell.text.trim()) {
        throw Error(
          name + " baris " + index +
          ": terdapat data di luar kolom template."
        );
      }
    });

    if (!cells.some(c => c.value != null &&
        (c.formula || c.text.trim()))) return;

    const label = name + " baris " + index;

    for (const cell of cells) {
      if (cell.formula) {
        throw Error(label + ": rumus tidak diperbolehkan.");
      }
    }

    rows.push({ cells,label });

    if (rows.length > limit) {
      throw Error(name + ": jumlah baris melebihi batas.");
    }
  });

  if (!rows.length) {
    throw Error(name + " masih kosong.");
  }

  return rows;
}

function unique(values: string[], label: string) {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      throw Error(label + " duplikat: " + value);
    }

    seen.add(value);
  }
}

async function parseWorkbook(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx") ||
      file.size > 10*1024*1024) {
    throw Error("Gunakan file XLSX maksimal 10 MB.");
  }

  const { Workbook } = await import("exceljs");
  const wb = new Workbook();

  await wb.xlsx.load(await file.arrayBuffer());

  const products: Product[] = sheetRows(
    wb,"Master Product",productHeaders,10000
  ).map(({cells:c,label:l}) => ({
    product_code: required(identity(c[0],l),l+" Product Code"),
    name: required(readText(c[1],l),l+" Product Name"),
    brand: required(readText(c[2],l),l+" Brand"),
    category: readText(c[3],l),
    product_type: required(readText(c[4],l),l+" Product Type")
  }));

  const variants: Variant[] = sheetRows(
    wb,"Master SKU & Pricing",variantHeaders,20000
  ).map(({cells:c,label:l}) => {
    const sku = required(identity(c[0],l),l+" SKU");

    return {
      sku,
      product_code: required(
        identity(c[1],l),l+" Product Code"
      ),
      color: required(readText(c[2],l),l+" Warna"),
      size: required(readText(c[3],l),l+" Size"),
      barcode: identity(c[4],l) || sku,
      hpp: readNumber(c[5],l+" HPP",false,999999999999),
      selling_price: readNumber(
        c[6],l+" Harga Jual",false,999999999999
      ),
      price_reason: readText(c[7],l)
    };
  });

  const racks: Rack[] = sheetRows(
    wb,"Master Rak",rackHeaders,5000
  ).map(({cells:c,label:l}) => ({
    warehouse: required(readText(c[0],l),l+" Gudang")
      .toUpperCase(),
    area: required(readText(c[1],l),l+" Area")
      .toUpperCase(),
    rack: required(identity(c[2],l),l+" Kode Rak")
      .toUpperCase(),
    name: readText(c[3],l)
  }));

  const stock: Stock[] = sheetRows(
    wb,"Opening Stock",stockHeaders,25000
  ).map(({cells:c,label:l}) => ({
    sku: required(identity(c[0],l),l+" SKU"),
    warehouse: required(readText(c[1],l),l+" Gudang")
      .toUpperCase(),
    rack: required(identity(c[2],l),l+" Kode Rak")
      .toUpperCase(),
    qty: readNumber(c[3],l+" Qty",true,999999999)
  }));

  unique(
    products.map(p => p.product_code.toLowerCase()),
    "Product Code"
  );

  unique(
    variants.map(v => v.sku.toLowerCase()),
    "SKU"
  );

  unique(
    variants.map(v => v.barcode ?? v.sku),
    "Barcode"
  );

  unique(
    racks.map(r => r.warehouse+"/"+r.rack),
    "Kode Rak"
  );

  unique(
    stock.map(s => JSON.stringify([s.sku,s.warehouse,s.rack])),
    "SKU/Rak"
  );

  const productCodes = new Set(
    products.map(p => p.product_code)
  );

  const skuMap = new Map(
    variants.map(v => [v.sku,v])
  );

  const rackMap = new Map(
    racks.map(r => [r.warehouse+"/"+r.rack,r])
  );

  const usedProducts = new Set<string>();

  for (const v of variants) {
    if (!productCodes.has(v.product_code)) {
      throw Error("Product Code tidak terdaftar: "+v.sku);
    }

    usedProducts.add(v.product_code);
  }

  for (const p of products) {
    if (!usedProducts.has(p.product_code)) {
      throw Error("Produk tidak memiliki SKU: "+p.product_code);
    }
  }

  for (const r of racks) {
    if (!["UTAMA","STORE"].includes(r.warehouse) ||
        !["NORMAL","DEFECT","REJECT"].includes(r.area) ||
        !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(r.rack)) {
      throw Error("Format rak tidak valid: "+r.rack);
    }
  }

  for (const w of ["UTAMA","STORE"]) {
    for (const a of ["NORMAL","DEFECT","REJECT"]) {
      if (!racks.some(r => r.warehouse===w && r.area===a)) {
        throw Error("Master Rak belum mencakup "+w+" / "+a);
      }
    }
  }

  for (const s of stock) {
    const v = skuMap.get(s.sku);
    const rack = rackMap.get(s.warehouse+"/"+s.rack);

    if (!v) {
      throw Error("SKU di luar master baru: "+s.sku);
    }

    if (!rack) {
      throw Error("Rak tidak terdaftar: "+s.warehouse+"/"+s.rack);
    }

    if (s.qty>0 && Number(v.hpp)<=0) {
      throw Error("HPP wajib positif untuk SKU berstok: "+s.sku);
    }

    if (
      s.qty>0 &&
      rack.area==="NORMAL" &&
      v.selling_price===0 &&
      !v.price_reason
    ) {
      throw Error("Harga jual Rp0 membutuhkan alasan: "+s.sku);
    }
  }

  if (!stock.some(s => s.qty>0)) {
    throw Error("Opening Stock tidak boleh kosong total.");
  }

  return {
    p_products: products,
    p_variants: variants,
    p_racks: racks,
    p_stock: stock
  };
}

export default function IntegratedOpeningImport({
  owner,prep,busy,openOpnames,inTransit,
  batch,setBatch,rpc,run,refresh
}: Props) {
  const [file,setFile] = useState<File | null>(null);
  const [dirty,setDirty] = useState(false);
  const [confirmation,setConfirmation] = useState("");
  const [reviewed,setReviewed] = useState("");
  const [notice,setNotice] = useState("");
  const [search,setSearch] = useState("");
  const [page,setPage] = useState(0);

  const preview = batch?.preview;
  const master = preview?.master;

  async function downloadTemplate(prefilled: boolean) {
    await run(async () => {
      setNotice("");

      const data = await rpc(
        "wms_v462_export_master"
      ) as MasterExport;

      const { Workbook } = await import("exceljs");
      const wb = new Workbook();

      const p = setupSheet(
        wb,"Master Product",productHeaders,
        [24,40,22,26,24]
      );

      const v = setupSheet(
        wb,"Master SKU & Pricing",variantHeaders,
        [38,24,24,16,30,20,20,45]
      );

      const r = setupSheet(
        wb,"Master Rak",rackHeaders,
        [18,18,25,40]
      );

      const s = setupSheet(
        wb,"Opening Stock",stockHeaders,
        [38,18,25,18]
      );

      textColumns(p,[1,2,3,4,5]);
      textColumns(v,[1,2,3,4,5,8]);
      textColumns(r,[1,2,3,4]);
      textColumns(s,[1,2,3]);

      v.getColumn(6).numFmt = "#,##0.##";
      v.getColumn(7).numFmt = "#,##0.##";
      s.getColumn(4).numFmt = "0";

      if (prefilled) {
        for (const item of data.products) {
          p.addRow([
            item.product_code,item.name,item.brand,
            item.category ?? "",item.product_type
          ]);
        }

        for (const item of data.variants) {
          const row = v.addRow([
            item.sku,item.product_code,item.color,item.size,
            item.barcode ?? "",
            item.hpp == null ? null : Number(item.hpp),
            item.selling_price == null
              ? null : Number(item.selling_price),
            ""
          ]);

          for (const col of [6,7]) {
            const cell = row.getCell(col);

            if (cell.value == null || Number(cell.value)<=0) {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: {argb:"FFFFE4B5"}
              };
            }
          }
        }
      }

      const guide = setupSheet(
        wb,"Petunjuk",["Panduan Full Replacement"],[105]
      );

      guide.addRows([
        ["Hi.PRIMA WMS V4.6.2"],
        ["File ini menjadi sumber master aktif yang baru."],
        ["Produk dan SKU yang tidak tercantum akan dinonaktifkan."],
        ["Histori lama dan UUID SKU yang cocok tetap disimpan."],
        ["Isi keempat sheet data. Jangan mengubah nama sheet atau header."],
        ["Product Code, SKU, Barcode dan Kode Rak harus berupa teks."],
        ["Kategori boleh kosong; kategori lama akan dilepas."],
        ["Barcode kosong otomatis menggunakan SKU."],
        ["HPP dan Harga Jual wajib berupa angka, termasuk angka 0 jika sesuai."],
        ["SKU dengan stok positif wajib mempunyai HPP lebih dari 0."],
        ["Harga jual 0 pada stok NORMAL membutuhkan alasan."],
        ["Harga jual di bawah HPP perlu direview Owner."],
        ["Gudang: UTAMA atau STORE."],
        ["Area: NORMAL, DEFECT atau REJECT."],
        ["Setiap gudang wajib memiliki ketiga area QC."],
        ["Kode rak wajib baru dan unik dalam satu gudang."],
        ["Gunakan kode rak huruf/angka, underscore atau tanda minus."],
        ["Satu kombinasi SKU + Gudang + Rak hanya satu baris."],
        ["Qty adalah bilangan bulat nonnegatif."],
        ["Rumus Excel tidak diperbolehkan pada sheet import."],
        ["Jika memakai template berisi data lama, hapus baris yang tidak dipertahankan."],
        ["Preview tidak mengganti stok atau master asli."],
        ["Import final hanya setelah persetujuan Owner."],
        ["Product Type yang tersedia:"],
        ...data.product_types.map(x => [x]),
        ["Kategori yang tersedia:"],
        ...data.categories.map(x => [x])
      ]);

      const rec = setupSheet(
        wb,"Reconciliation",
        ["Parameter","Data Lama"],[48,27]
      );

      rec.addRows([
        ["Master Product - seluruh record",data.products.length],
        ["Master SKU - seluruh record",data.variants.length],
        ["Total Stok",data.valuation.total_qty],
        ["Normal",data.valuation.normal_qty],
        ["Defect",data.valuation.defect_qty],
        ["Reject",data.valuation.reject_qty],
        ["Total Inventory HPP",
          data.valuation.total_inventory_value_hpp],
        ["Potensi Penjualan",
          data.valuation.potential_sales_value],
        ["Potensi Gross Profit",
          data.valuation.potential_gross_profit]
      ]);

      rec.getColumn(2).numFmt = "#,##0.##";

      await saveWorkbook(
        wb,
        prefilled
          ? "HiPRIMA_Full_Replacement_Reference.xlsx"
          : "HiPRIMA_Full_Replacement_Blank.xlsx"
      );

      setNotice(
        "Template berhasil dibuat. " +
        "Sheet Reconciliation hanya referensi, bukan data import."
      );
    });
  }

  async function validate() {
    if (!file || !prep || busy) return;

    setDirty(true);
    setReviewed("");
    setConfirmation("");
    setNotice("");

    await run(async () => {
      const payload = await parseWorkbook(file);

      const result = await rpc(
        "wms_v462_preview",payload
      ) as IntegratedBatch;

      if (
        !result?.batch_id ||
        result.preview?.master?.mode !== "FULL_REPLACEMENT"
      ) {
        throw Error("Backend Full Replacement belum valid.");
      }

      setBatch(result);
      setDirty(false);
      setPage(0);
      setSearch("");

      setNotice(
        "Preview berhasil. Master dan stok asli belum berubah."
      );
    });
  }

  async function apply() {
    if (
      !APPLY_ENABLED || !owner || !prep || busy ||
      dirty || !batch || batch.status!=="DRAFT" ||
      reviewed!==batch.batch_id ||
      confirmation!=="GANTI MASTER DAN STOK" ||
      openOpnames>0 || inTransit>0
    ) return;

    await run(async () => {
      if (!window.confirm(
        "Ganti seluruh master aktif dan stok kedua gudang?"
      )) return;

      await rpc("wms_v462_apply",{
        p_batch_id: batch.batch_id,
        p_confirmation: confirmation
      });

      setConfirmation("");
      setReviewed("");
      setDirty(true);

      setNotice(
        "Import berhasil. WMS berstatus READY, belum LIVE."
      );

      await refresh();
    });
  }

  const filteredChanges = (master?.price_changes ?? [])
    .filter(c =>
      c.sku.toLowerCase().includes(search.toLowerCase())
    );

  const oldProducts = master
    ? master.active_products_total
      - master.products_new
      - master.products_reactivated
      + master.products_archived
    : 0;

  const oldSkus = master
    ? master.active_sku_total
      - master.sku_new
      - master.sku_reactivated
      + master.sku_archived
    : 0;

  return (
    <div className="min-w-0 space-y-4">

      <section className={panel}>
        <p className="text-xs font-semibold text-blue-700">
          V4.6.2 - FULL REPLACEMENT
        </p>

        <h2 className="mt-1 text-xl font-bold">
          Integrated Master & Opening Stock Import
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Satu file untuk mengganti seluruh master aktif,
          HPP, harga jual, rak dan stok kedua gudang.
          Histori lama tetap disimpan.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className={button}
            disabled={busy}
            onClick={() => void downloadTemplate(false)}>
            Download Template Kosong
          </button>

          <button className={secondary}
            disabled={busy}
            onClick={() => void downloadTemplate(true)}>
            Download Template + Master Lama
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Gunakan template kosong apabila data cleansing
          sudah disiapkan secara terpisah oleh tim.
        </p>
      </section>

      <section className={panel}>
        <h2 className="font-bold">Upload & Smart Validation</h2>

        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Produk dan SKU yang tidak tercantum dalam file
          akan dinonaktifkan. Seluruh saldo stok lama
          akan diganti, bukan ditambahkan.
        </div>

        <input
          type="file"
          accept=".xlsx"
          className={field+" mt-4"}
          disabled={!prep || busy}
          onChange={e => {
            setFile(e.target.files?.[0] ?? null);
            setDirty(true);
            setReviewed("");
            setConfirmation("");
            setNotice("");
          }}
        />

        <button
          className={button+" mt-3"}
          disabled={!prep || busy || !file}
          onClick={() => void validate()}>
          {busy ? "Memproses..." : "Validate & Preview"}
        </button>

        {notice && (
          <p className="mt-3 break-words text-sm text-green-700">
            {notice}
          </p>
        )}

        {dirty && batch && (
          <p className="mt-3 text-sm text-amber-700">
            Preview lama tidak berlaku untuk file yang baru dipilih.
          </p>
        )}
      </section>

      {preview && master && !dirty && (
        <>
          <section className={panel}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">
                Master Data Reconciliation
              </h2>

              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                {batch?.status}
              </span>
            </div>

            <p className="mt-2 break-all text-xs text-slate-500">
              Batch: {batch?.batch_id}
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-3">Master Data</th>
                    <th className="p-3 text-right">Lama</th>
                    <th className="p-3 text-right">Baru</th>
                  </tr>
                </thead>

                <tbody>
                  {[
                    ["Produk Aktif",oldProducts,master.active_products_total],
                    ["SKU Aktif",oldSkus,master.active_sku_total]
                  ].map(([label,old,next]) => (
                    <tr key={String(label)} className="border-b">
                      <td className="p-3">{label}</td>
                      <td className="p-3 text-right">
                        {fmt(Number(old))}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {fmt(Number(next))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Produk Baru",master.products_new],
                ["SKU Baru",master.sku_new],
                ["Produk Diarsipkan",master.products_archived],
                ["SKU Diarsipkan",master.sku_archived],
                ["Produk Diperbarui",master.products_updated],
                ["SKU Diperbarui",master.sku_updated],
                ["HPP Berubah",master.hpp_changed],
                ["Harga Jual Berubah",master.selling_price_changed]
              ].map(([label,value]) => (
                <div key={String(label)}
                  className="min-w-0 rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-600">{label}</p>
                  <p className="mt-1 text-2xl font-bold">
                    {fmt(Number(value))}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className={panel}>
            <h2 className="font-bold">Inventory Reconciliation</h2>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-3">Parameter</th>
                    <th className="p-3 text-right">Lama</th>
                    <th className="p-3 text-right">Baru</th>
                    <th className="p-3 text-right">Selisih</th>
                  </tr>
                </thead>

                <tbody>
                  {[
                    ["Total Qty","total_qty",false],
                    ["Normal Qty","normal_qty",false],
                    ["Defect Qty","defect_qty",false],
                    ["Reject Qty","reject_qty",false],
                    ["Total Inventory HPP","total_inventory_value_hpp",true],
                    ["Normal HPP","normal_inventory_value_hpp",true],
                    ["Defect HPP","defect_inventory_value_hpp",true],
                    ["Reject HPP","reject_inventory_value_hpp",true],
                    ["Potensi Penjualan","potential_sales_value",true],
                    ["Potensi Gross Profit","potential_gross_profit",true]
                  ].map(([label,key,isMoney]) => {
                    const old = Number(
                      preview.old_valuation[String(key)] ?? 0
                    );

                    const next = Number(
                      preview.new_valuation[String(key)] ?? 0
                    );

                    const show = isMoney ? money : fmt;

                    return (
                      <tr key={String(key)} className="border-b">
                        <td className="p-3">{label}</td>
                        <td className="p-3 text-right whitespace-nowrap">
                          {show(old)}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap font-semibold">
                          {show(next)}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          {show(next-old)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-sm text-slate-600">
              {fmt(preview.opening.new_racks)} rak /
              {" "}{fmt(preview.opening.new_skus)} SKU stok /
              {" "}{fmt(preview.opening.new_rows)} baris
            </p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="p-2">Gudang</th>
                    <th className="p-2">Area</th>
                    <th className="p-2 text-right">Rak</th>
                    <th className="p-2 text-right">Qty</th>
                  </tr>
                </thead>

                <tbody>
                  {preview.opening.summary.map(row => (
                    <tr key={row.warehouse+row.area}
                      className="border-b">
                      <td className="p-2">{row.warehouse}</td>
                      <td className="p-2">{row.area}</td>
                      <td className="p-2 text-right">{fmt(row.racks)}</td>
                      <td className="p-2 text-right">{fmt(row.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={panel}>
            <h2 className="font-bold">Pricing Review</h2>

            <div className="mt-3 space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <p>
                HPP nol/kosong seluruh master tersimpan:
                {" "}{fmt(preview.warnings.hpp_zero_or_null_total)} SKU
              </p>
              <p>
                Harga jual nol seluruh master tersimpan:
                {" "}{fmt(preview.warnings.selling_price_zero_total)} SKU
              </p>
              <p>
                Harga jual di bawah HPP seluruh master tersimpan:
                {" "}{fmt(preview.warnings.selling_price_below_hpp_total)} SKU
              </p>
              <p>
                SKU berstok baru dengan harga jual nol:
                {" "}{fmt(preview.warnings.sku_with_zero_selling_price_in_stock)}
              </p>
            </div>

            <input className={field+" mt-4"}
              placeholder="Cari SKU yang harganya berubah"
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    {[
                      "SKU","HPP Lama","HPP Baru",
                      "Harga Lama","Harga Baru","Alasan"
                    ].map(x => (
                      <th key={x} className="p-3">{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredChanges.slice(page*25,page*25+25)
                    .map(c => (
                      <tr key={c.sku} className="border-b">
                        <td className="p-3">{c.sku}</td>
                        <td className="p-3">{money(c.old_hpp)}</td>
                        <td className="p-3">{money(c.new_hpp)}</td>
                        <td className="p-3">{money(c.old_selling_price)}</td>
                        <td className="p-3">{money(c.new_selling_price)}</td>
                        <td className="p-3">{c.reason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className={secondary}
                disabled={page===0}
                onClick={() => setPage(p => p-1)}>
                Sebelumnya
              </button>

              <span className="text-xs">
                Halaman {page+1} /
                {" "}{Math.max(1,Math.ceil(filteredChanges.length/25))}
                {" - "}{fmt(filteredChanges.length)} perubahan
              </span>

              <button className={secondary}
                disabled={(page+1)*25>=filteredChanges.length}
                onClick={() => setPage(p => p+1)}>
                Berikutnya
              </button>
            </div>
          </section>

          {owner && prep && batch?.status==="DRAFT" && (
            <section className={panel}>
              <h2 className="font-bold text-red-800">
                Owner Approval - Full Replacement
              </h2>

              <p className="mt-2 text-sm">
                Pastikan data fisik kedua gudang sudah final
                dan seluruh hasil rekonsiliasi sudah diperiksa.
              </p>

              {!APPLY_ENABLED && (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                  Final Apply dikunci selama pengujian V4.6.2.
                </p>
              )}

              <label className="mt-4 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={busy || !APPLY_ENABLED}
                  checked={reviewed===batch.batch_id}
                  onChange={e => {
                    setReviewed(
                      e.target.checked ? batch.batch_id : ""
                    );
                    setConfirmation("");
                  }}
                />
                <span>
                  Saya menyetujui penggantian seluruh master aktif,
                  layout rak dan saldo stok kedua gudang.
                </span>
              </label>

              <input
                className={field+" mt-3"}
                placeholder="GANTI MASTER DAN STOK"
                disabled={!APPLY_ENABLED || busy ||
                  reviewed!==batch.batch_id}
                value={confirmation}
                onChange={e => setConfirmation(e.target.value)}
              />

              <button
                className="mt-3 rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                disabled={
                  !APPLY_ENABLED || busy || dirty ||
                  openOpnames>0 || inTransit>0 ||
                  reviewed!==batch.batch_id ||
                  confirmation!=="GANTI MASTER DAN STOK"
                }
                onClick={() => void apply()}>
                Approve & Replace All Data
              </button>
            </section>
          )}
        </>
      )}

      {batch?.status==="APPLIED" && (
        <section className={panel}>
          <p className="font-semibold text-green-700">
            Integrated Opening Import telah diterapkan.
          </p>
          <p className="mt-2 text-sm">
            Aktivasi operasional dilakukan terpisah melalui tab Go Live.
          </p>
        </section>
      )}
    </div>
  );
}
