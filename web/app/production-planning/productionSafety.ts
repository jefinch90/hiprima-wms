export type ProductionSafetyItem = {
  production_policy?: string | null;
  vendor_lifecycle_status?: string | null;
};

export function productionIsRestricted(
  item: ProductionSafetyItem
): boolean {
  const policy = String(item.production_policy ?? "").toUpperCase();
  const lifecycle = String(item.vendor_lifecycle_status ?? "").toUpperCase();

  return (
    ["BLOCKED_HOLD", "BLOCKED_DISCONTINUE",
      "SEASONAL_APPROVAL_REQUIRED"].includes(policy) ||
    ["HOLD", "DISCONTINUE", "SEASONAL"].includes(lifecycle)
  );
}

export function productionPolicyLabel(
  item: ProductionSafetyItem
): string {
  const policy = String(item.production_policy ?? "").toUpperCase();
  const lifecycle = String(item.vendor_lifecycle_status ?? "").toUpperCase();

  if (policy === "BLOCKED_HOLD" || lifecycle === "HOLD") {
    return "PRODUKSI DIBLOKIR - HOLD";
  }
  if (policy === "BLOCKED_DISCONTINUE" || lifecycle === "DISCONTINUE") {
    return "PRODUKSI DIBLOKIR - DISCONTINUE";
  }
  if (policy === "SEASONAL_APPROVAL_REQUIRED" || lifecycle === "SEASONAL") {
    return "SEASONAL - PERLU APPROVAL";
  }
  if (policy === "ACTIVE_SIMULATION_ONLY") {
    return "SIMULASI AKTIF - BUKAN PO";
  }
  return "PERLU REVIEW - SIMULASI SAJA";
}

export function exportSafeTarget(
  item: ProductionSafetyItem,
  value: unknown
): number | "" {
  if (productionIsRestricted(item)) return "";
  if (value === null || value === undefined || value === "") return "";

  const result = Number(value);
  return Number.isFinite(result) ? result : "";
}