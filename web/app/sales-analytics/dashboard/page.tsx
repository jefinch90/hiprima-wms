"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type Period = 7 | 30 | 90;
type ChartMetric = "net_sales" | "units_sold";

type Numeric = number | string | null;

type SalesSummary = {
  report_rows: Numeric;
  sku_count: Numeric;
  units_sold: Numeric;
  units_returned: Numeric;
  orders_aggregate: Numeric;
  gross_sales: Numeric;
  refund_amount: Numeric;
  discount_amount: Numeric;
  promotion_amount: Numeric;
  net_sales: Numeric;
};

type DailyRow = {
  sale_date: string;
  units_sold: Numeric;
  net_sales: Numeric;
};

type ChannelRow = {
  sales_channel: string | null;
  units_sold: Numeric;
  units_returned: Numeric;
  gross_sales: Numeric;
  net_sales: Numeric;
};

type UserRow = {
  source_user: string;
  sales_channel: string;
  units_sold: Numeric;
  net_sales: Numeric;
};

type SkuRow = {
  sku: string;
  product_name: string | null;
  units_sold: Numeric;
  units_returned: Numeric;
  net_sales: Numeric;
  sales_velocity: Numeric;
};

type DashboardResult = {
  start_date: string;
  end_date: string;
  days: number;
  summary: SalesSummary;
  daily: DailyRow[];
  channels: ChannelRow[];
  users: UserRow[];
  top_skus: SkuRow[];
};

function num(value: Numeric | undefined): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function money(value: Numeric | undefined): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num(value));
}

function integer(value: Numeric | undefined): string {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(num(value));
}

function decimal(value: Numeric | undefined): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(num(value));
}

function dateLabel(value: string): string {
  if (!value) return "-";

  const date = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("id-ID", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function SummaryCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description?: string;
}) {
  return (
    <div data-hp-v6-metric={title} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p data-hp-v6-metric-label="" className="text-sm text-slate-500">
        {title}
      </p>

      <p className="mt-3 break-words text-2xl font-bold tracking-tight text-slate-900">
        {value}
      </p>

      {description && (
        <p className="mt-2 text-xs text-slate-500">
          {description}
        </p>
      )}
    </div>
  );
}

export default function SalesDashboardPage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [period, setPeriod] = useState<Period>(30);

  const [chartMetric, setChartMetric] =
    useState<ChartMetric>("net_sales");

  const [report, setReport] =
    useState<DashboardResult | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [segment, setSegment] =
    useState<"fashion" | "all" | "non_fashion">("fashion");

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setErrorMessage("");
      setReport(null);

      const { data, error } = await supabase.rpc(
        "get_iseller_sales_dashboard_v7",
        {
          p_days: period,
          p_top_limit: 20,
          p_segment: segment,
        }
      );

      if (!active) return;

      if (error) {
        setErrorMessage(error.message);
      } else {
        const result = data as DashboardResult | null;

        if (
          !result ||
          !result.summary ||
          !Array.isArray(result.daily) ||
          !Array.isArray(result.channels) ||
          !Array.isArray(result.users) ||
          !Array.isArray(result.top_skus)
        ) {
          setErrorMessage(
            "Format data dashboard tidak sesuai."
          );
        } else {
          setReport(result);
        }
      }

      setLoading(false);
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [period, refreshKey, supabase, segment]);

  const summary = report?.summary;

  const classification = (
    report as (DashboardResult & {
      classification?: {
        unknown_rows?: number | string;
        unknown_units?: number | string;
        non_fashion_rows?: number | string;
      };
    }) | null
  )?.classification;


  const daily = report?.daily ?? [];
  const channels = report?.channels ?? [];
  const users = report?.users ?? [];
  const topSkus = report?.top_skus ?? [];

  const totalUnits = num(summary?.units_sold);

  const averageUnits =
    totalUnits / (report?.days || period);





  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />

        <main data-hp-v6="sales" className="min-w-0 max-w-full flex-1 overflow-x-hidden p-5 md:p-10">
          <div className="mx-auto w-full min-w-0 max-w-[1450px]">

            <header data-hp-v6-hero="" className="mb-8">
              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 data-hp-v6-title="" className="text-3xl font-bold tracking-tight">
                    Sales Analytics Dashboard
                  </h1>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-2 text-sm font-medium text-slate-600">
              Analisis:
            </span>

            <button
              type="button"
              aria-pressed={segment === "fashion"}
              onClick={() => setSegment("fashion")}
              className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                segment === "fashion"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              Fashion
            </button>

            <button
              type="button"
              aria-pressed={segment === "non_fashion"}
              onClick={() => setSegment("non_fashion")}
              className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                segment === "non_fashion"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              Non-Fashion
            </button>
<button
              type="button"
              aria-pressed={segment === "all"}
              onClick={() => setSegment("all")}
              className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                segment === "all"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              Semua Produk
            </button>
          </div>

          {(Number(classification?.unknown_units ?? 0) > 0 && (segment === "fashion" && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-semibold">
                Analisis Fashion sementara.
              </span>
              <span className="ml-1">
                SKU yang belum terklasifikasi belum termasuk dalam KPI.
              </span>

              {classification && (
                <p className="mt-1">
                  Belum terklasifikasi:{" "}
                  {Number(
                    classification.unknown_units ?? 0
                  ).toLocaleString("id-ID")} unit dari{" "}
                  {Number(
                    classification.unknown_rows ?? 0
                  ).toLocaleString("id-ID")} baris.
                </p>
              )}
            </div>
          )))}


                  <p className="mt-2 text-sm text-slate-500">
                    Analisis penjualan iSeller untuk
                    pengambilan keputusan produksi.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/sales-analytics/sku-mapping"
                    className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium hover:bg-slate-50"
                  >
                    SKU Mapping
                  </Link>

                  <Link
                    href="/sales-analytics"
                    className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium hover:bg-slate-50"
                  >
                    Import iSeller
                  </Link>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      setRefreshKey((value) => value + 1)
                    }
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Refresh Data
                  </button>
                </div>
              </div>
            </header>

            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div>
                <p className="text-sm font-semibold">
                  Periode Analisis
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  {report
                    ? `${dateLabel(report.start_date)} – ${dateLabel(report.end_date)}`
                    : "Mengambil data penjualan"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {([7, 30, 90] as const).map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setPeriod(days)}
                    className={
                      period === days
                        ? "rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
                        : "rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-slate-50"
                    }
                  >
                    {days} Hari
                  </button>
                ))}
              </div>
            </div>

            {errorMessage && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            {loading && (
              <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
                Menghitung Sales Analytics...
              </div>
            )}

            {!loading && report && (
              <>
                <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard
                    title="Penjualan Bersih"
                    value={money(summary?.net_sales)}
                    description="Menurut laporan iSeller"
                  />

                  <SummaryCard
                    title="Penjualan Kotor"
                    value={money(summary?.gross_sales)}
                  />

                  <SummaryCard
                    title="Unit Terjual"
                    value={integer(summary?.units_sold)}
                  />

                  <SummaryCard
                    title="Sales Velocity Total"
                    value={`${decimal(averageUnits)} pcs/hari`}
                  />

                  <SummaryCard
                    title="Diskon"
                    value={money(summary?.discount_amount)}
                  />

                  <SummaryCard
                    title="Promosi"
                    value={money(summary?.promotion_amount)}
                  />

                  <SummaryCard
                    title="Pengembalian Dana"
                    value={money(summary?.refund_amount)}
                  />

                  <SummaryCard
                    title="Unit Dikembalikan"
                    value={integer(summary?.units_returned)}
                  />
                </section>

                <section className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h2 data-hp-v6-section="" className="text-lg font-bold">
                          Tren Penjualan Harian
                        </h2>

                        <p className="mt-1 text-xs text-slate-500">
                          {period} hari terakhir
                        </p>
                      </div>

                      <select
                        aria-label="Pilih metrik grafik"
                        value={chartMetric}
                        onChange={(event) =>
                          setChartMetric(
                            event.target.value as ChartMetric
                          )
                        }
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm"
                      >
                        <option value="net_sales">
                          Penjualan Bersih
                        </option>
                        <option value="units_sold">
                          Unit Terjual
                        </option>
                      </select>
                    </div>

                    <div className="mt-8 w-full min-w-0">
                      <HPInteractiveSalesChart rows={daily} metric={chartMetric} />

                      <div className="flex justify-between gap-4 text-xs text-slate-500">
                        <span>
                          {daily.length
                            ? dateLabel(daily[0].sale_date)
                            : "-"}
                        </span>

                        <span>
                          {daily.length
                            ? dateLabel(
                                daily[daily.length - 1].sale_date
                              )
                            : "-"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 data-hp-v6-section="" className="text-lg font-bold">
                      Sales Channel
                    </h2>

                    <p className="mt-1 text-xs text-slate-500">
                      Kontribusi berdasarkan unit terjual
                    </p>

                    <div className="mt-6 space-y-5">
                      {channels.map((channel, index) => {
                        const units = num(channel.units_sold);
                        const percentage =
                          totalUnits > 0
                            ? (units / totalUnits) * 100
                            : 0;

                        return (
                          <div
                            key={`${channel.sales_channel}-${index}`}
                          >
                            <div className="mb-2 flex items-start justify-between gap-3 text-sm">
                              <span className="min-w-0 break-words font-medium">
                                {channel.sales_channel ||
                                  "Belum Terklasifikasi"}
                              </span>

                              <span className="shrink-0 text-slate-600">
                                {integer(units)} pcs
                              </span>
                            </div>

                            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-slate-900"
                                style={{
      width: Math.max(0,Math.min(100,percentage))+"%",
      backgroundColor: hpChannelColor(channel.sales_channel)
    }}
                              />
                            </div>

                            <p className="mt-1 text-right text-xs text-slate-500">
                              {decimal(percentage)}%
                            </p>
                          </div>
                        );
                      })}

                      {channels.length === 0 && (
                        <p className="text-sm text-slate-500">
                          Belum ada data channel.
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="mt-6 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 p-6">
                    <h2 data-hp-v6-section="" className="text-lg font-bold">Penjualan per Pengguna iSeller</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Berdasarkan segmen dan periode analisis yang dipilih.
                      Pengguna dari import lama tanpa kolom Pengguna ditampilkan sebagai Tidak diketahui.
                    </p>
                  </div>
                  <div className="w-full overflow-x-auto">
                    <table data-hp-v6-table="" className="w-full min-w-[720px] text-left text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="p-4">Pengguna</th>
                          <th className="p-4">Sales Channel</th>
                          <th className="p-4 text-right">Unit Terjual</th>
                          <th className="p-4 text-right">Penjualan Bersih</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {users.map((row, index) => (
                          <tr key={`${row.source_user}-${row.sales_channel}-${index}`}>
                            <td className="p-4 font-medium">{row.source_user}</td>
                            <td className="p-4">{row.sales_channel || "Belum Terklasifikasi"}</td>
                            <td className="p-4 text-right">{integer(row.units_sold)}</td>
                            <td className="p-4 text-right">{money(row.net_sales)}</td>
                          </tr>
                        ))}
                        {users.length === 0 && (
                          <tr><td colSpan={4} className="p-8 text-center text-slate-500">Belum ada data pengguna.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-6">
                    <div>
                      <h2 data-hp-v6-section="" className="text-lg font-bold">
                        Top 20 SKU Terlaris
                      </h2>

                      <p className="mt-1 text-sm text-slate-500">
                        Berdasarkan unit terjual pada periode terpilih.
                      </p>
                    </div>

                    <div className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium">
                      SKU Aktif: {integer(summary?.sku_count)}
                    </div>
                  </div>

                  <div className="w-full overflow-x-auto">
                    <table data-hp-v6-table="" className="w-full min-w-[900px] text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="p-4">No</th>
                          <th className="p-4">SKU</th>
                          <th className="p-4">Produk</th>
                          <th className="p-4 text-right">
                            Unit Terjual
                          </th>
                          <th className="p-4 text-right">
                            Unit Retur
                          </th>
                          <th className="p-4 text-right">
                            Sales/Day
                          </th>
                          <th className="p-4 text-right">
                            Penjualan Bersih
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {topSkus.map((row, index) => (
                          <tr
                            key={row.sku}
                            className="hover:bg-slate-50"
                          >
                            <td className="whitespace-nowrap p-4 text-slate-500">
                              {index + 1}
                            </td>

                            <td className="whitespace-nowrap p-4 font-semibold">
                              {row.sku}
                            </td>

                            <td className="max-w-[320px] p-4">
                              <span className="line-clamp-2">
                                {row.product_name || "-"}
                              </span>
                            </td>

                            <td className="whitespace-nowrap p-4 text-right font-semibold">
                              {integer(row.units_sold)}
                            </td>

                            <td className="whitespace-nowrap p-4 text-right">
                              {integer(row.units_returned)}
                            </td>

                            <td className="whitespace-nowrap p-4 text-right">
                              {decimal(row.sales_velocity)}
                            </td>

                            <td className="whitespace-nowrap p-4 text-right">
                              {money(row.net_sales)}
                            </td>
                          </tr>
                        ))}

                        {topSkus.length === 0 && (
                          <tr>
                            <td
                              colSpan={7}
                              className="p-10 text-center text-slate-500"
                            >
                              Belum ada data SKU.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <p className="mt-6 text-xs leading-6 text-slate-500">
                  Sumber: laporan penjualan iSeller.
                  Penjualan bersih mengikuti perhitungan
                  iSeller dan belum dikurangi HPP,
                  biaya marketplace, maupun iklan.
                  Data POS yang belum teridentifikasi
                  tetap dipisahkan dari Bazar/Event; Pengguna lama mungkin belum tersedia.
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// HIPRIMA V6.2.1 INTERACTIVE SALES CHART

function hpChannelColor(channel: string | null) {
  const key=(channel || "").toLowerCase();
  if(key.includes("tiktok")) return "#27243e";
  if(key.includes("shopee")) return "#ea580c";
  if(key.includes("bazar") || key.includes("event")) return "#8b5cf6";
  if(key.includes("offline")) return "#0d9488";
  if(key.includes("whatsapp")) return "#16a34a";
  if(key.includes("tokopedia")) return "#15803d";
  if(key.includes("lazada")) return "#4f46e5";
  return "#64748b";
}

function HPInteractiveSalesChart({
  rows,metric
}:{
  rows:DailyRow[];
  metric:ChartMetric;
}){
  const [active,setActive]=useState<number|null>(null);

  if(!rows.length)
    return <p className="p-8 text-center text-slate-500">
      Belum ada data penjualan.
    </p>;

  const values=rows.map(r=>num(r[metric]));
  const isMoney=metric==="net_sales";
  const color=isMoney?"#6554ce":"#0d9488";
  const label=isMoney?"Penjualan Bersih":"Unit Terjual";

  const W=800,L=84,R=780,T=30,B=270;
  const min=Math.min(0,...values);
  const max=Math.max(0,...values);
  const raw=Math.max(1,max-min)/4;
  const magnitude=Math.pow(10,Math.floor(Math.log10(raw)));
  const step=Math.ceil(raw/magnitude)*magnitude;
  const low=Math.floor(min/step)*step;
  const high=Math.max(low+step,Math.ceil(max/step)*step);

  const x=(i:number)=>rows.length===1
    ?(L+R)/2:L+i*(R-L)/(rows.length-1);

  const y=(v:number)=>B-(v-low)/(high-low)*(B-T);

  const points=values.map((v,i)=>x(i)+","+y(v)).join(" ");

  const area="M "+x(0)+" "+y(0)+" "+
    values.map((v,i)=>"L "+x(i)+" "+y(v)).join(" ")+
    " L "+x(values.length-1)+" "+y(0)+" Z";

  const ticks=Array.from({
    length:Math.round((high-low)/step)+1
  },(_,i)=>low+i*step);

  const selected=active===null?null:
    Math.max(0,Math.min(active,rows.length-1));

  const compact=new Intl.NumberFormat("id-ID",{
    notation:"compact",maximumFractionDigits:1
  });

  function pick(clientX:number,rect:DOMRect){
    if(rect.width<=0) return;
    const px=(clientX-rect.left)/rect.width*W;
    const ratio=Math.max(0,Math.min(1,(px-L)/(R-L)));
    setActive(Math.round(ratio*(rows.length-1)));
  }

  return (
    <div className="w-full min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span style={{color}}>{label}</span>
        <span>Geser untuk melihat nilai</span>
      </div>

      <div className="relative w-full"
        role="group"
        aria-label="Grafik interaktif. Gunakan tombol panah untuk memilih tanggal."
        tabIndex={0}
        onFocus={()=>setActive(v=>v??0)}
        onBlur={()=>setActive(null)}
        onKeyDown={e=>{
          if(e.key==="ArrowLeft"||e.key==="ArrowRight"){
            e.preventDefault();
            setActive(v=>Math.max(0,Math.min(
              rows.length-1,(v??0)+(e.key==="ArrowRight"?1:-1)
            )));
          }
          if(e.key==="Escape") setActive(null);
        }}>

        <svg viewBox="0 0 800 300"
          className="block w-full select-none"
          style={{height:"auto",touchAction:"pan-y",cursor:"crosshair"}}
          onPointerMove={e=>pick(e.clientX,e.currentTarget.getBoundingClientRect())}
          onPointerDown={e=>pick(e.clientX,e.currentTarget.getBoundingClientRect())}
          onPointerLeave={e=>{
            if(e.pointerType==="mouse") setActive(null);
          }}>

          <defs>
            <linearGradient id="hp-sales-gradient"
              x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity=".32"/>
              <stop offset="100%" stopColor={color} stopOpacity=".02"/>
            </linearGradient>
          </defs>

          {ticks.map(v=>(
            <g key={v}>
              <line x1={L} x2={R} y1={y(v)} y2={y(v)}
                stroke="#e2e5ef" strokeDasharray="5 5"/>
              <text x={L-10} y={y(v)+4}
                textAnchor="end" fontSize="12" fill="#64748b">
                {isMoney?"Rp ":""}{compact.format(v)}
              </text>
            </g>
          ))}

          <path d={area} fill="url(#hp-sales-gradient)"/>

          <polyline points={points}
            fill="none" stroke={color} strokeWidth="3"
            strokeLinejoin="round" strokeLinecap="round"
            vectorEffect="non-scaling-stroke"/>

          {values.map((v,i)=>(
            <circle key={i} cx={x(i)} cy={y(v)}
              r={rows.length>40?2:3.5}
              fill={color} stroke="white" strokeWidth="1.5"/>
          ))}

          {selected!==null && (
            <g>
              <line x1={x(selected)} x2={x(selected)}
                y1={T} y2={B} stroke={color}
                strokeDasharray="5 4"/>
              <circle cx={x(selected)} cy={y(values[selected])}
                r="12" fill={color} opacity=".15"/>
              <circle cx={x(selected)} cy={y(values[selected])}
                r="6" fill={color} stroke="white" strokeWidth="2.5"/>
            </g>
          )}
        </svg>

        {selected!==null && (
          <div className="pointer-events-none absolute top-0 z-10 w-max max-w-[90%] rounded-xl bg-violet-950 px-4 py-3 text-white shadow-lg"
            style={{
              left:Math.max(25,Math.min(75,x(selected)/W*100))+"%",
              transform:"translateX(-50%)"
            }}>
            <div className="text-xs text-violet-200">
              {dateLabel(rows[selected].sale_date)}
            </div>
            <div className="mt-1 text-xs">{label}</div>
            <div className="mt-1 text-base font-bold">
              {isMoney?money(values[selected]):integer(values[selected])+" pcs"}
            </div>
          </div>
        )}
      </div>

      <div aria-live="polite"
        className="min-h-9 py-2 text-center text-xs font-medium text-violet-800">
        {selected!==null
          ?dateLabel(rows[selected].sale_date)+" - "+
            (isMoney?money(values[selected]):integer(values[selected])+" pcs")
          :""}
      </div>
    </div>
  );
}
