"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

type Warehouse = {
  warehouse_id: string;
  warehouse_key: string;
  warehouse_name: string;
  is_active: boolean;
};

export type WarehousePageProps = {
  warehouseId: string;
  warehouseName: string;
  renderWarehousePicker: (disabled: boolean) => ReactNode;
};

export function WarehouseScope({
  render,
  history = false
}: {
  render: (props: WarehousePageProps) => ReactNode;
  history?: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!active) return;
        if (!user) {
          router.replace("/login");
          return;
        }

        const result = await supabase.rpc("wms_list_warehouses");
        if (!active) return;
        if (result.error) throw Error(result.error.message);

        const list = (result.data ?? []) as Warehouse[];
        const available = list.filter(w => w.is_active);
        const preferred =
          available.find(w => w.warehouse_key === "UTAMA") ??
          available[0];

        setWarehouses(list);

        if (history) {
          setWarehouseId("");
        } else if (preferred) {
          setWarehouseId(preferred.warehouse_id);
        } else {
          throw Error("Tidak ada gudang aktif.");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Gagal membaca gudang.");
      }
    })();

    return () => { active = false; };
  }, [supabase, router, history]);

  if (error || warehouseId === null) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border bg-white p-5 text-sm">
          {error || "Memuat konfigurasi gudang..."}
          {error && (
            <button
              type="button"
              className="mt-3 block rounded-lg border px-4 py-2"
              onClick={() => window.location.reload()}
            >
              Coba lagi
            </button>
          )}
        </div>
      </div>
    );
  }

  const warehouseName =
    warehouses.find(w => w.warehouse_id === warehouseId)
      ?.warehouse_name ?? "Semua Gudang";

  const renderWarehousePicker = (disabled: boolean) => (
    <section className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <label className="block text-sm font-semibold text-blue-900">
        {history ? "Filter Gudang" : "Gudang Operasional"}
        <select
          value={warehouseId}
          disabled={disabled}
          className="mt-2 block w-full max-w-md rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 disabled:opacity-60"
          onChange={event => {
            const next = event.target.value;
            if (next === warehouseId) return;

            if (!history && !window.confirm(
              "Ganti gudang? Isian formulir sebelumnya akan direset."
            )) return;

            setWarehouseId(next);
          }}
        >
          {history && <option value="">Semua Gudang</option>}
          {warehouses.map(w => (
            <option
              key={w.warehouse_id}
              value={w.warehouse_id}
              disabled={!history && !w.is_active}
            >
              {w.warehouse_name}{!w.is_active ? " (Nonaktif)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-2 text-xs text-blue-800">
        {history
          ? "Menampilkan movement berdasarkan gudang asal atau tujuan."
          : "Pilihan rak transaksi mengikuti gudang terpilih."}
      </p>
      {disabled && !history && (
        <p className="mt-1 text-xs text-blue-800">
          Selesaikan atau reset formulir sebelum mengganti gudang.
        </p>
      )}
    </section>
  );

  return <>{render({
    warehouseId,
    warehouseName,
    renderWarehousePicker
  })}</>;
}