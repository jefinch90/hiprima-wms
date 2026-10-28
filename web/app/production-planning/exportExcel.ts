import type {
  SheetData,
  Row,
  Cell
} from "write-excel-file/browser";

type Num = string | number | null;

export type ProductionExportRow = {
  sku_master: string;
  product_name: string;
  color: string | null;
  size: string | null;
  abc_class: string;
  sales_trend: string;
  forecast_quality: string;
  sold_7: Num;
  sold_30: Num;
  sold_90: Num;
  velocity_7: Num;
  velocity_30: Num;
  velocity_90: Num;
  forecast_daily: Num;
  safety_days: number;
  reorder_point_units: Num;
  target_stock_position_units: Num;
  planning_status: string;
  vendor_name?: string | null;
  vendor_review_status?: string | null;
  vendor_lead_time_days?: Num;
  effective_lead_time_days?: Num;
  lead_time_source?: string | null;
  vendor_lifecycle_status?: string | null;
  vendor_moq_type?: string | null;
  vendor_moq_quantity?: Num;
  moq_note?: string | null;
  production_policy?: string | null;
};

type ExportOptions = {
  rows: ProductionExportRow[];
  asOfDate: string;
  leadDays: number;
  reviewDays: number;
  mappingPercent: number;
  unmappedUnits: number;
};

const headers = [
  "SKU Master",
  "Nama Produk",
  "Nama Vendor",
  "Lead Time Digunakan (Hari)",
  "Sumber Lead Time",
  "Lifecycle",
  "MOQ",
  "Kebijakan Produksi",
  "Warna",
  "Size",
  "ABC",
  "Tren",
  "Kualitas Forecast",
  "Sales 7 Hari",
  "Sales 30 Hari",
  "Sales 90 Hari",
  "Velocity 7 Hari",
  "Velocity 30 Hari",
  "Velocity 90 Hari",
  "Forecast / Hari",
  "Safety Stock (Hari)",
  "Reorder Point (Pcs)",
  "Target Posisi Stok (Pcs)",
  "Status Planning"
];

const widths = [
  23, 43, 19, 16, 22, 18, 25, 29, 19, 14, 9, 22,
  22, 16, 16, 16, 19, 19,
  19, 19, 21, 24, 28, 34
];

function number(value: Num | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function safeText(value: unknown): string {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function banner(
  value: string,
  backgroundColor: string,
  textColor: string
): Row {
  return [
    {
      value,
      columnSpan: headers.length,
      backgroundColor,
      textColor,
      fontWeight: "bold",
      fontSize: 11,
      height: 30,
      alignVertical: "center"
    },
    ...Array.from(
      { length: headers.length - 1 },
      () => null
    )
  ];
}

export async function exportProductionExcel(
  options: ExportOptions
): Promise<void> {

  const { default: writeExcelFile } =
    await import("write-excel-file/browser");

  const data: SheetData = [];

  data.push(
    banner(
      "HI.PRIMA | FASHION PRODUCTION PLANNING",
      "#111B34",
      "#FFFFFF"
    )
  );

  data.push(
    banner(
      "Sales sampai: " + options.asOfDate +
      "  |  Lead Time: " + options.leadDays +
      " hari  |  Review: " + options.reviewDays +
      " hari",
      "#E9EFF7",
      "#1E293B"
    )
  );

  data.push(
    banner(
      "SKU: " + options.rows.length +
      "  |  Mapping: " + options.mappingPercent +
      "%  |  Unmapped: " + options.unmappedUnits +
      " pcs",
      "#E9EFF7",
      "#1E293B"
    )
  );

  data.push(
    banner(
      "SIMULATION / DRAFT — Bukan instruksi produksi. " +
      "Stok dan incoming belum diverifikasi.",
      "#FFF2D5",
      "#92400E"
    )
  );

  const headerRow: Row = headers.map(
    (value): Cell => ({
      value,
      fontWeight: "bold",
      backgroundColor: "#1E355B",
      textColor: "#FFFFFF",
      height: 36,
      wrap: true,
      alignVertical: "center"
    })
  );

  data.push(headerRow);

  for (const [index, item] of options.rows.entries()) {
    const trend =
      item.sales_trend === "RISING" ? "Naik" :
      item.sales_trend === "STABLE" ? "Stabil" :
      item.sales_trend === "DECLINING" ? "Turun" :
      "Tidak ada penjualan baru";

    const quality =
      item.forecast_quality === "NORMAL" ? "Normal" :
      item.forecast_quality === "LOW_VOLUME"
        ? "Volume Rendah" : "Histori Terbatas";

    const values: (string | number)[] = [
      item.sku_master,
      item.product_name,
      item.vendor_name ?? "Belum Verified",
      number(item.effective_lead_time_days),
      item.lead_time_source === "VERIFIED_VENDOR"
        ? "Vendor Verified" : "Asumsi / Cadangan",
      item.vendor_lifecycle_status ?? "Perlu Review",
      item.vendor_moq_type === "PER_PRODUCT"
        ? String(number(item.vendor_moq_quantity)) + " pcs/model"
        : item.vendor_moq_type === "PER_COLOR"
          ? String(number(item.vendor_moq_quantity)) + " pcs/warna"
          : item.vendor_moq_type === "BY_REQUEST"
            ? "By Request" : "Belum Ditentukan",
      item.production_policy ?? "Perlu Review",
      item.color ?? "",
      item.size ?? "",
      item.abc_class,
      trend,
      quality,
      number(item.sold_7),
      number(item.sold_30),
      number(item.sold_90),
      number(item.velocity_7),
      number(item.velocity_30),
      number(item.velocity_90),
      number(item.forecast_daily),
      number(item.safety_days),
      number(item.reorder_point_units),
      number(item.target_stock_position_units),
      item.planning_status
    ];

    const backgroundColor =
      index % 2 === 0 ? "#FFFFFF" : "#F1F5F9";

    const row: Row = values.map((value, col): Cell => {
      if (typeof value === "number") {
        return {
          value,
          type: Number,
          format:
            col >= 16 && col <= 19
              ? "#,##0.00"
              : "#,##0",
          backgroundColor,
          textColor: "#253249",
          align: "right",
          height: 26
        };
      }

      return {
        value: safeText(value),
        type: String,
        format: "@",
        backgroundColor,
        textColor: "#253249",
        height: 26,
        ...(col === 0
          ? { fontWeight: "bold" as const }
          : {})
      };
    });

    data.push(row);
  }

  const filename =
    "HiPRIMA_Production_Planning_" +
    options.asOfDate +
    "_LT" + options.leadDays +
    "_Review" + options.reviewDays +
    ".xlsx";

  await writeExcelFile(data, {
    sheet: "Production Planning",
    columns: widths.map(width => ({ width })),
    stickyRowsCount: 5,
    stickyColumnsCount: 1,
    showGridLines: false,
    orientation: "landscape"
  }).toFile(filename);
}
