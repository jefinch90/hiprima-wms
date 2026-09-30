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

type LocationRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  area_code: string;
  area_name: string;
  total_sku: number;
  total_qty: number;
};

type AreaFilter =
  | "all"
  | "normal"
  | "defect"
  | "reject";

function formatNumber(
  value: number | null | undefined
) {
  return Number(value ?? 0).toLocaleString(
    "id-ID"
  );
}

function getAreaType(
  item: LocationRow
): AreaFilter {
  const code = (
    item.area_code || ""
  ).toLowerCase();

  const name = (
    item.area_name || ""
  ).toLowerCase();

  if (
    code.includes("defect") ||
    name.includes("defect")
  ) {
    return "defect";
  }

  if (
    code.includes("reject") ||
    name.includes("reject")
  ) {
    return "reject";
  }

  return "normal";
}

export default function CycleCountPage() {
  const router = useRouter();

  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [locations, setLocations] =
    useState<LocationRow[]>([]);

  const [selected, setSelected] =
    useState<string[]>([]);

  const [search, setSearch] =
    useState("");

  const [areaFilter, setAreaFilter] =
    useState<AreaFilter>("all");

  const [notes, setNotes] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [processing, setProcessing] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  useEffect(() => {
    let mounted = true;

    async function loadPage() {
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
        "warehouse_staff",
      ];

      if (
        !allowedRoles.includes(
          profile.role
        )
      ) {
        await appAlert(
          [
            "Akses Ditolak",
            "",
            "Hanya Owner, Admin, Warehouse Manager, atau Warehouse Staff",
            "yang dapat membuat sesi Cycle Count.",
          ].join("\n")
        );

        router.replace(
          "/stock-opname"
        );

        return;
      }

      const { data, error } =
        await supabase.rpc(
          "get_stock_opname_locations"
        );

      if (!mounted) return;

      if (error) {
        setErrorMessage(
          error.message
        );

        setLoading(false);
        return;
      }

      setLocations(
        (data ?? []) as LocationRow[]
      );

      setLoading(false);
    }

    loadPage();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  const filteredLocations =
    useMemo(() => {
      const keyword =
        search.trim().toLowerCase();

      return locations.filter(
        (item) => {
          const matchesArea =
            areaFilter === "all" ||
            getAreaType(item) ===
              areaFilter;

          if (!matchesArea) {
            return false;
          }

          if (!keyword) {
            return true;
          }

          const searchable = [
            item.location_code,
            item.location_name,
            item.area_code,
            item.area_name,
          ]
            .join(" ")
            .toLowerCase();

          return searchable.includes(
            keyword
          );
        }
      );
    }, [
      locations,
      search,
      areaFilter,
    ]);

  const visibleIds =
    filteredLocations.map(
      (item) => item.location_id
    );

  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) =>
      selected.includes(id)
    );

  const totalSelectedQty =
    locations
      .filter((item) =>
        selected.includes(
          item.location_id
        )
      )
      .reduce(
        (total, item) =>
          total +
          Number(item.total_qty ?? 0),
        0
      );

  function toggleLocation(
    locationId: string
  ) {
    setSelected((current) =>
      current.includes(locationId)
        ? current.filter(
            (id) =>
              id !== locationId
          )
        : [
            ...current,
            locationId,
          ]
    );
  }

  function toggleVisible() {
    if (
      filteredLocations.length === 0
    ) {
      return;
    }

    if (allVisibleSelected) {
      setSelected((current) =>
        current.filter(
          (id) =>
            !visibleIds.includes(id)
        )
      );

      return;
    }

    setSelected((current) => [
      ...new Set([
        ...current,
        ...visibleIds,
      ]),
    ]);
  }

  function clearSelection() {
    setSelected([]);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErrorMessage("");

    if (selected.length === 0) {
      setErrorMessage(
        "Pilih minimal 1 rack untuk Cycle Count."
      );

      return;
    }

    const selectedRackNames =
      locations
        .filter((item) =>
          selected.includes(
            item.location_id
          )
        )
        .map(
          (item) =>
            item.location_code
        );

    const preview =
      selectedRackNames
        .slice(0, 8)
        .join(", ");

    const moreCount =
      selectedRackNames.length - 8;

    const confirmed =
      await appConfirm(
        [
          "Buat Cycle Count?",
          "",
          `Rack: ${selected.length}`,
          preview
            ? `Dipilih: ${preview}${
                moreCount > 0
                  ? ` +${moreCount} lainnya`
                  : ""
              }`
            : "",
          "",
          "Sistem akan mengambil snapshot stok saat ini.",
          "Inventory belum akan berubah.",
        ]
          .filter(Boolean)
          .join("\n")
      );

    if (!confirmed) {
      return;
    }

    setProcessing(true);

    const { data, error } =
      await supabase.rpc(
        "create_stock_opname_session",
        {
          p_opname_type:
            "cycle_count",

          p_location_ids:
            selected,

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
        "Cycle Count berhasil dibuat",
        "",
        `Session: ${
          result?.session_code ??
          "-"
        }`,
        `Rack: ${
          result?.total_locations ??
          selected.length
        }`,
        `SKU / Lines: ${
          result?.total_lines ??
          0
        }`,
      ].join("\n")
    );

    const newSessionId =
      result?.session_id ?? "";

    router.replace(
      newSessionId
        ? `/stock-opname/counting?session=${encodeURIComponent(newSessionId)}`
        : "/stock-opname"
    );

    router.refresh();
  }

  const filters: {
    value: AreaFilter;
    label: string;
  }[] = [
    {
      value: "all",
      label: "Semua",
    },
    {
      value: "normal",
      label: "Normal",
    },
    {
      value: "defect",
      label: "Defect",
    },
    {
      value: "reject",
      label: "Reject",
    },
  ];

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full max-w-full">
        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-4 pb-28 sm:p-6 sm:pb-28 lg:h-dvh lg:overflow-hidden lg:p-6 lg:pb-6">
          <div className="mx-auto w-full min-w-0 max-w-[1300px] lg:flex lg:h-full lg:flex-col">
            <header className="mb-6 shrink-0 lg:mb-4">
              <p className="text-sm text-slate-500">
                Stock Opname
              </p>

              <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="text-2xl font-bold sm:text-3xl">
                    New Cycle Count
                  </h1>

                  <p className="mt-2 text-sm text-slate-500">
                    Cari dan pilih rack
                    yang akan dihitung.
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
              <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="min-h-0 lg:flex lg:flex-1 lg:flex-col"
            >
              <section className="min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex lg:flex-1 lg:flex-col">
                <div className="border-b border-slate-200 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <input
                        value={search}
                        onChange={(
                          event
                        ) =>
                          setSearch(
                            event.target
                              .value
                          )
                        }
                        placeholder="Cari rack... contoh: 10D, DEF, REJ"
                        className="h-11 w-full min-w-0 rounded-xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
                      />
                    </div>

                    <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 lg:pb-0">
                      {filters.map(
                        (filter) => {
                          const active =
                            areaFilter ===
                            filter.value;

                          return (
                            <button
                              key={
                                filter.value
                              }
                              type="button"
                              onClick={() =>
                                setAreaFilter(
                                  filter.value
                                )
                              }
                              className={
                                active
                                  ? "shrink-0 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
                                  : "shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600"
                              }
                            >
                              {
                                filter.label
                              }
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                        {formatNumber(
                          selected.length
                        )}{" "}
                        rack dipilih
                      </span>

                      <span className="text-xs text-slate-500">
                        {formatNumber(
                          filteredLocations.length
                        )}{" "}
                        rack tampil
                      </span>

                      {selected.length >
                        0 && (
                        <span className="text-xs text-slate-500">
                          •{" "}
                          {formatNumber(
                            totalSelectedQty
                          )}{" "}
                          pcs sistem
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={
                          toggleVisible
                        }
                        disabled={
                          loading ||
                          filteredLocations.length ===
                            0
                        }
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold disabled:opacity-40"
                      >
                        {allVisibleSelected
                          ? "Batal Pilih yang Tampil"
                          : "Pilih yang Tampil"}
                      </button>

                      {selected.length >
                        0 && (
                        <button
                          type="button"
                          onClick={
                            clearSelection
                          }
                          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-red-600"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    Loading racks...
                  </div>
                ) : filteredLocations.length ===
                  0 ? (
                  <div className="p-10 text-center">
                    <div className="font-semibold">
                      Rack tidak
                      ditemukan
                    </div>

                    <p className="mt-2 text-sm text-slate-500">
                      Coba ubah search
                      atau filter area.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="hidden max-h-[52vh] overflow-auto md:block lg:min-h-0 lg:max-h-none lg:flex-1">
                      <table className="w-full min-w-[800px] text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                          <tr>
                            <th className="w-16 px-5 py-4">
                              Select
                            </th>

                            <th className="px-5 py-4">
                              Rack
                            </th>

                            <th className="px-5 py-4">
                              Area
                            </th>

                            <th className="px-5 py-4 text-right">
                              SKU
                            </th>

                            <th className="px-5 py-4 text-right">
                              Qty
                            </th>
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-100">
                          {filteredLocations.map(
                            (item) => {
                              const checked =
                                selected.includes(
                                  item.location_id
                                );

                              return (
                                <tr
                                  key={
                                    item.location_id
                                  }
                                  onClick={() =>
                                    toggleLocation(
                                      item.location_id
                                    )
                                  }
                                  className={
                                    checked
                                      ? "cursor-pointer bg-slate-50 hover:bg-slate-100"
                                      : "cursor-pointer hover:bg-slate-50"
                                  }
                                >
                                  <td
                                    className="px-5 py-4"
                                    onClick={(
                                      event
                                    ) =>
                                      event.stopPropagation()
                                    }
                                  >
                                    <input
                                      type="checkbox"
                                      checked={
                                        checked
                                      }
                                      onChange={() =>
                                        toggleLocation(
                                          item.location_id
                                        )
                                      }
                                      className="h-4 w-4 cursor-pointer"
                                    />
                                  </td>

                                  <td className="px-5 py-4">
                                    <div className="font-semibold">
                                      {
                                        item.location_code
                                      }
                                    </div>

                                    <div className="mt-1 text-xs text-slate-500">
                                      {
                                        item.location_name
                                      }
                                    </div>
                                  </td>

                                  <td className="px-5 py-4">
                                    <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium">
                                      {
                                        item.area_name
                                      }
                                    </span>
                                  </td>

                                  <td className="px-5 py-4 text-right font-medium">
                                    {formatNumber(
                                      item.total_sku
                                    )}
                                  </td>

                                  <td className="px-5 py-4 text-right font-semibold">
                                    {formatNumber(
                                      item.total_qty
                                    )}
                                  </td>
                                </tr>
                              );
                            }
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="max-h-[52vh] space-y-2 overflow-y-auto p-3 md:hidden">
                      {filteredLocations.map(
                        (item) => {
                          const checked =
                            selected.includes(
                              item.location_id
                            );

                          return (
                            <button
                              key={
                                item.location_id
                              }
                              type="button"
                              onClick={() =>
                                toggleLocation(
                                  item.location_id
                                )
                              }
                              className={
                                checked
                                  ? "flex w-full items-center gap-3 rounded-xl border border-slate-900 bg-slate-50 p-4 text-left"
                                  : "flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left"
                              }
                            >
                              <input
                                type="checkbox"
                                readOnly
                                checked={
                                  checked
                                }
                                className="h-4 w-4 shrink-0"
                              />

                              <div className="min-w-0 flex-1">
                                <div className="font-semibold">
                                  {
                                    item.location_code
                                  }
                                </div>

                                <div className="mt-1 truncate text-xs text-slate-500">
                                  {
                                    item.area_name
                                  }
                                </div>
                              </div>

                              <div className="shrink-0 text-right">
                                <div className="font-semibold">
                                  {formatNumber(
                                    item.total_qty
                                  )}{" "}
                                  pcs
                                </div>

                                <div className="mt-1 text-xs text-slate-500">
                                  {formatNumber(
                                    item.total_sku
                                  )}{" "}
                                  SKU
                                </div>
                              </div>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </>
                )}
              </section>

              <div className="sticky bottom-3 z-20 mt-5 shrink-0 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:p-5 lg:static lg:mt-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                  <div className="min-w-0 flex-1">
                    <label className="mb-2 block text-xs font-semibold text-slate-500">
                      Catatan
                      <span className="ml-1 font-normal text-slate-400">
                        (opsional)
                      </span>
                    </label>

                    <input
                      value={notes}
                      onChange={(
                        event
                      ) =>
                        setNotes(
                          event.target
                            .value
                        )
                      }
                      placeholder="Contoh: Cycle count shift pagi"
                      className="h-11 w-full min-w-0 rounded-xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
                    />
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="text-sm text-slate-500 sm:text-right">
                      <span className="font-bold text-slate-900">
                        {formatNumber(
                          selected.length
                        )}
                      </span>{" "}
                      rack
                    </div>

                    <button
                      type="submit"
                      disabled={
                        processing ||
                        loading ||
                        selected.length ===
                          0
                      }
                      className="min-h-11 shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {processing
                        ? "Creating..."
                        : "Create Cycle Count"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
