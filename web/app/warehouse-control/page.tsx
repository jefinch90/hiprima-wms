"use client";

import {
  useCallback, useEffect, useMemo,
  useRef, useState
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type Warehouse = {
  id: string;
  key: string;
  name: string;
  is_active: boolean;
  can_operate: boolean;
  qty: number;
};

type Staff = {
  id: string;
  name: string | null;
  role: string;
  is_active: boolean;
  warehouse_ids: string[];
};

type Preview = {
  old_total: number;
  new_total: number;
  old_movements: number;
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

type Batch = {
  batch_id: string;
  status: string;
  preview: Preview;
};

type Control = {
  role: string;
  phase: string;
  warehouses: Warehouse[];
  staff: Staff[];
  in_transit: number;
  open_opnames: number;
  latest_batch: Batch | null;
};

type Sku = {
  variant_id: string;
  sku: string;
  product_name: string;
};

type Rack = {
  location_id: string;
  location_code: string;
  area_code: string;
  current_qty: number;
};

type TransferLine = {
  variant_id: string;
  from_location_id: string;
  qty: number;
  sku: string;
  rack: string;
  qc: string;
};

type Transfer = {
  id: string;
  transfer_no: string;
  status: string;
  source_name: string;
  destination_name: string;
  destination_warehouse_id: string;
  can_receive: boolean;
  lines: {
    line_id: string;
    variant_id: string;
    sku: string;
    qc: string;
    qty: number;
    from_rack: string;
    to_rack: string | null;
  }[];
};

type Opname = {
  id: string;
  session_code: string;
  opname_type: string;
  status: string;
  created_at: string;
  notes: string | null;
  total_lines: number;
};

type Pending = {
  p_request_id: string;
  p_source_warehouse_id: string;
  p_destination_warehouse_id: string;
  p_lines: {
    variant_id: string;
    from_location_id: string;
    qty: number;
  }[];
  p_notes: string | null;
};

const fmt = (n: number) =>
  Number(n ?? 0).toLocaleString("id-ID");

const field =
  "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";

const btn =
  "rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

const secondary =
  "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium disabled:opacity-40";

const panel =
  "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 md:p-5";

const tabs = [
  ["overview", "Overview"],
  ["transfer", "Transfer"],
  ["staff", "Staff Access"],
  ["import", "Opening Import"],
  ["opname", "Stock Opname Lama"],
  ["live", "Go Live"],
] as const;

export default function WarehouseControlPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<Control | null>(null);
  const [verified, setVerified] = useState(false);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [opnames, setOpnames] = useState<Opname[]>([]);
  const [selectedOpnames, setSelectedOpnames] =
    useState<string[]>([]);

  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [search, setSearch] = useState("");
  const [skus, setSkus] = useState<Sku[]>([]);
  const [sku, setSku] = useState<Sku | null>(null);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [rackId, setRackId] = useState("");
  const [qty, setQty] = useState("");
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [storageKey, setStorageKey] = useState("");

  const [receipt, setReceipt] = useState<Transfer | null>(null);
  const [receiptRacks, setReceiptRacks] =
    useState<Record<string, Rack[]>>({});
  const [receiptSelection, setReceiptSelection] =
    useState<Record<string, string>>({});

  const [file, setFile] = useState<File | null>(null);
  const [fileDirty, setFileDirty] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [liveConfirmation, setLiveConfirmation] = useState("");

  const rpc = useCallback(async (
    name: string,
    params: Record<string, unknown> = {}
  ) => {
    const result = await supabase.rpc(name, params);
    if (result.error) throw Error(result.error.message);
    return result.data;
  }, [supabase]);

  const refresh = useCallback(async () => {
    const control = await rpc("wms_control_state") as Control;
    const release = await rpc("wms_v46_release_status");
    setState(control);
    setVerified(release === "PASS");

    if (control.role !== "viewer") {
      const docs = await rpc("wms_transfer_list");
      setTransfers((docs ?? []) as Transfer[]);
    }

    if (
      ["owner", "admin"].includes(control.role) &&
      control.phase === "PREPARATION"
    ) {
      const old = await rpc("wms_preparation_opnames");
      setOpnames((old ?? []) as Opname[]);
    } else {
      setOpnames([]);
    }
  }, [rpc]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const { data: { user } } =
          await supabase.auth.getUser();

        if (!active) return;

        if (!user) {
          router.replace("/login");
          return;
        }

        const key = "hiprima-transfer-pending:" + user.id;
        setStorageKey(key);

        const saved = sessionStorage.getItem(key);

        if (saved) {
          setPending(JSON.parse(saved) as Pending);
        }

        await refresh();
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => { active = false; };
  }, [supabase, router, refresh]);

  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const owner = state?.role === "owner";
  const admin = owner || state?.role === "admin";
  const live = verified && state?.phase === "LIVE";
  const prep = verified && state?.phase === "PREPARATION";
  const warehouses = state?.warehouses ?? [];
  const activeWarehouses = warehouses.filter(w => w.is_active);

  function changeWarehouse(
    which: "source" | "destination",
    value: string
  ) {
    if (pending || busy) return;

    if (lines.length && !window.confirm(
      "Ganti gudang dan reset daftar transfer?"
    )) return;

    setLines([]);
    setSku(null);
    setSkus([]);
    setRacks([]);
    setRackId("");
    setQty("");

    if (which === "source") {
      setSource(value);
      if (value === destination) setDestination("");
    } else {
      setDestination(value);
    }
  }

  async function findSku() {
    await run(async () => {
      if (!live || !source || !search.trim()) return;

      const data = await rpc("search_outbound_skus", {
        p_search: search.trim(),
        p_limit: 20
      });

      setSkus((data ?? []) as Sku[]);
    });
  }

  async function chooseSku(item: Sku) {
    await run(async () => {
      setSku(item);
      setRackId("");
      setQty("");

      const data = await rpc("wms_scoped_racks", {
        p_warehouse_id: source,
        p_variant_id: item.variant_id,
        p_positive_only: true
      });

      setRacks((data ?? []) as Rack[]);
    });
  }

  function addLine() {
    const rack = racks.find(r => r.location_id === rackId);
    const n = Number(qty);

    if (
      !sku || !rack || !Number.isSafeInteger(n) ||
      n <= 0 || n > Number(rack.current_qty)
    ) {
      setError("Quantity atau rak tidak valid.");
      return;
    }

    if (lines.some(l =>
      l.variant_id === sku.variant_id &&
      l.from_location_id === rackId
    )) {
      setError("SKU dan rak tersebut sudah ada dalam daftar.");
      return;
    }

    if (lines.length >= 200) {
      setError("Maksimal 200 baris per transfer.");
      return;
    }

    setLines(prev => [...prev, {
      variant_id: sku.variant_id,
      from_location_id: rackId,
      qty: n,
      sku: sku.sku,
      rack: rack.location_code,
      qc: rack.area_code
    }]);

    setSku(null);
    setRackId("");
    setQty("");
    setSearch("");
    setSkus([]);
    setRacks([]);
    setError("");
  }

  async function dispatch() {
    await run(async () => {
      if (!live) throw Error("WMS belum LIVE.");

      let payload = pending;

      if (!payload) {
        if (
          !source || !destination ||
          source === destination || !lines.length
        ) throw Error("Lengkapi dokumen transfer.");

        if (!window.confirm(
          "Kirim barang? Stok asal akan berkurang."
        )) return;

        payload = {
          p_request_id: crypto.randomUUID(),
          p_source_warehouse_id: source,
          p_destination_warehouse_id: destination,
          p_lines: lines.map(l => ({
            variant_id: l.variant_id,
            from_location_id: l.from_location_id,
            qty: l.qty
          })),
          p_notes: notes.trim() || null
        };

        sessionStorage.setItem(
          storageKey, JSON.stringify(payload)
        );

        setPending(payload);
      }

      await rpc("wms_dispatch_transfer", payload);

      sessionStorage.removeItem(storageKey);
      setPending(null);
      setLines([]);
      setSku(null);
      setRacks([]);
      setRackId("");
      setQty("");
      setNotes("");

      setMessage("Transfer berhasil dikirim.");
      await refresh();
    });
  }

  async function prepareReceipt(doc: Transfer) {
    await run(async () => {
      if (!live || !doc.can_receive) return;

      const options: Record<string, Rack[]> = {};
      const selected: Record<string, string> = {};

      const results = await Promise.all(
        doc.lines.map(async line => {
          const data = await rpc("wms_scoped_racks", {
            p_warehouse_id: doc.destination_warehouse_id,
            p_variant_id: line.variant_id,
            p_area_code: line.qc
          });

          return [line.line_id, data ?? []] as const;
        })
      );

      for (const [id, data] of results) {
        options[id] = data as Rack[];

        if (options[id].length === 1) {
          selected[id] = options[id][0].location_id;
        }
      }

      setReceipt(doc);
      setReceiptRacks(options);
      setReceiptSelection(selected);
    });
  }

  async function receive() {
    await run(async () => {
      if (!live || !receipt) return;

      if (!receipt.lines.every(
        l => receiptSelection[l.line_id]
      )) throw Error("Pilih seluruh rak tujuan.");

      if (!window.confirm(
        "Konfirmasi seluruh jumlah barang benar-benar diterima?"
      )) return;

      await rpc("wms_receive_transfer", {
        p_transfer_id: receipt.id,
        p_destinations: receipt.lines.map(l => ({
          line_id: l.line_id,
          to_location_id: receiptSelection[l.line_id]
        }))
      });

      setReceipt(null);
      setMessage("Penerimaan transfer berhasil.");
      await refresh();
    });
  }

  async function downloadTemplate() {
    await run(async () => {
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();

      const master = wb.addWorksheet("Master Rak");

      master.columns = [
        { header: "Gudang", key: "warehouse", width: 18 },
        { header: "Area", key: "area", width: 18 },
        { header: "Kode Rak", key: "rack", width: 24 },
        { header: "Nama Rak", key: "name", width: 35 }
      ];

      const stock = wb.addWorksheet("Opening Stock");

      stock.columns = [
        { header: "SKU", key: "sku", width: 35 },
        { header: "Gudang", key: "warehouse", width: 18 },
        { header: "Kode Rak", key: "rack", width: 24 },
        { header: "Qty", key: "qty", width: 15 }
      ];

      for (const ws of [master, stock]) {
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: "frozen", ySplit: 1 }];
      }

      master.getColumn(3).numFmt = "@";
      stock.getColumn(1).numFmt = "@";
      stock.getColumn(3).numFmt = "@";

      const guide = wb.addWorksheet("Petunjuk");
      guide.getColumn(1).width = 95;
      guide.addRows([
        ["Hi.PRIMA WMS - Fresh Opening Stock"],
        ["Gudang: UTAMA atau STORE"],
        ["Area: NORMAL, DEFECT, REJECT"],
        ["Gunakan kode rak baru, bukan kode historis."],
        ["Kode rak harus unik dalam satu gudang."],
        ["SKU harus sama persis dengan master SKU WMS."],
        ["Satu SKU boleh berada di beberapa rak atau gudang."],
        ["Satu kombinasi SKU + gudang + rak hanya satu baris."],
        ["Qty bilangan bulat >= 0, tanpa rumus Excel."],
        ["Import mengganti total saldo kedua gudang."],
        ["Jangan mengisi data contoh pada file aktual."]
      ]);

      const buffer = await wb.xlsx.writeBuffer();
      const bytes = new Uint8Array(buffer as ArrayBuffer);

      const url = URL.createObjectURL(new Blob(
        [bytes],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
      ));

      const a = document.createElement("a");
      a.href = url;
      a.download = "HiPRIMA_Opening_Stock_Template.xlsx";
      a.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  async function previewOpening() {
    await run(async () => {
      if (!file || !prep || !admin) return;

      if (
        !file.name.toLowerCase().endsWith(".xlsx") ||
        file.size > 10 * 1024 * 1024
      ) throw Error("Gunakan XLSX maksimal 10 MB.");

      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      await wb.xlsx.load(await file.arrayBuffer());

      const master = wb.getWorksheet("Master Rak");
      const stock = wb.getWorksheet("Opening Stock");

      if (!master || !stock) {
        throw Error("Sheet Master Rak dan Opening Stock wajib ada.");
      }

      function rows(
        ws: typeof master,
        headers: string[]
      ): string[][] {
        if (!ws) throw Error("Sheet tidak ditemukan.");

        const actual = headers.map((_, i) =>
          ws.getRow(1).getCell(i + 1).text.trim()
        );

        if (actual.some((v, i) => v !== headers[i])) {
          throw Error("Header tidak sesuai: " + ws.name);
        }

        const result: string[][] = [];

        ws.eachRow((row, index) => {
          if (index === 1) return;

          const values = headers.map((_, i) => {
            const cell = row.getCell(i + 1);

            if (cell.formula) {
              throw Error(
                ws.name + " baris " + index + ": rumus tidak diizinkan."
              );
            }

            return cell.text.trim();
          });

          if (values.some(Boolean)) result.push(values);
        });

        return result;
      }

      const rackRows = rows(master, [
        "Gudang", "Area", "Kode Rak", "Nama Rak"
      ]).map(r => ({
        warehouse: r[0].toUpperCase(),
        area: r[1].toUpperCase(),
        rack: r[2].toUpperCase(),
        name: r[3]
      }));

      const stockRows = rows(stock, [
        "SKU", "Gudang", "Kode Rak", "Qty"
      ]).map((r, i) => {
        if (
          !/^\d+$/.test(r[3]) ||
          !Number.isSafeInteger(Number(r[3])) ||
          Number(r[3]) > 999999999
        ) throw Error("Qty tidak valid pada data baris " + (i + 1));

        return {
          sku: r[0],
          warehouse: r[1].toUpperCase(),
          rack: r[2].toUpperCase(),
          qty: Number(r[3])
        };
      });

      await rpc("wms_preview_opening", {
        p_racks: rackRows,
        p_stock: stockRows
      });

      setFileDirty(false);
      setConfirmation("");
      setMessage("Preview valid. Stok asli belum berubah.");
      await refresh();
    });
  }

  async function applyOpening() {
    await run(async () => {
      const batch = state?.latest_batch;

      if (
        !owner || !prep || !batch ||
        batch.status !== "DRAFT" ||
        fileDirty || confirmation !== "GANTI STOK"
      ) return;

      if (state.open_opnames > 0) {
        throw Error("Stock Opname lama belum ditutup.");
      }

      if (!window.confirm(
        "PERHATIAN: seluruh saldo stok lama akan diganti. Lanjutkan?"
      )) return;

      await rpc("wms_apply_opening", {
        p_batch_id: batch.batch_id,
        p_confirmation: confirmation
      });

      setConfirmation("");
      setMessage("Opening Stock berhasil. Status READY.");
      await refresh();
    });
  }

  async function cancelOpnames() {
    await run(async () => {
      if (!owner || !prep || !selectedOpnames.length) return;

      const word = window.prompt(
        "Pastikan sesi terpilih tidak digunakan. Ketik BATALKAN."
      );

      if (word !== "BATALKAN") return;

      await rpc("wms_cancel_preparation_opnames", {
        p_session_ids: selectedOpnames,
        p_confirmation: word
      });

      setSelectedOpnames([]);
      setMessage("Sesi terpilih dibatalkan tanpa adjustment.");
      await refresh();
    });
  }

  async function activate() {
    await run(async () => {
      if (
        !owner || !verified ||
        state?.phase !== "READY" ||
        liveConfirmation !== "GO LIVE"
      ) return;

      if (!window.confirm(
        "Aktifkan transaksi WMS untuk kedua gudang?"
      )) return;

      await rpc("wms_activate_go_live", {
        p_confirmation: liveConfirmation
      });

      setLiveConfirmation("");
      setMessage("WMS sekarang LIVE.");
      await refresh();
    });
  }

  const batch = state?.latest_batch;
  const preview = batch?.preview;
  const visibleTabs = tabs.filter(([id]) =>
    id === "overview" ||
    (id === "transfer" && state?.role !== "viewer") ||
    (admin && id !== "transfer")
  );

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full">
        <Sidebar />

        <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-8">
          <div className="mx-auto max-w-[1400px] space-y-5">

            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">Hi.PRIMA WMS</p>
                <h1 className="text-2xl font-bold md:text-3xl">
                  Warehouse Control Center
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Multi-Warehouse Operations
                </p>
              </div>
              <Link href="/stock-movement" className={secondary}>
                Stock Movement
              </Link>
            </header>

            {error && (
              <div className="break-words rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {error}
              </div>
            )}

            {message && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                {message}
              </div>
            )}

            {!state ? (
              <section className={panel}>
                Memuat Warehouse Control Center...
                <button className={secondary + " ml-3"}
                  onClick={() => void run(refresh)}>
                  Coba lagi
                </button>
              </section>
            ) : (
              <>
                <section className={panel}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-500">Operational Status</p>
                      <h2 className={"text-xl font-bold " +
                        (live ? "text-green-700" : "text-amber-700")}>
                        {state.phase}
                      </h2>
                    </div>
                    <button className={secondary} disabled={busy}
                      onClick={() => void run(refresh)}>
                      Refresh
                    </button>
                  </div>

                  <p className="mt-2 text-sm text-slate-600">
                    {live
                      ? "Transaksi operasional aktif."
                      : "Transaksi stok belum diaktifkan."}
                  </p>

                  {!verified && (
                    <p className="mt-2 text-sm text-red-700">
                      Final regression belum terverifikasi.
                    </p>
                  )}
                </section>

                <nav className="flex flex-wrap gap-2">
                  {visibleTabs.map(([id, label]) => (
                    <button key={id} type="button"
                      disabled={busy}
                      className={tab === id ? btn : secondary}
                      onClick={() => setTab(id)}>
                      {label}
                    </button>
                  ))}
                </nav>

                {tab === "overview" && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {warehouses.map(w => (
                        <section key={w.id} className={panel}>
                          <p className="text-sm text-slate-500">{w.name}</p>
                          <p className="mt-2 text-3xl font-bold">{fmt(w.qty)}</p>
                          <p className="text-xs text-slate-500">
                            pcs - {w.is_active ? "Aktif" : "Nonaktif"}
                          </p>
                        </section>
                      ))}
                      <section className={panel}>
                        <p className="text-sm text-slate-500">In Transit</p>
                        <p className="mt-2 text-3xl font-bold">{fmt(state.in_transit)}</p>
                        <p className="text-xs text-slate-500">pcs dalam perjalanan</p>
                      </section>
                      <section className={panel}>
                        <p className="text-sm text-slate-500">Open Stock Opname</p>
                        <p className="mt-2 text-3xl font-bold">{state.open_opnames}</p>
                        <p className="text-xs text-slate-500">sesi belum ditutup</p>
                      </section>
                    </div>

                    <section className={panel}>
                      <h2 className="font-bold">Go Live Readiness</h2>
                      {[
                        ["Backend Final Regression", verified],
                        ["Stock Opname lama ditutup", state.open_opnames === 0],
                        ["Opening Stock Applied", batch?.status === "APPLIED" || live],
                        ["Dua gudang aktif", activeWarehouses.length === 2],
                        ["Owner Go Live Approval", live]
                      ].map(([label, done]) => (
                        <p key={String(label)}
                          className="mt-3 text-sm">
                          <span className={done ? "text-green-700" : "text-amber-700"}>
                            {done ? "PASS" : "PENDING"}
                          </span>
                          {" - "}{label}
                        </p>
                      ))}
                    </section>
                  </>
                )}

                {tab === "transfer" && (
                  <>
                    {!live && (
                      <section className={panel}>
                        Transfer baru dapat dijalankan setelah Go Live.
                      </section>
                    )}

                    <section className={panel}>
                      <h2 className="mb-4 font-bold">Kirim Transfer Multi-SKU</h2>

                      <fieldset disabled={!live || busy || !!pending}
                        className="space-y-4 disabled:opacity-60">

                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-sm">Gudang Asal
                            <select className={field} value={source}
                              onChange={e => changeWarehouse("source", e.target.value)}>
                              <option value="">Pilih gudang</option>
                              {activeWarehouses.filter(w => w.can_operate).map(w => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                              ))}
                            </select>
                          </label>

                          <label className="text-sm">Gudang Tujuan
                            <select className={field} value={destination}
                              onChange={e => changeWarehouse("destination", e.target.value)}>
                              <option value="">Pilih gudang</option>
                              {activeWarehouses.filter(w => w.id !== source).map(w => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <input className={field + " flex-1"}
                            placeholder="Cari SKU"
                            value={search}
                            onChange={e => setSearch(e.target.value)} />
                          <button className={secondary}
                            disabled={!source}
                            onClick={() => void findSku()}>
                            Cari SKU
                          </button>
                        </div>

                        {skus.map(item => (
                          <button key={item.variant_id}
                            className={secondary + " mr-2 mb-2"}
                            onClick={() => void chooseSku(item)}>
                            {item.sku}
                          </button>
                        ))}

                        {sku && (
                          <div className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
                            <p className="text-sm font-medium sm:col-span-3">
                              {sku.sku} - {sku.product_name}
                            </p>
                            <select className={field} value={rackId}
                              onChange={e => setRackId(e.target.value)}>
                              <option value="">Pilih rak asal</option>
                              {racks.map(r => (
                                <option key={r.location_id} value={r.location_id}>
                                  {r.location_code} / {r.area_code} / {r.current_qty} pcs
                                </option>
                              ))}
                            </select>

                            <input className={field} type="number" min="1" step="1"
                              placeholder="Qty" value={qty}
                              onChange={e => setQty(e.target.value)} />

                            <button className={secondary} onClick={addLine}>
                              Tambah SKU
                            </button>
                          </div>
                        )}

                        {lines.map((line, i) => (
                          <div key={line.variant_id + line.from_location_id}
                            className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
                            <span className="break-all">
                              {line.sku} / {line.rack} / {line.qty} pcs
                            </span>
                            <button className={secondary}
                              onClick={() => setLines(prev =>
                                prev.filter((_, j) => i !== j))}>
                              Hapus
                            </button>
                          </div>
                        ))}

                        <textarea className={field} maxLength={500}
                          placeholder="Catatan transfer"
                          value={notes}
                          onChange={e => setNotes(e.target.value)} />
                      </fieldset>

                      {pending && (
                        <p className="mt-3 text-sm text-amber-700">
                          Ada request yang belum terkonfirmasi.
                          Ulangi request yang sama, jangan membuat transfer baru.
                        </p>
                      )}

                      <button className={btn + " mt-4"}
                        disabled={!live || busy || (!pending &&
                          (!source || !destination || !lines.length))}
                        onClick={() => void dispatch()}>
                        {pending ? "Retry Transfer" :
                          `Kirim ${fmt(lines.reduce((n,l) => n+l.qty,0))} pcs`}
                      </button>
                    </section>

                    <section className={panel}>
                      <h2 className="font-bold">Transfer History</h2>
                      {!transfers.length && (
                        <p className="mt-3 text-sm text-slate-500">
                          Belum ada dokumen transfer.
                        </p>
                      )}

                      {transfers.map(doc => (
                        <div key={doc.id}
                          className="mt-3 rounded-xl border p-3">
                          <div className="flex flex-wrap justify-between gap-2">
                            <p className="font-semibold">{doc.transfer_no}</p>
                            <p className="text-sm">{doc.status}</p>
                          </div>
                          <p className="mt-2 text-sm">
                            {doc.source_name} - {doc.destination_name}
                          </p>
                          {doc.lines.map(l => (
                            <p key={l.line_id}
                              className="mt-1 text-sm text-slate-600">
                              {l.sku} / {l.qty} pcs / {l.qc}
                            </p>
                          ))}
                          {doc.status === "IN_TRANSIT" && doc.can_receive && (
                            <button className={btn + " mt-3"}
                              disabled={!live || busy}
                              onClick={() => void prepareReceipt(doc)}>
                              Terima Barang
                            </button>
                          )}
                        </div>
                      ))}
                    </section>

                    {receipt && (
                      <section className={panel}>
                        <h2 className="font-bold">
                          Penerimaan {receipt.transfer_no}
                        </h2>

                        {receipt.lines.map(l => (
                          <label key={l.line_id}
                            className="mt-3 block text-sm">
                            {l.sku} - {l.qty} pcs - {l.qc}
                            <select className={field}
                              disabled={busy}
                              value={receiptSelection[l.line_id] ?? ""}
                              onChange={e => setReceiptSelection(prev => ({
                                ...prev,
                                [l.line_id]: e.target.value
                              }))}>
                              <option value="">Pilih rak tujuan</option>
                              {(receiptRacks[l.line_id] ?? []).map(r => (
                                <option key={r.location_id} value={r.location_id}>
                                  {r.location_code}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}

                        <button className={btn + " mt-4"}
                          disabled={!live || busy}
                          onClick={() => void receive()}>
                          Konfirmasi Penerimaan
                        </button>
                        <button className={secondary + " ml-2"}
                          disabled={busy}
                          onClick={() => setReceipt(null)}>
                          Tutup
                        </button>
                      </section>
                    )}
                  </>
                )}

                {tab === "staff" && admin && (
                  <section className={panel}>
                    <h2 className="font-bold">Penugasan Staf Gudang</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Owner dan Admin dapat mengatur akses transaksi setiap staf.
                    </p>
                    {state.staff.map(person => (
                      <StaffAssignment
                        key={person.id + person.warehouse_ids.join(",")}
                        person={person}
                        warehouses={warehouses}
                        busy={busy}
                        save={ids => void run(async () => {
                          await rpc("wms_set_staff_warehouses", {
                            p_profile_id: person.id,
                            p_warehouse_ids: ids
                          });
                          setMessage("Penugasan berhasil disimpan.");
                          await refresh();
                        })}
                      />
                    ))}
                  </section>
                )}

                {tab === "import" && admin && (
                  <>
                    <section className={panel}>
                      <h2 className="font-bold">Fresh Opening Stock Import</h2>
                      <p className="my-3 text-sm text-amber-800">
                        REPLACE STOCK: seluruh saldo kedua gudang akan diganti,
                        bukan ditambahkan.
                      </p>

                      <button className={secondary} disabled={busy}
                        onClick={() => void downloadTemplate()}>
                        Download Template Excel
                      </button>

                      <input type="file" accept=".xlsx"
                        disabled={!prep || busy}
                        className={field + " mt-4"}
                        onChange={e => {
                          setFile(e.target.files?.[0] ?? null);
                          setFileDirty(true);
                          setConfirmation("");
                        }} />

                      <button className={btn + " mt-3"}
                        disabled={!prep || busy || !file}
                        onClick={() => void previewOpening()}>
                        Preview & Validation
                      </button>
                    </section>

                    {preview && (
                      <section className={panel}>
                        <h2 className="font-bold">Opening Stock Preview</h2>
                        <p className="mt-2 text-sm">Batch: {batch?.status}</p>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl bg-slate-100 p-3">
                            <p className="text-sm">Stok Lama</p>
                            <p className="text-2xl font-bold">{fmt(preview.old_total)}</p>
                          </div>
                          <div className="rounded-xl bg-blue-50 p-3">
                            <p className="text-sm">Stok Baru</p>
                            <p className="text-2xl font-bold">{fmt(preview.new_total)}</p>
                          </div>
                        </div>

                        <p className="mt-4 text-sm">
                          {fmt(preview.new_racks)} rak / {fmt(preview.new_skus)} SKU
                          / {fmt(preview.new_rows)} baris
                        </p>

                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead><tr>
                              <th className="p-2">Gudang</th>
                              <th className="p-2">Area</th>
                              <th className="p-2">Rak</th>
                              <th className="p-2">Qty</th>
                            </tr></thead>
                            <tbody>
                              {preview.summary.map(row => (
                                <tr key={row.warehouse + row.area} className="border-t">
                                  <td className="p-2">{row.warehouse}</td>
                                  <td className="p-2">{row.area}</td>
                                  <td className="p-2">{fmt(row.racks)}</td>
                                  <td className="p-2">{fmt(row.qty)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {owner && prep && batch?.status === "DRAFT" && (
                          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
                            <p className="text-sm font-semibold text-red-800">
                              Persetujuan Penggantian Seluruh Stok
                            </p>
                            {state.open_opnames > 0 && (
                              <p className="mt-2 text-sm">
                                Tutup {state.open_opnames} sesi Stock Opname dahulu.
                              </p>
                            )}
                            <input className={field + " mt-3"}
                              placeholder="Ketik GANTI STOK"
                              value={confirmation}
                              onChange={e => setConfirmation(e.target.value)} />
                            <button className="mt-3 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                              disabled={busy || fileDirty ||
                                state.open_opnames > 0 ||
                                confirmation !== "GANTI STOK"}
                              onClick={() => void applyOpening()}>
                              Approve & Replace Opening Stock
                            </button>
                          </div>
                        )}
                      </section>
                    )}
                  </>
                )}

                {tab === "opname" && admin && (
                  <section className={panel}>
                    <h2 className="font-bold">Review Stock Opname Lama</h2>
                    <p className="my-3 text-sm text-slate-600">
                      Pilih hanya sesi lama yang memang tidak akan digunakan.
                      Pembatalan tidak membuat adjustment stok.
                    </p>

                    {!opnames.length && (
                      <p className="text-sm text-green-700">
                        Tidak ada sesi persiapan yang perlu ditampilkan.
                      </p>
                    )}

                    {opnames.map(o => (
                      <label key={o.id}
                        className="mb-3 flex gap-3 rounded-xl border p-3">
                        <input type="checkbox"
                          disabled={!owner || !prep || busy}
                          checked={selectedOpnames.includes(o.id)}
                          onChange={e => setSelectedOpnames(prev =>
                            e.target.checked
                              ? [...prev,o.id]
                              : prev.filter(id => id !== o.id)
                          )} />
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold">
                            {o.session_code ?? o.id}
                          </p>
                          <p>{o.opname_type} / {o.status} / {o.total_lines} baris</p>
                          <p>{new Date(o.created_at).toLocaleString("id-ID")}</p>
                          {o.notes && <p className="break-words">{o.notes}</p>}
                        </div>
                      </label>
                    ))}

                    {owner && (
                      <button className={btn}
                        disabled={!prep || busy || !selectedOpnames.length}
                        onClick={() => void cancelOpnames()}>
                        Batalkan Sesi Terpilih
                      </button>
                    )}
                  </section>
                )}

                {tab === "live" && admin && (
                  <section className={panel}>
                    <h2 className="font-bold">Owner Go Live Approval</h2>
                    <p className="mt-3 text-sm">
                      Status sekarang: {state.phase}
                    </p>

                    <p className="my-3 text-sm text-slate-600">
                      Aktivasi hanya setelah opening stock benar,
                      sistem telah di-deploy dan staf siap bekerja.
                    </p>

                    {owner && state.phase === "READY" && verified && (
                      <>
                        <input className={field}
                          placeholder="Ketik GO LIVE"
                          value={liveConfirmation}
                          onChange={e => setLiveConfirmation(e.target.value)} />

                        <button className={btn + " mt-3"}
                          disabled={busy || liveConfirmation !== "GO LIVE"}
                          onClick={() => void activate()}>
                          Activate Go Live
                        </button>
                      </>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function StaffAssignment({
  person, warehouses, busy, save
}: {
  person: Staff;
  warehouses: Warehouse[];
  busy: boolean;
  save: (ids: string[]) => void;
}) {
  const [selected, setSelected] =
    useState<string[]>(person.warehouse_ids);

  return (
    <div className="mt-4 rounded-xl border p-4">
      <p className="font-semibold">{person.name || "Tanpa nama profil"}</p>
      <p className="text-xs text-slate-500">
        {person.role} - {person.is_active ? "Aktif" : "Nonaktif"}
      </p>

      <div className="my-3 flex flex-wrap gap-4">
        {warehouses.map(w => (
          <label className="flex items-center gap-2 text-sm" key={w.id}>
            <input type="checkbox"
              disabled={busy}
              checked={selected.includes(w.id)}
              onChange={e => setSelected(prev =>
                e.target.checked
                  ? [...prev,w.id]
                  : prev.filter(id => id !== w.id)
              )} />
            {w.name}
          </label>
        ))}
      </div>

      <button className={secondary}
        disabled={busy}
        onClick={() => {
          if (window.confirm("Simpan penugasan gudang staf?")) {
            save(selected);
          }
        }}>
        Simpan Penugasan
      </button>
    </div>
  );
}