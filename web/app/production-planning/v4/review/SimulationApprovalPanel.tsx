"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

type SimRequest = {
  id: string;
  batch_id: string;
  requested_by: string;
  requested_at: string;
  status: string;
  decision_notes: string | null;
  decided_at: string | null;
};

type SimEvent = {
  id: number;
  action: string;
  actor_id: string;
  notes: string | null;
  created_at: string;
  request_id?: string;
};

type ActorProfile = {
  full_name: string | null;
  role: string | null;
};

type ReviewLine = {
  batch_id: string;
  variant_id: string;
  sku_snapshot: string | null;
  product_code: string | null;
  vendor_name_snapshot: string | null;
  proposed_qty: number | null;
  decision: string;
  moq_type: string | null;
  moq_quantity: number | null;
  review_notes: string | null;
};

type ReviewDetail = {
  status: "loaded" | "error";
  lines: ReviewLine[];
  error?: string;
};

type HistoryState = {
  events: SimEvent[];
  loading: boolean;
  error?: string;
};

type StatusFilter = "SUBMITTED" | "APPROVED" | "REJECTED" | "ALL";

type Props = {
  batchId: string | null;
  dirty: boolean;
  busy: boolean;
};

const dateTime = (value: string | null) =>
  value
    ? `${new Date(value).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Jakarta",
      })} WIB`
    : "—";

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  warehouse_manager: "Warehouse Manager",
  warehouse_staff: "Warehouse Staff",
  viewer: "Viewer",
};

const statusLabels: Record<string, string> = {
  SUBMITTED: "Menunggu Persetujuan",
  APPROVED: "Disetujui (Simulasi)",
  REJECTED: "Ditolak (Simulasi)",
};

const statusStyles: Record<string, string> = {
  SUBMITTED: "bg-amber-100 text-amber-900",
  APPROVED: "bg-emerald-100 text-emerald-900",
  REJECTED: "bg-rose-100 text-rose-900",
};

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Kesalahan tidak diketahui.";

function isAccessError(error: { code?: string; message?: string }) {
  return (
    error.code === "42501" ||
    /permission denied|row.level security|\brls\b/i.test(error.message ?? "")
  );
}

function detailAccessMessage() {
  return (
    "Detail Draft tidak dapat dibaca karena akses database ditolak. " +
    "Keputusan dikunci. Jika Owner/Admin perlu membaca Draft pengguna lain, " +
    "diperlukan RPC server-side terautentikasi dengan pemeriksaan role dan " +
    "otorisasi yang aman; jangan gunakan service_role di browser."
  );
}

function totalQty(lines: ReviewLine[]) {
  return lines.reduce((sum, line) => {
    if (line.decision !== "PROPOSE") return sum;
    const qty = Number(line.proposed_qty);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 2,
  }).format(value);
}

function moqScope(type: string | null) {
  if (!type) return "Scope belum dicatat";
  if (type === "PER_COLOR") return "Per warna";
  if (type === "BY_REQUEST") return "Sesuai konfirmasi vendor";
  if (type === "PER_MODEL") return "Per model";
  return type.replaceAll("_", " ");
}

function moqSummaries(lines: ReviewLine[]) {
  const groups = new Map<string, ReviewLine>();

  for (const line of lines) {
    const key = JSON.stringify([
      line.product_code,
      line.vendor_name_snapshot,
      line.moq_type,
      line.moq_quantity,
    ]);
    if (!groups.has(key)) groups.set(key, line);
  }

  return [...groups.values()];
}

export default function SimulationApprovalPanel({
  batchId,
  dirty,
  busy,
}: Props) {
  const [requests, setRequests] = useState<SimRequest[]>([]);
  const [details, setDetails] = useState<Record<string, ReviewDetail>>({});
  const [history, setHistory] = useState<Record<string, HistoryState>>({});
  const [actorProfiles, setActorProfiles] = useState<
    Record<string, ActorProfile>
  >({});
  const [decisionActors, setDecisionActors] = useState<
    Record<string, SimEvent>
  >({});
  const [identityError, setIdentityError] = useState("");
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("SUBMITTED");
  const [canApprove, setCanApprove] = useState(false);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>(
    {}
  );
  const [workingRequestId, setWorkingRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [authorizationError, setAuthorizationError] = useState("");
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setListError("");
    setAuthorizationError("");
    setRequests([]);
    setDetails({});
    setActorProfiles({});
    setDecisionActors({});
    setIdentityError("");

    try {
      const db = createClient();
      const { data: auth, error: authError } = await db.auth.getUser();

      if (authError || !auth.user) {
        throw new Error("Login WMS diperlukan untuk membaca pengajuan.");
      }

      const { data: role, error: roleError } = await db.rpc(
        "wms_can_approve_production_v42"
      );

      if (roleError) {
        setCanApprove(false);
        setAuthorizationError(
          `Hak persetujuan tidak dapat diverifikasi: ${roleError.message}. ` +
          "Tombol keputusan dinonaktifkan."
        );
      } else {
        setCanApprove(role === true);
      }

      const { data, error: queryError } = await db
        .from("wms_sim_approval_requests")
        .select(
          "id,batch_id,requested_by,requested_at,status,decision_notes,decided_at"
        )
        .order("requested_at", { ascending: false })
        .limit(50);

      if (queryError) {
        throw new Error(
          isAccessError(queryError)
            ? "Akses membaca daftar pengajuan ditolak oleh kebijakan database."
            : queryError.message
        );
      }

      const loadedRequests = (data ?? []) as SimRequest[];
      setRequests(loadedRequests);

      if (loadedRequests.length === 0) return;

      const decidedRequests = loadedRequests.filter(
        (request) =>
          request.status === "APPROVED" || request.status === "REJECTED"
      );
      let decisionEventRows: SimEvent[] = [];

      if (decidedRequests.length > 0) {
        const { data: eventData, error: eventError } = await db
          .from("wms_sim_approval_events")
          .select("id,action,actor_id,notes,created_at,request_id")
          .in(
            "request_id",
            decidedRequests.map((request) => request.id)
          )
          .order("created_at", { ascending: false });

        if (eventError) {
          setIdentityError(
            `Identitas pengambil keputusan tidak dapat dimuat: ${eventError.message}`
          );
        } else {
          decisionEventRows = (eventData ?? []) as SimEvent[];
          const decisionEventByRequest: Record<string, SimEvent> = {};

          for (const request of decidedRequests) {
            const event = decisionEventRows.find(
              (row) =>
                row.request_id === request.id &&
                row.action.toUpperCase() === request.status
            );
            if (event) decisionEventByRequest[request.id] = event;
          }

          setDecisionActors(decisionEventByRequest);
        }
      }

      const actorIds = [
        ...new Set(
          [
            ...loadedRequests.map((request) => request.requested_by),
            ...decisionEventRows.map((event) => event.actor_id),
          ].filter((actorId): actorId is string => !!actorId)
        ),
      ];

      if (actorIds.length > 0) {
        const { data: profiles, error: profilesError } = await db
          .from("profiles")
          .select("id,full_name,role")
          .in("id", actorIds);

        if (profilesError) {
          setIdentityError(
            isAccessError(profilesError)
              ? "Akses membaca nama dan jabatan aktor ditolak oleh kebijakan profil. Nama pengguna belum dilengkapi."
              : `Identitas pengguna gagal dimuat: ${profilesError.message}`
          );
        } else {
          const identities = (profiles ?? []) as Array<
            ActorProfile & { id: string }
          >;
          if (identities.length < actorIds.length) {
            setIdentityError(
              "Sebagian identitas tidak tersedia atau dibatasi oleh kebijakan RLS. Nama pengguna belum dilengkapi."
            );
          }
          setActorProfiles(
            Object.fromEntries(
              identities.map(({ id, ...profile }) => [id, profile])
            )
          );
        }
      }

      const batchIds = [...new Set(loadedRequests.map((item) => item.batch_id))];
      const lines: ReviewLine[] = [];
      const pageSize = 1000;
      let allLinesLoaded = false;

      for (let offset = 0; offset < 100000; offset += pageSize) {
        const { data: linePage, error: lineError } = await db
          .from("wms_production_review_lines")
          .select(
            "batch_id,variant_id,sku_snapshot,product_code,vendor_name_snapshot,proposed_qty,decision,moq_type,moq_quantity,review_notes"
          )
          .in("batch_id", batchIds)
          .range(offset, offset + pageSize - 1);

        if (lineError) {
          const errorMessage = isAccessError(lineError)
            ? detailAccessMessage()
            : `Detail SKU gagal dimuat: ${lineError.message}`;
          setDetails(
            Object.fromEntries(
              loadedRequests.map((request) => [
                request.id,
                { status: "error", lines: [], error: errorMessage },
              ])
            )
          );
          return;
        }

        const page = (linePage ?? []) as ReviewLine[];
        lines.push(...page);

        if (page.length < pageSize) {
          allLinesLoaded = true;
          break;
        }
      }

      if (!allLinesLoaded) {
        setDetails(
          Object.fromEntries(
            loadedRequests.map((request) => [
              request.id,
              {
                status: "error",
                lines: [],
                error:
                  "Detail Draft melebihi batas pembacaan aman. " +
                  "Keputusan dikunci sampai detail dapat dimuat lengkap.",
              },
            ])
          )
        );
        return;
      }

      const detailsByRequest: Record<string, ReviewDetail> = {};
      for (const request of loadedRequests) {
        const matchingLines = lines.filter(
          (line) => line.batch_id === request.batch_id
        );
        const variantIds = matchingLines.map((line) => line.variant_id);
        const hasDuplicateVariants =
          new Set(variantIds).size !== variantIds.length;

        if (matchingLines.length === 0) {
          detailsByRequest[request.id] = {
            status: "error",
            lines: [],
            error:
              "Tidak ada baris Draft yang dapat dibaca untuk pengajuan ini. " +
              "Keputusan dikunci. Jika Owner/Admin seharusnya dapat melihat " +
              "Draft ini, periksa RLS dan sediakan RPC server-side yang aman " +
              "untuk membaca detail lintas pemilik.",
          };
        } else if (
          matchingLines.some((line) => line.batch_id !== request.batch_id) ||
          hasDuplicateVariants
        ) {
          detailsByRequest[request.id] = {
            status: "error",
            lines: [],
            error:
              "Detail Draft tidak cocok atau memiliki SKU duplikat. " +
              "Keputusan dikunci.",
          };
        } else {
          detailsByRequest[request.id] = {
            status: "loaded",
            lines: matchingLines,
          };
        }
      }
      setDetails(detailsByRequest);
    } catch (error) {
      setListError(toErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(
    async (requestId: string, force = false) => {
      if (!force && history[requestId]?.events) return;

      setHistory((previous) => ({
        ...previous,
        [requestId]: { events: previous[requestId]?.events ?? [], loading: true },
      }));

      try {
        const db = createClient();
        const { data, error: queryError } = await db
          .from("wms_sim_approval_events")
          .select("id,action,actor_id,notes,created_at")
          .eq("request_id", requestId)
          .order("created_at", { ascending: true });

        if (queryError) throw new Error(queryError.message);

        const loadedEvents = (data ?? []) as SimEvent[];
        const actorIds = [
          ...new Set(
            loadedEvents
              .map((event) => event.actor_id)
              .filter((actorId): actorId is string => !!actorId)
          ),
        ];

        if (actorIds.length > 0) {
          const { data: profiles, error: profilesError } = await db
            .from("profiles")
            .select("id,full_name,role")
            .in("id", actorIds);

          if (profilesError) {
            setIdentityError(
              isAccessError(profilesError)
                ? "Akses membaca nama dan jabatan aktor ditolak oleh kebijakan profil. Nama pengguna belum dilengkapi."
                : `Identitas pengguna gagal dimuat: ${profilesError.message}`
            );
          } else {
            const identities = (profiles ?? []) as Array<
              ActorProfile & { id: string }
            >;
            if (identities.length < actorIds.length) {
              setIdentityError(
                "Sebagian identitas tidak tersedia atau dibatasi oleh kebijakan RLS. Nama pengguna belum dilengkapi."
              );
            }
            setActorProfiles((previous) => ({
              ...previous,
              ...Object.fromEntries(
                identities.map(({ id, ...profile }) => [id, profile])
              ),
            }));
          }
        }

        setHistory((previous) => ({
          ...previous,
          [requestId]: {
            events: loadedEvents,
            loading: false,
          },
        }));
      } catch (error) {
        setHistory((previous) => ({
          ...previous,
          [requestId]: {
            events: previous[requestId]?.events ?? [],
            loading: false,
            error: `Riwayat gagal dimuat: ${toErrorMessage(error)}`,
          },
        }));
      }
    },
    [history]
  );

  useEffect(() => {
    void loadData();
  }, [loadData, batchId]);

  const active = requests.find((request) => request.batch_id === batchId);

  function actorName(actorId: string | null | undefined) {
    const fullName = actorId ? actorProfiles[actorId]?.full_name?.trim() : "";
    return fullName || "Nama pengguna belum dilengkapi";
  }

  function actorRole(actorId: string | null | undefined) {
    const role = actorId ? actorProfiles[actorId]?.role : null;
    return role ? roleLabels[role] ?? role : "Jabatan belum tersedia";
  }

  const visibleRequests = useMemo(() => {
    const statusOrder: Record<string, number> = {
      SUBMITTED: 0,
      REJECTED: 1,
      APPROVED: 2,
    };

    return [...requests]
      .filter(
        (request) =>
          statusFilter === "ALL" || request.status === statusFilter
      )
      .sort((left, right) => {
        const order =
          (statusOrder[left.status] ?? 3) -
          (statusOrder[right.status] ?? 3);
        if (order !== 0) return order;
        return (
          new Date(right.requested_at).getTime() -
          new Date(left.requested_at).getTime()
        );
      });
  }, [requests, statusFilter]);

  async function submitSimulation() {
    if (!batchId || busy || dirty || submitting || active || workingRequestId)
      return;

    if (
      !window.confirm(
        "Ajukan Draft ini untuk APPROVAL SIMULASI? " +
        "Ini bukan persetujuan produksi operasional dan tidak membuat PO."
      )
    ) {
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const db = createClient();
      const { error: rpcError } = await db.rpc(
        "wms_submit_sim_approval_v42d",
        { p_batch_id: batchId }
      );

      if (rpcError) throw new Error(rpcError.message);

      setMessage("Pengajuan simulasi berhasil dicatat.");
      await loadData();
    } catch (error) {
      setMessage(`Pengajuan gagal: ${toErrorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(
    request: SimRequest,
    decision: "APPROVED" | "REJECTED"
  ) {
    const detail = details[request.id];
    if (
      !canApprove ||
      request.status !== "SUBMITTED" ||
      workingRequestId ||
      !detail ||
      detail.status !== "loaded" ||
      detail.lines.length === 0 ||
      detail.lines.some((line) => line.batch_id !== request.batch_id)
    ) {
      return;
    }

    const notes = decisionNotes[request.id] ?? "";
    if (decision === "REJECTED" && !notes.trim()) {
      setMessage("Alasan penolakan wajib diisi.");
      return;
    }

    const skuCount = new Set(detail.lines.map((line) => line.variant_id)).size;
    const qty = totalQty(detail.lines);
    const shortDraftId = request.batch_id.slice(0, 8);
    const decisionLabel =
      decision === "APPROVED" ? "APPROVE SIMULASI" : "REJECT SIMULASI";
    const confirmation = [
      `Jenis keputusan: ${decisionLabel}`,
      `Jumlah SKU: ${skuCount}`,
      `Total Qty diajukan: ${formatNumber(qty)} pcs`,
      `ID Draft: ${shortDraftId}`,
      "SIMULASI — BUKAN PERSETUJUAN PRODUKSI OPERASIONAL.",
      ...(decision === "REJECTED" ? [`Alasan: ${notes.trim()}`] : []),
    ].join("\n");

    if (!window.confirm(confirmation)) return;

    setWorkingRequestId(request.id);
    setMessage("");

    try {
      const db = createClient();
      const { error: rpcError } = await db.rpc(
        "wms_decide_sim_approval_v42d",
        {
          p_request_id: request.id,
          p_decision: decision,
          p_notes: notes.trim() || null,
        }
      );

      if (rpcError) throw new Error(rpcError.message);

      const decidedAt = new Date().toISOString();
      setRequests((previous) =>
        previous.map((item) =>
          item.id === request.id
            ? {
                ...item,
                status: decision,
                decision_notes: notes.trim() || null,
                decided_at: decidedAt,
              }
            : item
        )
      );
      setDecisionNotes((previous) => {
        const updated = { ...previous };
        delete updated[request.id];
        return updated;
      });
      setMessage(`${decisionLabel} berhasil dicatat untuk simulasi.`);

      await loadData();
      await loadHistory(request.id, true);
    } catch (error) {
      setMessage(`Keputusan gagal; pengajuan belum diubah: ${toErrorMessage(error)}`);
    } finally {
      setWorkingRequestId(null);
    }
  }

  function toggleDetails(requestId: string) {
    setOpenDetailId((current) => (current === requestId ? null : requestId));
  }

  async function toggleHistory(requestId: string) {
    if (openHistoryId === requestId) {
      setOpenHistoryId(null);
      return;
    }

    setOpenHistoryId(requestId);
    await loadHistory(requestId);
  }

  const filterOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: "SUBMITTED", label: "Menunggu Persetujuan" },
    { value: "APPROVED", label: "Disetujui" },
    { value: "REJECTED", label: "Ditolak" },
    { value: "ALL", label: "Semua" },
  ];

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-xl border border-indigo-200 bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900">
            Approval Produksi — SIMULASI
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Tinjau isi Draft tersimpan sebelum keputusan simulasi.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading || submitting || !!workingRequestId}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
        >
          {loading ? "Memuat..." : "Refresh"}
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-bold">
          SIMULASI — BUKAN PERSETUJUAN PRODUKSI OPERASIONAL.
        </p>
        <p className="mt-1">
          Approval operasional dan Generate PO tetap terkunci. Tidak ada
          perubahan stok atau PO dari keputusan di panel ini.
        </p>
      </div>

      {batchId && (
        <div className="mt-4 min-w-0 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="break-all">
            Draft aktif: <span className="font-medium">{batchId}</span>
          </p>
          <p className="mt-1">
            Status pengajuan:{" "}
            <span className="font-medium">
              {active
                ? statusLabels[active.status] ?? active.status
                : "Belum diajukan"}
            </span>
          </p>
          {dirty && (
            <p className="mt-2 text-amber-800">
              Simpan perubahan Draft terlebih dahulu sebelum mengajukan.
            </p>
          )}
          {active && (
            <p className="mt-2 text-slate-600">
              Draft ini sudah mempunyai pengajuan simulasi.
            </p>
          )}
          <button
            type="button"
            onClick={() => void submitSimulation()}
            disabled={
              busy ||
              dirty ||
              submitting ||
              !!workingRequestId ||
              !!active ||
              loading
            }
            className="mt-3 rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white disabled:opacity-40"
          >
            {submitting ? "Memproses..." : "Ajukan Approval Simulasi"}
          </button>
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`mt-3 text-sm ${
            message.includes("gagal") || message.includes("wajib")
              ? "text-red-700"
              : "text-emerald-800"
          }`}
        >
          {message}
        </p>
      )}
      {listError && (
        <p role="alert" className="mt-3 break-words text-sm text-red-700">
          {listError}
        </p>
      )}
      {authorizationError && (
        <p role="alert" className="mt-3 break-words text-sm text-amber-800">
          {authorizationError}
        </p>
      )}

      <div className="mt-5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900">
              Pengajuan Persetujuan Simulasi
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Maksimal 50 pengajuan terbaru yang dapat dibaca akun ini.
            </p>
          </div>
          <label className="flex max-w-full items-center gap-2 text-sm">
            <span className="shrink-0">Filter</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              className="min-w-0 max-w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {filterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading && requests.length === 0 && (
          <p className="mt-4 text-sm text-slate-600">
            Memuat daftar pengajuan...
          </p>
        )}
        {identityError && (
          <p role="status" className="mt-3 break-words text-sm text-amber-800">
            {identityError}
          </p>
        )}

        {!loading && !listError && visibleRequests.length === 0 && (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Tidak ada pengajuan pada filter ini.
          </p>
        )}

        <div className="mt-3 space-y-3">
          {visibleRequests.map((request) => {
            const detail = details[request.id];
            const lines =
              detail?.status === "loaded" ? detail.lines : [];
            const skuCount = new Set(
              lines.map((line) => line.variant_id)
            ).size;
            const qty = totalQty(lines);
            const canDecide =
              canApprove &&
              request.status === "SUBMITTED" &&
              detail?.status === "loaded" &&
              lines.length > 0;
            const historyState = history[request.id];

            return (
              <article
                key={request.id}
                className="min-w-0 rounded-xl border border-slate-200 p-3 sm:p-4"
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          statusStyles[request.status] ??
                          "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {statusLabels[request.status] ?? request.status}
                      </span>
                      <span className="break-all text-xs text-slate-500">
                        Referensi: SIM-{request.id.slice(0, 8)}
                      </span>
                    </div>

                    <dl className="mt-3 grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                      <div className="min-w-0">
                        <dt className="text-xs text-slate-500">
                          Tanggal pengajuan
                        </dt>
                        <dd>{dateTime(request.requested_at)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-slate-500">
                          Diajukan oleh
                        </dt>
                        <dd>{actorName(request.requested_by)}</dd>
                        <dt className="mt-1 text-xs text-slate-500">
                          Jabatan
                        </dt>
                        <dd>{actorRole(request.requested_by)}</dd>
                      </div>
                      {request.status !== "SUBMITTED" && (
                        <div className="min-w-0">
                          <dt className="text-xs text-slate-500">
                            Diputuskan oleh
                          </dt>
                          <dd>
                            {actorName(decisionActors[request.id]?.actor_id)}
                          </dd>
                          <dt className="mt-1 text-xs text-slate-500">
                            Jabatan pengambil keputusan
                          </dt>
                          <dd>
                            {actorRole(decisionActors[request.id]?.actor_id)}
                          </dd>
                          <dt className="mt-1 text-xs text-slate-500">
                            Tanggal dan jam keputusan
                          </dt>
                          <dd>
                            {dateTime(
                              request.decided_at ??
                                decisionActors[request.id]?.created_at ??
                                null
                            )}
                          </dd>
                        </div>
                      )}
                      <div className="min-w-0">
                        <dt className="text-xs text-slate-500">
                          Referensi Draft
                        </dt>
                        <dd className="break-all">
                          {request.batch_id.slice(0, 8)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Jumlah SKU</dt>
                        <dd>
                          {detail?.status === "loaded"
                            ? formatNumber(skuCount)
                            : "Belum dapat diverifikasi"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">
                          Total Qty diajukan
                        </dt>
                        <dd>
                          {detail?.status === "loaded"
                            ? `${formatNumber(qty)} pcs`
                            : "Belum dapat diverifikasi"}
                        </dd>
                      </div>
                    </dl>

                    {detail?.status === "error" && (
                      <p
                        role="alert"
                        className="mt-3 break-words rounded-lg bg-red-50 p-3 text-sm text-red-800"
                      >
                        {detail.error}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleDetails(request.id)}
                    disabled={detail?.status === "error"}
                    className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40"
                  >
                    {openDetailId === request.id
                      ? "Tutup Detail"
                      : "Lihat Detail"}
                  </button>
                </div>

                {openDetailId === request.id &&
                  detail?.status === "loaded" && (
                    <div className="mt-4 min-w-0 border-t border-slate-200 pt-4">
                      <div className="grid min-w-0 grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
                        <div>
                          <p className="text-xs text-slate-500">Total SKU</p>
                          <p className="font-semibold">
                            {formatNumber(skuCount)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Total Qty</p>
                          <p className="font-semibold">
                            {formatNumber(qty)} pcs
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">
                            Tanggal pengajuan
                          </p>
                          <p>{dateTime(request.requested_at)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">
                            Status approval
                          </p>
                          <p className="font-semibold">
                            {statusLabels[request.status] ?? request.status}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <h4 className="font-semibold text-slate-900">
                          Detail SKU dari Draft tersimpan
                        </h4>
                        <div className="mt-2 max-w-full overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full min-w-[850px] text-left text-sm">
                            <thead className="bg-slate-50">
                              <tr>
                                {[
                                  "SKU",
                                  "Kode Produk",
                                  "Vendor",
                                  "Keputusan SKU",
                                  "Qty Diajukan",
                                  "Catatan SKU",
                                ].map((label) => (
                                  <th
                                    key={label}
                                    className="border-b border-slate-200 px-3 py-2"
                                  >
                                    {label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {lines.map((line) => (
                                <tr
                                  key={`${line.batch_id}-${line.variant_id}`}
                                  className="border-b border-slate-100 align-top"
                                >
                                  <td className="px-3 py-2">
                                    {line.sku_snapshot || "—"}
                                  </td>
                                  <td className="px-3 py-2">
                                    {line.product_code || "—"}
                                  </td>
                                  <td className="px-3 py-2">
                                    {line.vendor_name_snapshot || "—"}
                                  </td>
                                  <td className="px-3 py-2">
                                    {line.decision}
                                  </td>
                                  <td className="px-3 py-2">
                                    {line.decision === "PROPOSE"
                                      ? `${formatNumber(Number(line.proposed_qty) || 0)} pcs`
                                      : "0 pcs"}
                                  </td>
                                  <td className="max-w-xs whitespace-pre-wrap break-words px-3 py-2">
                                    {line.review_notes || "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="mt-4 rounded-lg border border-slate-200 p-3">
                        <h4 className="font-semibold text-slate-900">
                          Ringkasan MOQ Draft
                        </h4>
                        <div className="mt-2 space-y-2 text-sm">
                          {moqSummaries(lines).map((line, index) => (
                            <div
                              key={`${line.product_code}-${line.vendor_name_snapshot}-${line.moq_type}-${index}`}
                              className="min-w-0 rounded-md bg-slate-50 p-2"
                            >
                              <p className="break-words font-medium">
                                {line.product_code || "Produk tidak tersedia"}
                                {" — "}
                                {line.vendor_name_snapshot || "Vendor belum dicatat"}
                              </p>
                              <p>
                                MOQ:{" "}
                                {line.moq_quantity == null
                                  ? "Belum tersedia"
                                  : `${formatNumber(Number(line.moq_quantity))} pcs`}
                                {" · "}
                                Scope: {moqScope(line.moq_type)}
                              </p>
                            </div>
                          ))}
                          <p className="font-semibold text-amber-800">
                            MOQ memerlukan pemeriksaan lanjutan.
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950">
                        SIMULASI — BUKAN PERSETUJUAN PRODUKSI OPERASIONAL.
                      </div>

                      <div className="mt-4">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <h4 className="font-semibold text-slate-900">
                            Approval History
                          </h4>
                          <button
                            type="button"
                            onClick={() => void toggleHistory(request.id)}
                            disabled={!!workingRequestId}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
                          >
                            {openHistoryId === request.id
                              ? "Tutup Riwayat"
                              : "Lihat Riwayat"}
                          </button>
                        </div>

                        {openHistoryId === request.id && (
                          <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
                            {historyState?.loading && (
                              <p>Memuat riwayat...</p>
                            )}
                            {historyState?.error && (
                              <p role="alert" className="text-red-700">
                                {historyState.error}
                              </p>
                            )}
                            {!historyState?.loading &&
                              !historyState?.error &&
                              historyState?.events.length === 0 && (
                                <p>Riwayat belum tersedia.</p>
                              )}
                            <ol className="space-y-3">
                              {historyState?.events.map((event) => (
                                <li
                                  key={event.id}
                                  className="min-w-0 border-l-2 border-indigo-300 pl-3"
                                >
                                  <p className="font-semibold">
                                    {event.action} — {dateTime(event.created_at)}
                                  </p>
                                  <p className="break-all text-slate-600">
                                    Aktor: {actorName(event.actor_id)}
                                  </p>
                                  <p className="text-slate-600">
                                    Jabatan: {actorRole(event.actor_id)}
                                  </p>
                                  {event.notes && (
                                    <p className="whitespace-pre-wrap break-words">
                                      Catatan: {event.notes}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>

                      {canDecide && (
                        <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                          <p className="text-sm font-semibold text-slate-900">
                            Keputusan simulasi
                          </p>
                          <label className="mt-2 block text-sm">
                            <span className="mb-1 block">
                              Catatan keputusan
                              {request.status === "SUBMITTED" &&
                                " (alasan wajib untuk Reject)"}
                            </span>
                            <textarea
                              rows={2}
                              value={decisionNotes[request.id] ?? ""}
                              onChange={(event) =>
                                setDecisionNotes((previous) => ({
                                  ...previous,
                                  [request.id]: event.target.value,
                                }))
                              }
                              disabled={!!workingRequestId}
                              placeholder="Catatan untuk pengajuan ini..."
                              className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2"
                            />
                          </label>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={!!workingRequestId || loading}
                              onClick={() =>
                                void decide(request, "APPROVED")
                              }
                              className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-40"
                            >
                              {workingRequestId === request.id
                                ? "Memproses..."
                                : "Approve Simulasi"}
                            </button>
                            <button
                              type="button"
                              disabled={
                                !!workingRequestId ||
                                loading ||
                                !(decisionNotes[request.id] ?? "").trim()
                              }
                              onClick={() =>
                                void decide(request, "REJECTED")
                              }
                              className="rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white disabled:opacity-40"
                            >
                              Reject Simulasi
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
              </article>
            );
          })}
        </div>
      </div>

      <p className="mt-5 border-t border-slate-200 pt-3 text-sm font-semibold text-amber-900">
        SIMULATION ONLY. Approval operasional dan Generate PO tetap terkunci.
      </p>
    </section>
  );
}
