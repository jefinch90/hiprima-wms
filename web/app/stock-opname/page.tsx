"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type StockOpnameSession = {
  session_id: string;
  session_code: string;
  opname_type: string;
  status: string;
  notes: string | null;
  total_locations: number;
  total_lines: number;
  counted_lines: number;
  variance_lines: number;
  progress_percent: number;
  adjustment_lines: number;
  qty_adjustment_in: number;
  qty_adjustment_out: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  submitted_at: string | null;
  finalized_at: string | null;
  total_count: number;
};

const STATUS_LABELS: Record<
  string,
  string
> = {
  draft: "Draft",
  counting: "Counting",
  review: "Review",
  finalized: "Finalized",
  cancelled: "Cancelled",
};

function formatNumber(
  value: number | null | undefined
) {
  return Number(
    value ?? 0
  ).toLocaleString("id-ID");
}

function formatDate(value: string) {
  return new Date(
    value
  ).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sessionHref(session: StockOpnameSession) {
  const page = ["draft", "counting"].includes(session.status)
    ? "counting"
    : "review";
  return `/stock-opname/${page}/?session=${session.session_id}`;
}

export default function StockOpnamePage() {
  const router = useRouter();

  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [role, setRole] =
    useState("");

  const [sessions, setSessions] =
    useState<StockOpnameSession[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [errorMessage, setErrorMessage] =
    useState("");

  const loadData = useCallback(
    async () => {
      setLoading(true);
      setErrorMessage("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const {
        data: profile,
        error: profileError,
      } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .single();

      if (
        profileError ||
        !profile ||
        profile.is_active !== true
      ) {
        await supabase.auth.signOut();

        router.replace("/login");
        return;
      }

      setRole(profile.role);

      const { data, error } =
        await supabase.rpc(
          "get_stock_opname_sessions",
          {
            p_search: null,
            p_type: null,
            p_status: null,
            p_limit: 50,
            p_offset: 0,
          }
        );

      if (error) {
        setSessions([]);
        setErrorMessage(
          error.message
        );
        setLoading(false);
        return;
      }

      setSessions(
        (data ?? []) as StockOpnameSession[]
      );

      setLoading(false);
    },
    [router, supabase]
  );

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

  const canCreate =
    role === "owner" ||
    role === "admin" ||
    role === "warehouse_manager" ||
    role === "warehouse_staff";

  const canCreateFull =
    role === "owner" ||
    role === "admin" ||
    role === "warehouse_manager";

  const totalSessions =
    Number(
      sessions[0]?.total_count ?? 0
    );

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">
          <div className="mx-auto w-full min-w-0 max-w-[1500px]">
            <header className="mb-8">
              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <h1 className="mt-1 text-3xl font-bold">
                Stock Opname
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Cycle Count harian dan Full
                Stock Opname berkala
              </p>
            </header>

            <section className="mb-8 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Daily Control
                </div>

                <h2 className="mt-2 text-xl font-bold">
                  Cycle Count
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Hitung stok fisik untuk
                  rack tertentu secara rutin
                  tanpa melakukan full opname
                  seluruh gudang.
                </p>

                <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  Cocok untuk pengecekan
                  harian per rack / area.
                </div>

                {canCreate && (
                  <Link
                    href="/stock-opname/cycle-count"
                    className="mt-5 inline-flex rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
                  >
                    Buat Cycle Count
                  </Link>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Periodic Control
                </div>

                <h2 className="mt-2 text-xl font-bold">
                  Full Stock Opname
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Mengambil snapshot seluruh
                  rack aktif dan menghitung
                  seluruh stok fisik gudang.
                </p>

                <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  Rencana Hi.PRIMA:
                  sekitar setiap 6 bulan.
                </div>

                {canCreateFull && (
                  <Link
                    href="/stock-opname/full"
                    className="mt-5 inline-flex rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
                  >
                    Buat Full Opname
                  </Link>
                )}
              </div>
            </section>

            {!canCreate &&
              role && (
                <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
                  Role Anda dapat melihat
                  sesi Stock Opname.
                  Viewer hanya dapat membaca
                  sesi dan hasil Stock Opname.
                </div>
              )}

            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            <section className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    Riwayat Stock Opname
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    {formatNumber(
                      totalSessions
                    )}{" "}
                    sesi tercatat
                  </p>
                </div>

                <button
                  type="button"
                  onClick={loadData}
                  disabled={loading}
                  className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>

              {loading ? (
                <div className="p-10 text-center text-sm text-slate-500">
                  Loading Stock Opname...
                </div>
              ) : sessions.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="font-semibold">
                    Belum ada Stock Opname
                  </div>

                  <div className="mt-2 text-sm text-slate-500">
                    Buat Cycle Count atau Full
                    Stock Opname pertama.
                  </div>
                </div>
              ) : (
                <div>
                  <div className="divide-y divide-slate-100 xl:hidden">
                    {sessions.map((item) => (
                      <article key={item.session_id} className="space-y-3 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link
                            href={sessionHref(item)}
                            className="break-all font-semibold text-indigo-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-600"
                          >
                            {item.session_code}
                          </Link>
                          <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold">
                            {STATUS_LABELS[item.status] || item.status}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">
                          {item.opname_type === "cycle_count" ? "Cycle Count" : "Full Opname"}
                          {" · "}{formatNumber(item.total_locations)} rack
                        </p>
                        <dl className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <dt className="text-xs text-slate-500">Progress</dt>
                            <dd>{formatNumber(item.counted_lines)} / {formatNumber(item.total_lines)} ({item.progress_percent}%)</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Variance</dt>
                            <dd>{formatNumber(item.variance_lines)}</dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-xs text-slate-500">Created By</dt>
                            <dd className="break-words">{item.created_by_name || "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Created</dt>
                            <dd>{formatDate(item.created_at)}</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                  <table className="hidden w-full table-fixed break-words text-left text-sm xl:table [&_th]:px-2 [&_td]:px-2">
                    <colgroup>
                      <col className="w-[20%]" />
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[5%]" />
                      <col className="w-[12%]" />
                      <col className="w-[8%]" />
                      <col className="w-[15%]" />
                      <col className="w-[18%]" />
                    </colgroup>
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-4">
                          Session
                        </th>
                        <th className="px-5 py-4">
                          Type
                        </th>
                        <th className="px-5 py-4">
                          Status
                        </th>
                        <th className="px-5 py-4 text-right">
                          Rack
                        </th>
                        <th className="px-5 py-4 text-right">
                          Progress
                        </th>
                        <th className="px-5 py-4 text-right">
                          Variance
                        </th>
                        <th className="px-5 py-4">
                          Created By
                        </th>
                        <th className="px-5 py-4">
                          Created
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {sessions.map(
                        (item) => (
                          <tr
                            key={
                              item.session_id
                            }
                            className="hover:bg-slate-50"
                          >
                            <td className="px-5 py-4 font-semibold">
                              <Link
                                href={sessionHref(item)}
                                className="text-indigo-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-600"
                              >
                                {item.session_code}
                              </Link>
                            </td>

                            <td className="px-5 py-4">
                              {item.opname_type ===
                              "cycle_count"
                                ? "Cycle Count"
                                : "Full Opname"}
                            </td>

                            <td className="px-5 py-4">
                              <span className="inline-block max-w-full rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold">
                                {STATUS_LABELS[
                                  item.status
                                ] ||
                                  item.status}
                              </span>
                            </td>

                            <td className="px-5 py-4 text-right">
                              {formatNumber(
                                item.total_locations
                              )}
                            </td>

                            <td className="px-5 py-4 text-right">
                              {formatNumber(
                                item.counted_lines
                              )}
                              {" / "}
                              {formatNumber(
                                item.total_lines
                              )}
                              {" ("}
                              {
                                item.progress_percent
                              }
                              {"%)"}
                            </td>

                            <td className="px-5 py-4 text-right">
                              {formatNumber(
                                item.variance_lines
                              )}
                            </td>

                            <td className="px-5 py-4">
                              {item.created_by_name ||
                                "-"}
                            </td>

                            <td className="px-5 py-4 text-slate-500">
                              {formatDate(
                                item.created_at
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
