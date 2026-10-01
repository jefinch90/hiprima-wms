"use client";

import { appAlert, appConfirm } from "@/utils/appDialog";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";
import CycleCountVarianceEditor from "@/components/stock-opname/CycleCountVarianceEditor";

type SessionDetail = {
  session_id: string;
  session_code: string;
  opname_type: string;
  status: string;
  notes: string | null;
  total_locations: number;
  completed_locations: number;
  total_lines: number;
  counted_lines: number;
  variance_lines: number;
  progress_percent: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  started_at: string | null;
  submitted_at: string | null;
  finalized_by: string | null;
  finalized_at: string | null;
  adjustment_lines: number;
  qty_adjustment_in: number;
  qty_adjustment_out: number;
};

type RackRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  total_lines: number;
  counted_lines: number;
  variance_lines: number;
  progress_percent: number;
  is_complete: boolean;
};

type CountLine = {
  line_id: string;
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  color: string | null;
  size: string | null;
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  system_qty: number;
  counted_qty: number | null;
  recount_qty: number | null;
  final_count_qty: number | null;
  variance: number | null;
  counted_by: string | null;
  counted_by_name: string | null;
  counted_at: string | null;
  recounted_by: string | null;
  recounted_by_name: string | null;
  recounted_at: string | null;
  total_count: number;
  variance_reason_category?: string | null;
  investigation_notes?: string | null;
};

type VarianceStatus = {
  pending_recount_lines: number;
  pending_reason_lines: number;
};

type SearchSkuRow = {
  variant_id: string;
  sku: string;
  product_code: string;
  product_name: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  total_qty: number | string;
};

const EDIT_ROLES = [
  "owner",
  "admin",
  "warehouse_manager",
  "warehouse_staff",
];

function formatNumber(
  value: number | string | null | undefined
) {
  return Number(value ?? 0).toLocaleString("id-ID");
}

function formatPrintDate(value: string | null | undefined) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function typeLabel(value: string) {
  return value === "cycle_count"
    ? "Cycle Count"
    : "Full Stock Opname";
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "Draft",
    counting: "Counting",
    review: "Review",
    finalized: "Finalized",
    cancelled: "Cancelled",
  };

  return labels[value] ?? value;
}

export default function StockOpnameCountingPage() {
  const router = useRouter();

  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [sessionId, setSessionId] =
    useState("");

  const [role, setRole] =
    useState("");

  const [session, setSession] =
    useState<SessionDetail | null>(null);

  const [racks, setRacks] =
    useState<RackRow[]>([]);

  const [activeRackId, setActiveRackId] =
    useState("");

  const [rackSearch, setRackSearch] =
    useState("");

  const [lines, setLines] =
    useState<CountLine[]>([]);

  const [lineSearch, setLineSearch] =
    useState("");

  const [draftCounts, setDraftCounts] =
    useState<Record<string, string>>({});

  const [savingLineId, setSavingLineId] =
    useState<string | null>(null);

  const [lastSavedLineId, setLastSavedLineId] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [loadingLines, setLoadingLines] =
    useState(false);

  const [submitting, setSubmitting] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [varianceStatus, setVarianceStatus] =
    useState<VarianceStatus | null>(null);

  const [showAddSku, setShowAddSku] =
    useState(false);

  const [skuSearch, setSkuSearch] =
    useState("");

  const [skuResults, setSkuResults] =
    useState<SearchSkuRow[]>([]);

  const [searchingSku, setSearchingSku] =
    useState(false);

  const [addingVariantId, setAddingVariantId] =
    useState<string | null>(null);

  const canCount =
    EDIT_ROLES.includes(role) &&
    !!session &&
    (session.opname_type === "cycle_count" || role !== "warehouse_staff") &&
    ["draft", "counting"].includes(
      session.status
    );

  const isCycleCount = session?.opname_type === "cycle_count";

  const activeRack =
    racks.find(
      (item) =>
        item.location_id === activeRackId
    ) ?? null;

  const filteredRacks =
    useMemo(() => {
      const keyword =
        rackSearch.trim().toLowerCase();

      if (!keyword) {
        return racks;
      }

      return racks.filter((item) =>
        [
          item.location_code,
          item.location_name,
          item.area_code,
          item.area_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(keyword)
      );
    }, [racks, rackSearch]);

  const loadSummary = useCallback(
    async (id: string) => {
      const [
        sessionResult,
        racksResult,
      ] = await Promise.all([
        supabase.rpc(
          "get_stock_opname_session_detail",
          {
            p_session_id: id,
          }
        ),

        supabase.rpc(
          "get_stock_opname_racks",
          {
            p_session_id: id,
          }
        ),
      ]);

      if (sessionResult.error) {
        throw sessionResult.error;
      }

      if (racksResult.error) {
        throw racksResult.error;
      }

      const sessionRow =
        ((sessionResult.data ??
          [])[0] as
          | SessionDetail
          | undefined) ?? null;

      const rackRows =
        (racksResult.data ??
          []) as RackRow[];

      if (sessionRow?.opname_type === "cycle_count") {
        const { data: statusData, error: statusError } = await supabase.rpc(
          "get_cycle_count_variance_status", { p_session_id: id }
        );
        if (statusError) throw statusError;
        setVarianceStatus((statusData ?? [])[0] as VarianceStatus ?? null);
      } else {
        setVarianceStatus(null);
      }

      setSession(sessionRow);
      setRacks(rackRows);

      return {
        sessionRow,
        rackRows,
      };
    },
    [supabase]
  );

  const loadLines = useCallback(
    async (
      id: string,
      locationId: string,
      search = ""
    ) => {
      setLoadingLines(true);
      setErrorMessage("");

      const { data, error } =
        await supabase.rpc(
          "get_stock_opname_lines_by_rack",
          {
            p_session_id: id,
            p_location_id:
              locationId,
            p_search:
              search.trim() ||
              null,
            p_limit: 500,
            p_offset: 0,
          }
        );

      if (error) {
        setLines([]);
        setDraftCounts({});
        setErrorMessage(
          error.message
        );
        setLoadingLines(false);
        return;
      }

      let rows = (data ?? []) as CountLine[];
      if (rows.length > 0) {
        const { data: reasonData, error: reasonError } = await supabase.rpc(
          "get_cycle_count_line_reasons", { p_line_ids: rows.map((row) => row.line_id) }
        );
        if (reasonError) {
          setErrorMessage(reasonError.message);
          setLoadingLines(false);
          return;
        }
        const reasons = new Map(
          ((reasonData ?? []) as CountLine[]).map((row) => [row.line_id, row])
        );
        rows = rows.map((row) => ({ ...row, ...reasons.get(row.line_id) }));
      }

      const nextDrafts:
        Record<string, string> = {};

      for (const row of rows) {
        nextDrafts[row.line_id] =
          row.counted_qty === null
            ? ""
            : String(
                row.counted_qty
              );
      }

      setLines(rows);
      setDraftCounts(nextDrafts);
      setLoadingLines(false);
    },
    [supabase]
  );

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const id =
      params.get("session") ?? "";

    async function init() {
      if (!id) {
        setErrorMessage("Session Stock Opname tidak ditemukan.");
        setLoading(false);
        return;
      }
      setSessionId(id);
      try {
        const {
          data: { user },
        } =
          await supabase.auth.getUser();

        if (!user) {
          router.replace(
            "/login"
          );
          return;
        }

        const {
          data: profile,
          error: profileError,
        } = await supabase
          .from("profiles")
          .select(
            "role, is_active"
          )
          .eq("id", user.id)
          .single();

        if (
          profileError ||
          !profile ||
          profile.is_active !== true
        ) {
          await supabase.auth.signOut();

          router.replace(
            "/login"
          );

          return;
        }

        setRole(profile.role);

        const {
          rackRows,
        } =
          await loadSummary(id);

        const firstRack =
          rackRows.find(
            (item) =>
              item.total_lines >
                0 &&
              !item.is_complete
          ) ??
          rackRows.find(
            (item) =>
              item.total_lines >
              0
          ) ??
          rackRows[0] ??
          null;

        if (firstRack) {
          setActiveRackId(
            firstRack.location_id
          );

          await loadLines(
            id,
            firstRack.location_id
          );
        }

        setLoading(false);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Gagal membuka Stock Opname."
        );

        setLoading(false);
      }
    }

    void Promise.resolve().then(init);
  }, [
    loadLines,
    loadSummary,
    router,
    supabase,
  ]);

  async function selectRack(
    rackId: string
  ) {
    if (!sessionId) return;

    setActiveRackId(rackId);
    setLineSearch("");
    setShowAddSku(false);
    setSkuSearch("");
    setSkuResults([]);

    await loadLines(
      sessionId,
      rackId
    );
  }

  async function saveCount(
    line: CountLine
  ) {
    if (
      !canCount ||
      savingLineId
    ) {
      return;
    }

    const raw =
      draftCounts[
        line.line_id
      ] ?? "";

    if (raw.trim() === "") {
      return;
    }

    const qty = Number(raw);

    if (
      !Number.isInteger(qty) ||
      qty < 0
    ) {
      setErrorMessage(
        `Qty fisik ${line.sku} harus angka bulat 0 atau lebih.`
      );

      return;
    }

    if (
      line.counted_qty !==
        null &&
      Number(line.counted_qty) ===
        qty
    ) {
      return;
    }

    setErrorMessage("");
    setSavingLineId(
      line.line_id
    );

    const wasCounted =
      line.counted_qty !==
      null;

    const { error } =
      await supabase.rpc(
        "save_stock_opname_count",
        {
          p_session_id:
            sessionId,
          p_variant_id:
            line.variant_id,
          p_location_id:
            line.location_id,
          p_counted_qty: qty,
        }
      );

    if (error) {
      setErrorMessage(
        error.message
      );

      setSavingLineId(null);
      return;
    }

    setLines((current) =>
      current.map((item) =>
        item.line_id ===
        line.line_id
          ? {
              ...item,
              counted_qty: qty,
              recount_qty: null,
              variance_reason_category: null,
              investigation_notes: null,
            }
          : item
      )
    );

    if (!wasCounted) {
      setSession((current) =>
        current
          ? {
              ...current,
              status:
                current.status ===
                "draft"
                  ? "counting"
                  : current.status,

              counted_lines:
                Number(
                  current.counted_lines
                ) + 1,

              progress_percent:
                current.total_lines >
                0
                  ? Math.round(
                      ((Number(
                        current.counted_lines
                      ) +
                        1) /
                        Number(
                          current.total_lines
                        )) *
                        1000
                    ) / 10
                  : 0,
            }
          : current
      );

      setRacks((current) =>
        current.map((rack) => {
          if (
            rack.location_id !==
            line.location_id
          ) {
            return rack;
          }

          const counted =
            Number(
              rack.counted_lines
            ) + 1;

          return {
            ...rack,
            counted_lines:
              counted,

            progress_percent:
              rack.total_lines >
              0
                ? Math.round(
                    (counted /
                      Number(
                        rack.total_lines
                      )) *
                      1000
                  ) / 10
                : 0,

            is_complete:
              rack.total_lines >
                0 &&
              counted >=
                Number(
                  rack.total_lines
                ),
          };
        })
      );
    }

    setLastSavedLineId(
      line.line_id
    );

    if (session?.opname_type === "cycle_count") {
      const { data: statusData } = await supabase.rpc(
        "get_cycle_count_variance_status", { p_session_id: sessionId }
      );
      setVarianceStatus((statusData ?? [])[0] as VarianceStatus ?? null);
    }

    setSavingLineId(null);

    window.setTimeout(() => {
      setLastSavedLineId(
        (current) =>
          current ===
          line.line_id
            ? null
            : current
      );
    }, 1200);
  }

  function handleCountKeyDown(
    event: KeyboardEvent<HTMLInputElement>
  ) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    const current =
      event.currentTarget;

    current.blur();

    window.setTimeout(() => {
      const inputs =
        Array.from(
          document.querySelectorAll<HTMLInputElement>(
            '[data-count-input="true"]:not(:disabled)'
          )
        );

      const index =
        inputs.indexOf(
          current
        );

      if (
        index >= 0 &&
        index <
          inputs.length - 1
      ) {
        inputs[
          index + 1
        ].focus();

        inputs[
          index + 1
        ].select();
      }
    }, 100);
  }

  async function handleLineSearch(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (
      !sessionId ||
      !activeRackId
    ) {
      return;
    }

    await loadLines(
      sessionId,
      activeRackId,
      lineSearch
    );
  }

  async function resetLineSearch() {
    setLineSearch("");

    if (
      sessionId &&
      activeRackId
    ) {
      await loadLines(
        sessionId,
        activeRackId
      );
    }
  }

  async function handleSkuSearch(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const search =
      skuSearch.trim();

    if (!search) {
      setSkuResults([]);
      return;
    }

    setSearchingSku(true);
    setErrorMessage("");

    const { data, error } =
      await supabase.rpc(
        "search_adjustment_skus",
        {
          p_search: search,
          p_limit: 15,
        }
      );

    if (error) {
      setErrorMessage(
        error.message
      );

      setSkuResults([]);
      setSearchingSku(false);
      return;
    }

    setSkuResults(
      (data ??
        []) as SearchSkuRow[]
    );

    setSearchingSku(false);
  }

  async function addSkuToRack(
    variantId: string
  ) {
    if (
      !sessionId ||
      !activeRackId ||
      !canCount
    ) {
      return;
    }

    setAddingVariantId(
      variantId
    );

    setErrorMessage("");

    const { error } =
      await supabase.rpc(
        "add_stock_opname_line",
        {
          p_session_id:
            sessionId,
          p_variant_id:
            variantId,
          p_location_id:
            activeRackId,
        }
      );

    if (error) {
      setErrorMessage(
        error.message
      );

      setAddingVariantId(null);
      return;
    }

    setSkuSearch("");
    setSkuResults([]);
    setShowAddSku(false);
    setAddingVariantId(null);

    try {
      await loadSummary(
        sessionId
      );

      await loadLines(
        sessionId,
        activeRackId
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "SKU berhasil ditambahkan, tetapi refresh gagal."
      );
    }
  }

  function printCountSheet() {
    if (!session || !activeRack || lines.length === 0) {
      return;
    }

    window.print();
  }

  async function submitForReview() {
    if (
      !session ||
      !sessionId ||
      !canCount
    ) {
      return;
    }

    if (
      Number(
        session.counted_lines
      ) !==
      Number(
        session.total_lines
      )
    ) {
      setErrorMessage(
        "Masih ada SKU yang belum dihitung."
      );

      return;
    }

    if (session.opname_type === "cycle_count" &&
      (Number(varianceStatus?.pending_recount_lines ?? 0) > 0 ||
       Number(varianceStatus?.pending_reason_lines ?? 0) > 0)) {
      setErrorMessage("Selesaikan Recount dan Alasan Selisih sebelum kirim ke Review.");
      return;
    }

    const confirmed =
      await appConfirm(
        [
          "Kirim Stock Opname ke Review?",
          "",
          `Session: ${session.session_code}`,
          `SKU dihitung: ${formatNumber(
            session.counted_lines
          )}`,
          "",
          "Setelah dikirim, first count tidak dapat diedit lagi.",
        ].join("\n")
      );

    if (!confirmed) {
      return;
    }

    setSubmitting(true);
    setErrorMessage("");

    const { error } =
      await supabase.rpc(
        "submit_stock_opname",
        {
          p_session_id:
            sessionId,
        }
      );

    if (error) {
      setErrorMessage(
        error.message
      );

      setSubmitting(false);
      return;
    }

    try {
      await loadSummary(
        sessionId
      );

      if (activeRackId) {
        await loadLines(
          sessionId,
          activeRackId
        );
      }
    } catch {
      // Session already submitted.
    }

    setSubmitting(false);

    await appAlert(
      [
        "Counting Selesai",
        "",
        "Stock Opname sudah dikirim ke Review.",
        "Stok inventory BELUM berubah.",
      ].join("\n")
    );

    router.replace(
      `/stock-opname/review?session=${encodeURIComponent(
        sessionId
      )}`
    );

    router.refresh();
  }

  const completedRackCount =
    racks.filter(
      (rack) => rack.is_complete
    ).length;

  const allCounted =
    !!session &&
    Number(
      session.total_lines
    ) > 0 &&
    Number(
      session.counted_lines
    ) ===
      Number(
        session.total_lines
      );

  const cycleInvestigationComplete =
    session?.opname_type !== "cycle_count" ||
    (varianceStatus !== null &&
      Number(varianceStatus.pending_recount_lines) === 0 &&
      Number(varianceStatus.pending_reason_lines) === 0);

  async function refreshInvestigation(locationId: string) {
    await loadSummary(sessionId);
    await loadLines(sessionId, locationId, lineSearch);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="flex min-h-screen">
          <Sidebar />

          <main className="flex-1 p-6 md:p-10">
            <div className="mx-auto max-w-[1500px] rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              Loading Stock Opname...
            </div>
          </main>
        </div>
      </div>
    );
  }

  const printPetugas =
    lines.find((line) => line.counted_by_name)?.counted_by_name ??
    session?.created_by_name ??
    "";

  const printDate =
    session?.started_at ??
    lines.find((line) => line.counted_at)?.counted_at ??
    session?.created_at ??
    null;

  return (
    <>
      <div className="screen-only min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
        <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-4 pb-28 sm:p-6 sm:pb-28 md:p-10 md:pb-28">
          <div className="mx-auto w-full min-w-0 max-w-[1500px]">
            <header className="mb-6">
              <p className="text-sm text-slate-500">
                Stock Opname
              </p>

              <div className="mt-1 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold sm:text-3xl">
                      {session?.session_code ??
                        "Counting"}
                    </h1>

                    {session && (
                      <span className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                        {statusLabel(
                          session.status
                        )}
                      </span>
                    )}
                  </div>

                  {session && (
                    <p className="mt-2 text-sm text-slate-500">
                      {typeLabel(
                        session.opname_type
                      )}
                      {" • "}
                      {formatNumber(
                        session.counted_lines
                      )}
                      /
                      {formatNumber(
                        session.total_lines
                      )}{" "}
                      SKU selesai
                    </p>
                  )}
                </div>

                <Link
                  href="/stock-opname"
                  className="shrink-0 rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium"
                >
                  Back
                </Link>
              </div>
            </header>

            {session && (
              <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      Progress Counting
                    </div>

                    <div className="mt-1 text-xs text-slate-500">
                      {formatNumber(
                        completedRackCount
                      )}
                      /
                      {formatNumber(
                        session.total_locations
                      )}{" "}
                      rack selesai
                    </div>
                  </div>

                  <div className="text-2xl font-bold">
                    {Number(
                      session.progress_percent ??
                        0
                    )}
                    %
                  </div>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-900 transition-all"
                    style={{
                      width: `${Math.min(
                        Number(
                          session.progress_percent ??
                            0
                        ),
                        100
                      )}%`,
                    }}
                  />
                </div>
              </section>
            )}

            {errorMessage && (
              <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            {session &&
              session.status ===
                "review" && (
                <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-5">
                  <div className="font-semibold text-blue-900">
                    Counting sudah selesai
                  </div>

                  <p className="mt-1 text-sm text-blue-800">
                    Session ini sudah masuk tahap Review.
                    Inventory belum berubah.
                  </p>
                </div>
              )}

            <div className="grid min-w-0 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
              <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-4">
                  <div className="font-semibold">
                    Rack
                  </div>

                  <input
                    value={rackSearch}
                    onChange={(event) =>
                      setRackSearch(
                        event.target.value
                      )
                    }
                    placeholder="Cari rack..."
                    className="mt-3 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
                  />
                </div>

                <div className="hidden max-h-[60vh] overflow-y-auto lg:block">
                  {filteredRacks.map(
                    (rack) => {
                      const active =
                        rack.location_id ===
                        activeRackId;

                      return (
                        <button
                          key={
                            rack.location_id
                          }
                          type="button"
                          onClick={() =>
                            selectRack(
                              rack.location_id
                            )
                          }
                          className={
                            active
                              ? "flex w-full items-center justify-between gap-3 border-b border-slate-100 bg-slate-900 p-4 text-left text-white"
                              : "flex w-full items-center justify-between gap-3 border-b border-slate-100 p-4 text-left hover:bg-slate-50"
                          }
                        >
                          <div className="min-w-0">
                            <div className="font-semibold">
                              {
                                rack.location_code
                              }
                            </div>

                            <div
                              className={
                                active
                                  ? "mt-1 truncate text-xs text-slate-300"
                                  : "mt-1 truncate text-xs text-slate-500"
                              }
                            >
                              {
                                rack.area_name
                              }
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            <div className="text-xs font-semibold">
                              {rack.total_lines ===
                              0
                                ? "Kosong"
                                : rack.is_complete
                                  ? "✓ Selesai"
                                  : `${formatNumber(
                                      rack.counted_lines
                                    )}/${formatNumber(
                                      rack.total_lines
                                    )}`}
                            </div>
                          </div>
                        </button>
                      );
                    }
                  )}
                </div>

                <div className="p-4 lg:hidden">
                  <select
                    value={activeRackId}
                    onChange={(event) =>
                      selectRack(
                        event.target
                          .value
                      )
                    }
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  >
                    {filteredRacks.map(
                      (rack) => (
                        <option
                          key={
                            rack.location_id
                          }
                          value={
                            rack.location_id
                          }
                        >
                          {
                            rack.location_code
                          }{" "}
                          —{" "}
                          {rack.total_lines ===
                          0
                            ? "Kosong"
                            : `${rack.counted_lines}/${rack.total_lines}`}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </section>

              <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {!activeRack ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    Pilih rack untuk mulai counting.
                  </div>
                ) : (
                  <>
                    <div className="border-b border-slate-200 p-4 sm:p-5">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Rack Aktif
                          </div>

                          <h2 className="mt-1 text-xl font-bold">
                            {
                              activeRack.location_code
                            }
                          </h2>

                          <p className="mt-1 text-sm text-slate-500">
                            {
                              activeRack.area_name
                            }
                            {" • "}
                            {formatNumber(
                              activeRack.counted_lines
                            )}
                            /
                            {formatNumber(
                              activeRack.total_lines
                            )}{" "}
                            SKU
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={printCountSheet}
                            disabled={lines.length === 0}
                            className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Print
                          </button>

                          {canCount && (
                            <button
                              type="button"
                              onClick={() =>
                                setShowAddSku(
                                  (value) =>
                                    !value
                                )
                              }
                              className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold"
                            >
                              + SKU tidak ada di daftar
                            </button>
                          )}
                        </div>
                      </div>

                      <form
                        onSubmit={
                          handleLineSearch
                        }
                        className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row"
                      >
                        <input
                          value={
                            lineSearch
                          }
                          onChange={(
                            event
                          ) =>
                            setLineSearch(
                              event.target
                                .value
                            )
                          }
                          placeholder="Cari SKU / produk..."
                          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
                        />

                        <button
                          type="submit"
                          className="shrink-0 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
                        >
                          Search
                        </button>

                        {lineSearch && (
                          <button
                            type="button"
                            onClick={
                              resetLineSearch
                            }
                            className="shrink-0 rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                          >
                            Reset
                          </button>
                        )}
                      </form>

                      {showAddSku &&
                        canCount && (
                          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
                            <div className="font-semibold">
                              Barang fisik tidak ada di daftar?
                            </div>

                            <p className="mt-1 text-xs text-slate-500">
                              Cari SKU lalu tambahkan ke rack ini.
                            </p>

                            <form
                              onSubmit={
                                handleSkuSearch
                              }
                              className="mt-3 flex flex-col gap-2 sm:flex-row"
                            >
                              <input
                                value={
                                  skuSearch
                                }
                                onChange={(
                                  event
                                ) =>
                                  setSkuSearch(
                                    event
                                      .target
                                      .value
                                  )
                                }
                                placeholder="Cari SKU..."
                                className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                              />

                              <button
                                type="submit"
                                disabled={
                                  searchingSku
                                }
                                className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                              >
                                {searchingSku
                                  ? "Searching..."
                                  : "Cari"}
                              </button>
                            </form>

                            {skuResults.length >
                              0 && (
                              <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                                {skuResults.map(
                                  (
                                    item
                                  ) => (
                                    <div
                                      key={
                                        item.variant_id
                                      }
                                      className="flex flex-col gap-3 border-b border-slate-100 p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                      <div className="min-w-0">
                                        <div className="font-semibold">
                                          {
                                            item.sku
                                          }
                                        </div>

                                        <div className="mt-1 truncate text-xs text-slate-500">
                                          {
                                            item.product_name
                                          }
                                          {item.color
                                            ? ` • ${item.color}`
                                            : ""}
                                          {item.size
                                            ? ` • ${item.size}`
                                            : ""}
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        disabled={
                                          addingVariantId ===
                                          item.variant_id
                                        }
                                        onClick={() =>
                                          addSkuToRack(
                                            item.variant_id
                                          )
                                        }
                                        className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                                      >
                                        {addingVariantId ===
                                        item.variant_id
                                          ? "Adding..."
                                          : "Tambah"}
                                      </button>
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        )}
                    </div>

                    {loadingLines ? (
                      <div className="p-10 text-center text-sm text-slate-500">
                        Loading SKU...
                      </div>
                    ) : lines.length ===
                      0 ? (
                      <div className="p-10 text-center">
                        <div className="font-semibold">
                          Tidak ada SKU
                        </div>

                        <p className="mt-2 text-sm text-slate-500">
                          Rack ini kosong atau hasil pencarian tidak ditemukan.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className={isCycleCount
                          ? "hidden max-h-[53vh] overflow-y-auto overflow-x-hidden md:block"
                          : "hidden max-h-[53vh] overflow-auto md:block"}>
                          <table className={isCycleCount
                            ? "w-full table-fixed text-left text-sm"
                            : "w-full min-w-[760px] text-left text-sm"}>
                            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                              <tr>
                                <th className={isCycleCount ? "w-[19%] px-3 py-4" : "px-5 py-4"}>
                                  SKU
                                </th>

                                <th className={isCycleCount ? "w-[38%] px-3 py-4" : "px-5 py-4"}>
                                  Produk
                                </th>

                                <th className={isCycleCount ? "w-[22%] px-3 py-4" : "px-5 py-4"}>
                                  Variant
                                </th>

                                <th className={isCycleCount ? "w-[21%] px-3 py-4 text-center" : "w-44 px-5 py-4 text-center"}>
                                  Fisik
                                </th>
                              </tr>
                            </thead>

                            <tbody className="divide-y divide-slate-100">
                              {lines.map(
                                (
                                  line
                                ) => (
                                  <Fragment key={line.line_id}>
                                  <tr
                                  >
                                    <td className={isCycleCount ? "break-all px-3 py-4 font-semibold" : "px-5 py-4 font-semibold"}>
                                      {
                                        line.sku
                                      }
                                    </td>

                                    <td className={isCycleCount ? "break-words px-3 py-4" : "px-5 py-4"}>
                                      <div className="font-medium">
                                        {
                                          line.product_name
                                        }
                                      </div>

                                      <div className="mt-1 text-xs text-slate-500">
                                        {
                                          line.product_code
                                        }
                                      </div>
                                    </td>

                                    <td className={isCycleCount ? "break-words px-3 py-4 text-slate-600" : "px-5 py-4 text-slate-600"}>
                                      {[
                                        line.color,
                                        line.size,
                                      ]
                                        .filter(
                                          Boolean
                                        )
                                        .join(
                                          " / "
                                        ) ||
                                        "-"}
                                    </td>

                                    <td className="px-5 py-3">
                                      <div className="relative flex min-h-11 items-center justify-center">
                                        <input
                                          data-count-input="true"
                                          type="number"
                                          min="0"
                                          step="1"
                                          inputMode="numeric"
                                          disabled={
                                            !canCount
                                          }
                                          value={
                                            draftCounts[
                                              line
                                                .line_id
                                            ] ??
                                            ""
                                          }
                                          onFocus={(
                                            event
                                          ) =>
                                            event.currentTarget.select()
                                          }
                                          onChange={(
                                            event
                                          ) =>
                                            setDraftCounts(
                                              (
                                                current
                                              ) => ({
                                                ...current,
                                                [line.line_id]:
                                                  event
                                                    .target
                                                    .value,
                                              })
                                            )
                                          }
                                          onBlur={() =>
                                            saveCount(
                                              line
                                            )
                                          }
                                          onKeyDown={
                                            handleCountKeyDown
                                          }
                                          placeholder="0"
                                          className="h-11 w-24 rounded-xl border border-slate-300 px-3 text-center text-base font-bold outline-none focus:border-slate-900 disabled:bg-slate-50"
                                        />

                                        <div className="absolute right-0 top-1/2 -translate-y-1/2 whitespace-nowrap text-xs">
                                          {savingLineId ===
                                          line.line_id ? (
                                            <span className="text-slate-400">
                                              Saving
                                            </span>
                                          ) : lastSavedLineId ===
                                            line.line_id ? (
                                            <span className="font-semibold text-emerald-600">
                                              ✓
                                            </span>
                                          ) : line.counted_qty !==
                                            null ? (
                                            <span className="font-semibold text-emerald-600">
                                              ✓
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  {session?.opname_type === "cycle_count" &&
                                    line.counted_qty !== null &&
                                    (line.counted_qty !== line.system_qty ||
                                      (line.recount_qty !== null && line.recount_qty !== line.system_qty)) && (
                                    <tr><td colSpan={4} className="px-3 pb-4">
                                      <CycleCountVarianceEditor key={`${line.line_id}:${line.counted_qty}:${line.recount_qty}:${line.variance_reason_category}:${line.investigation_notes}`} line={line} sessionId={sessionId}
                                        editable={canCount} onChanged={() => refreshInvestigation(line.location_id)} />
                                    </td></tr>
                                  )}
                                  </Fragment>
                                )
                              )}
                            </tbody>
                          </table>
                        </div>

                        <div className="max-h-[53vh] space-y-3 overflow-y-auto p-3 md:hidden">
                          {lines.map(
                            (
                              line
                            ) => (
                              <div
                                key={
                                  line.line_id
                                }
                                className="rounded-xl border border-slate-200 p-4"
                              >
                                <div className="font-semibold">
                                  {
                                    line.sku
                                  }
                                </div>

                                <div className="mt-1 text-sm">
                                  {
                                    line.product_name
                                  }
                                </div>

                                <div className="mt-1 text-xs text-slate-500">
                                  {[
                                    line.color,
                                    line.size,
                                  ]
                                    .filter(
                                      Boolean
                                    )
                                    .join(
                                      " / "
                                    ) ||
                                    "-"}
                                </div>

                                <div className="mt-4 flex items-center gap-3">
                                  <label className="text-xs font-semibold text-slate-500">
                                    Fisik
                                  </label>

                                  <input
                                    data-count-input="true"
                                    type="number"
                                    min="0"
                                    step="1"
                                    inputMode="numeric"
                                    disabled={
                                      !canCount
                                    }
                                    value={
                                      draftCounts[
                                        line
                                          .line_id
                                      ] ?? ""
                                    }
                                    onFocus={(
                                      event
                                    ) =>
                                      event.currentTarget.select()
                                    }
                                    onChange={(
                                      event
                                    ) =>
                                      setDraftCounts(
                                        (
                                          current
                                        ) => ({
                                          ...current,
                                          [line.line_id]:
                                            event
                                              .target
                                              .value,
                                        })
                                      )
                                    }
                                    onBlur={() =>
                                      saveCount(
                                        line
                                      )
                                    }
                                    onKeyDown={
                                      handleCountKeyDown
                                    }
                                    placeholder="0"
                                    className="h-12 w-28 rounded-xl border border-slate-300 px-3 text-right text-lg font-bold outline-none focus:border-slate-900 disabled:bg-slate-50"
                                  />

                                  {savingLineId ===
                                  line.line_id ? (
                                    <span className="text-xs text-slate-400">
                                      Saving...
                                    </span>
                                  ) : line.counted_qty !==
                                    null ? (
                                    <span className="text-sm font-semibold text-emerald-600">
                                      ✓ Saved
                                    </span>
                                  ) : null}
                                  </div>
                                  {session?.opname_type === "cycle_count" &&
                                    line.counted_qty !== null &&
                                    (line.counted_qty !== line.system_qty ||
                                      (line.recount_qty !== null && line.recount_qty !== line.system_qty)) && (
                                    <div className="mt-4">
                                      <CycleCountVarianceEditor key={`${line.line_id}:${line.counted_qty}:${line.recount_qty}:${line.variance_reason_category}:${line.investigation_notes}`} line={line} sessionId={sessionId}
                                        editable={canCount} onChanged={() => refreshInvestigation(line.location_id)} />
                                    </div>
                                  )}
                                </div>
                            )
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </section>
            </div>

            {session &&
              ["draft", "counting"].includes(
                session.status
              ) &&
              canCount && (
                <div className="sticky bottom-3 z-20 mt-5 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold">
                        {allCounted && !cycleInvestigationComplete
                          ? `${formatNumber(Number(varianceStatus?.pending_recount_lines ?? 0))} perlu Recount · ${formatNumber(Number(varianceStatus?.pending_reason_lines ?? 0))} perlu Alasan Selisih`
                          : allCounted
                          ? "Semua SKU sudah dihitung ✓"
                          : `${formatNumber(
                              Number(
                                session.total_lines
                              ) -
                                Number(
                                  session.counted_lines
                                )
                            )} SKU belum dihitung`}
                      </div>

                      <p className="mt-1 text-xs text-slate-500">
                        {session.opname_type === "cycle_count"
                          ? "SKU yang berbeda dari system wajib Recount. Jika masih selisih, isi alasan dan catatan sebelum Review."
                          : "Qty sistem dan selisih baru akan terlihat pada tahap Review."}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={
                        submitForReview
                      }
                      disabled={
                        !allCounted ||
                        !cycleInvestigationComplete ||
                        submitting ||
                        savingLineId !==
                          null
                      }
                      className="shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {submitting
                        ? "Submitting..."
                        : "Kirim ke Review"}
                    </button>
                  </div>
                </div>
              )}
          </div>
        </main>
      </div>
    </div>

      <section className="print-only">
        <div className="print-sheet">
          <div className="print-title">STOCK OPNAME — COUNT SHEET</div>

          <div className="print-meta">
            <div>
              <span>Session</span>
              <strong>{session?.session_code ?? "-"}</strong>
            </div>
            <div>
              <span>Rack</span>
              <strong>{activeRack?.location_code ?? "-"}</strong>
            </div>
            <div>
              <span>Area</span>
              <strong>{activeRack?.area_name ?? "-"}</strong>
            </div>
            <div>
              <span>Tanggal Count</span>
              <strong>{formatPrintDate(printDate)}</strong>
            </div>
            <div>
              <span>Petugas</span>
              <strong>{printPetugas || "________________"}</strong>
            </div>
          </div>

          <table className="print-table">
            <thead>
              <tr>
                <th className="print-no">No</th>
                <th className="print-sku">SKU</th>
                <th>Produk</th>
                <th className="print-variant">Variant</th>
                <th className="print-qty">Qty Fisik</th>
                <th className="print-note">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`print-${line.line_id}`}>
                  <td className="print-center">{index + 1}</td>
                  <td className="print-strong">{line.sku}</td>
                  <td>
                    <div className="print-strong">{line.product_name}</div>
                    <div className="print-muted">{line.product_code}</div>
                  </td>
                  <td>
                    {[
                      line.color,
                      line.size,
                    ]
                      .filter(Boolean)
                      .join(" / ") || "-"}
                  </td>
                  <td className="print-blank-cell">&nbsp;</td>
                  <td className="print-blank-cell">&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="print-general-note">
            <div className="print-label">Catatan Umum</div>
            <div className="print-note-box">
              {session?.notes || ""}
            </div>
          </div>

          <div className="print-signatures">
            <div>
              <div>Petugas</div>
              <div className="signature-space" />
              <div className="signature-line">
                {printPetugas || "Nama / tanda tangan"}
              </div>
            </div>
            <div>
              <div>Checker</div>
              <div className="signature-space" />
              <div className="signature-line">
                Nama / tanda tangan
              </div>
            </div>
          </div>
        </div>
      </section>

      <style jsx global>{`
        .screen-only {
          display: block;
        }

        .print-only {
          display: none;
        }

        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm;
          }

          html,
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }

          .screen-only {
            display: none !important;
          }

          .print-only {
            display: block !important;
          }

          .print-sheet {
            width: 100%;
            color: #000;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 11px;
          }

          .print-title {
            margin-bottom: 12px;
            text-align: center;
            font-size: 20px;
            font-weight: 800;
            letter-spacing: 0.5px;
          }

          .print-meta {
            display: grid;
            grid-template-columns: 1.2fr 1fr 1fr 1fr 1.5fr;
            gap: 7px;
            margin-bottom: 12px;
          }

          .print-meta > div {
            min-height: 48px;
            padding: 8px 10px;
            border: 1px solid #000;
          }

          .print-meta span {
            display: block;
            margin-bottom: 5px;
            font-size: 8.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.4px;
          }

          .print-meta strong {
            display: block;
            font-size: 11px;
          }

          .print-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          .print-table thead {
            display: table-header-group;
          }

          .print-table tr {
            page-break-inside: avoid;
          }

          .print-table th,
          .print-table td {
            border: 1px solid #000;
            padding: 8px 9px;
            vertical-align: middle;
          }

          .print-table th {
            text-align: center;
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
          }

          .print-table td {
            height: 40px;
          }

          .print-no {
            width: 5%;
          }

          .print-sku {
            width: 17%;
          }

          .print-variant {
            width: 16%;
          }

          .print-qty {
            width: 12%;
          }

          .print-note {
            width: 20%;
          }

          .print-center {
            text-align: center;
          }

          .print-strong {
            font-weight: 700;
          }

          .print-muted {
            margin-top: 2px;
            font-size: 9px;
          }

          .print-blank-cell {
            height: 40px;
          }

          .print-general-note {
            margin-top: 12px;
          }

          .print-label {
            margin-bottom: 5px;
            font-size: 10px;
            font-weight: 800;
          }

          .print-note-box {
            min-height: 52px;
            padding: 8px 10px;
            border: 1px solid #000;
            white-space: pre-wrap;
          }

          .print-signatures {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 80px;
            margin-top: 32px;
            page-break-inside: avoid;
          }

          .print-signatures > div {
            text-align: center;
          }

          .signature-space {
            height: 64px;
          }

          .signature-line {
            border-top: 1px solid #000;
            padding-top: 5px;
            font-size: 10px;
          }
        }
      `}</style>
    </>
  );
}
