"use client";

import { appAlert, appConfirm } from "@/utils/appDialog";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

export default function FullStockOpnamePage() {
  const router = useRouter();

  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [notes, setNotes] =
    useState("");

  const [confirmed, setConfirmed] =
    useState(false);

  const [processing, setProcessing] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [errorMessage, setErrorMessage] =
    useState("");

  useEffect(() => {
    let mounted = true;

    async function checkAccess() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: profile } =
        await supabase
          .from("profiles")
          .select("role, is_active")
          .eq("id", user.id)
          .single();

      if (!mounted) return;

      if (
        !profile ||
        profile.is_active !== true
      ) {
        await supabase.auth.signOut();

        router.replace("/login");
        return;
      }

      const allowedRoles = [
        "owner",
        "admin",
        "warehouse_manager",
      ];

      if (
        !allowedRoles.includes(
          profile.role
        )
      ) {
        await appAlert(
          "Akses Ditolak\n\nHanya Owner, Admin, atau Warehouse Manager yang dapat membuat Full Stock Opname."
        );

        router.replace(
          "/stock-opname"
        );
        return;
      }

      setLoading(false);
    }

    checkAccess();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErrorMessage("");

    if (!confirmed) {
      setErrorMessage(
        "Centang konfirmasi sebelum membuat Full Stock Opname."
      );
      return;
    }

    const ok =
      await appConfirm(
        [
          "Buat Full Stock Opname?",
          "",
          "Semua rack aktif akan dimasukkan ke dalam session.",
          "Sistem akan mengambil snapshot stok saat ini.",
          "",
          "Inventory belum akan berubah sampai session difinalize.",
        ].join("\n")
      );

    if (!ok) return;

    setProcessing(true);

    const { data, error } =
      await supabase.rpc(
        "create_stock_opname_session",
        {
          p_opname_type: "full",
          p_location_ids: null,
          p_notes:
            notes.trim() || null,
        }
      );

    if (error) {
      setErrorMessage(
        error.message
      );
      setProcessing(false);
      return;
    }

    const result =
      (data ?? [])[0];

    await appAlert(
      [
        "Full Stock Opname berhasil dibuat",
        "",
        `Session: ${
          result?.session_code ??
          "-"
        }`,
        `Rack: ${
          result?.total_locations ??
          0
        }`,
        `Lines: ${
          result?.total_lines ??
          0
        }`,
      ].join("\n")
    );

    router.replace(
      "/stock-opname"
    );
    router.refresh();
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">
          <div className="mx-auto w-full min-w-0 max-w-[1000px]">
            <header className="mb-8">
              <p className="text-sm text-slate-500">
                Stock Opname
              </p>

              <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="text-3xl font-bold">
                    New Full Stock Opname
                  </h1>

                  <p className="mt-2 text-sm text-slate-500">
                    Hitung seluruh stok fisik
                    pada semua rack aktif.
                  </p>
                </div>

                <Link
                  href="/stock-opname"
                  className="shrink-0 rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium"
                >
                  Back
                </Link>
              </div>
            </header>

            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="space-y-6"
            >
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
                <h2 className="font-semibold text-amber-900">
                  Sebelum memulai
                </h2>

                <div className="mt-3 space-y-2 text-sm leading-6 text-amber-800">
                  <p>
                    Full Stock Opname akan
                    mengambil snapshot seluruh
                    inventory pada semua rack
                    aktif.
                  </p>

                  <p>
                    Sebaiknya aktivitas
                    inbound, outbound,
                    transfer, dan adjustment
                    dikendalikan selama proses
                    counting.
                  </p>

                  <p>
                    Jika stok berubah setelah
                    snapshot, sistem akan
                    menolak Finalize untuk
                    mencegah data transaksi
                    terbaru tertimpa.
                  </p>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <label className="mb-2 block text-sm font-medium">
                  Notes{" "}
                  <span className="font-normal text-slate-400">
                    (optional)
                  </span>
                </label>

                <textarea
                  rows={4}
                  value={notes}
                  onChange={(event) =>
                    setNotes(
                      event.target.value
                    )
                  }
                  placeholder="Contoh: Full Stock Opname Semester 2 2026"
                  className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                />

                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) =>
                      setConfirmed(
                        event.target
                          .checked
                      )
                    }
                    className="mt-1 h-4 w-4 shrink-0"
                  />

                  <span className="text-sm leading-6 text-slate-700">
                    Saya memahami bahwa
                    session ini mencakup semua
                    rack aktif dan hasil
                    counting harus direview
                    sebelum Finalize.
                  </span>
                </label>

                <div className="mt-5 border-t border-slate-200 pt-5">
                  <button
                    type="submit"
                    disabled={
                      loading ||
                      processing ||
                      !confirmed
                    }
                    className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-40 sm:w-auto"
                  >
                    {processing
                      ? "Creating..."
                      : "Create Full Stock Opname"}
                  </button>
                </div>
              </section>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
