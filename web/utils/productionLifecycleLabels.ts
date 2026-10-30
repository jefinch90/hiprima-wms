// UI-only labels: keep raw lifecycle values intact for Supabase, policy and filters.
export function lifecycleLabel(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  switch (raw.toLocaleLowerCase("id-ID")) {
    case "on produksi": return "Aktif (Regular)";
    case "hold": return "Ditunda (On Hold)";
    case "seasonal": return "Musiman (Seasonal)";
    case "discontinue": return "Dihentikan (Discontinued)";
    default: return raw || "Belum terverifikasi";
  }
}