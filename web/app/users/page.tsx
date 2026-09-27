"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/utils/supabase/client";

type AppRole =
  | "owner"
  | "admin"
  | "warehouse_manager"
  | "warehouse_staff"
  | "viewer";

type UserRow = {
  user_id: string;
  email: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  total_count: number;
};

export default function UsersPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const pageSize = 50;

  const [users, setUsers] = useState<UserRow[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);

  const [currentRole, setCurrentRole] =
    useState<AppRole | null>(null);

  const [loading, setLoading] = useState(true);

  const [savingUserId, setSavingUserId] =
    useState<string | null>(null);

  const [successMessage, setSuccessMessage] =
    useState("");

  const [errorMessage, setErrorMessage] =
    useState("");

  const [totalCount, setTotalCount] = useState(0);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login");
      return;
    }

    setCurrentUserId(user.id);

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
      !profile.is_active
    ) {
      window.alert(
        [
          "Akses Ditolak",
          "",
          "Akun WMS tidak aktif atau profile tidak ditemukan.",
        ].join("\n")
      );

      await supabase.auth.signOut();

      router.replace("/login");
      return;
    }

    const role = profile.role as AppRole;

    setCurrentRole(role);

    if (
      role !== "owner" &&
      role !== "admin"
    ) {
      window.alert(
        [
          "Akses Ditolak",
          "",
          `Role ${formatRole(
            role
          )} tidak memiliki izin mengelola Users.`,
          "",
          "Anda akan dikembalikan ke Dashboard.",
        ].join("\n")
      );

      router.replace("/");
      return;
    }

    const offset =
      (currentPage - 1) * pageSize;

    const { data, error } =
      await supabase.rpc(
        "get_users_list",
        {
          p_search: search || null,
          p_limit: pageSize,
          p_offset: offset,
        }
      );

    if (error) {
      setUsers([]);
      setTotalCount(0);
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    const rows =
      (data ?? []) as UserRow[];

    setUsers(rows);

    setTotalCount(
      Number(
        rows[0]?.total_count ?? 0
      )
    );

    setLoading(false);
  }, [
    supabase,
    router,
    currentPage,
    search,
  ]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const totalPages = Math.max(
    Math.ceil(totalCount / pageSize),
    1
  );

  function formatRole(
    role: AppRole
  ) {
    switch (role) {
      case "owner":
        return "Owner";

      case "admin":
        return "Admin";

      case "warehouse_manager":
        return "Warehouse Manager";

      case "warehouse_staff":
        return "Warehouse Staff";

      case "viewer":
        return "Viewer";

      default:
        return role;
    }
  }

  function formatDate(
    value: string | null
  ) {
    if (!value) {
      return "Belum pernah login";
    }

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

  function handleSearch(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setSuccessMessage("");
    setErrorMessage("");
    setCurrentPage(1);
    setSearch(searchInput.trim());
  }

  function handleReset() {
    setSearchInput("");
    setSearch("");
    setCurrentPage(1);
    setSuccessMessage("");
    setErrorMessage("");
  }

  async function handleUpdate(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData =
      new FormData(form);

    const userId = String(
      formData.get("user_id") ?? ""
    );

    const fullName = String(
      formData.get("full_name") ?? ""
    ).trim();

    const role = String(
      formData.get("role") ?? ""
    ).trim() as AppRole;

    const isActive =
      String(
        formData.get("is_active") ??
          ""
      ) === "true";

    setSuccessMessage("");
    setErrorMessage("");

    if (
      currentRole !== "owner" &&
      currentRole !== "admin"
    ) {
      window.alert(
        [
          "Akses Ditolak",
          "",
          "Anda tidak memiliki izin mengelola Users.",
        ].join("\n")
      );

      return;
    }

    if (!userId) {
      setErrorMessage(
        "User ID tidak ditemukan."
      );

      return;
    }

    const targetUser =
      users.find(
        (item) =>
          item.user_id === userId
      );

    if (!targetUser) {
      setErrorMessage(
        "Data user tidak ditemukan."
      );

      return;
    }

    const validRoles: AppRole[] = [
      "owner",
      "admin",
      "warehouse_manager",
      "warehouse_staff",
      "viewer",
    ];

    if (
      !validRoles.includes(role)
    ) {
      setErrorMessage(
        "Role tidak valid."
      );

      return;
    }

    /*
     * ADMIN PROTECTION
     * Admin tidak boleh:
     * - mengubah akun Owner
     * - menjadikan user lain Owner
     */
    if (
      currentRole === "admin" &&
      targetUser.role === "owner"
    ) {
      window.alert(
        [
          "Akses Ditolak",
          "",
          "Admin tidak dapat mengubah akun Owner.",
        ].join("\n")
      );

      return;
    }

    if (
      currentRole === "admin" &&
      role === "owner"
    ) {
      window.alert(
        [
          "Akses Ditolak",
          "",
          "Admin tidak dapat memberikan role Owner.",
        ].join("\n")
      );

      return;
    }

    /*
     * SELF PROTECTION
     * User yang sedang login tidak boleh
     * menonaktifkan dirinya sendiri.
     */
    if (
      currentUserId === userId &&
      !isActive
    ) {
      window.alert(
        [
          "Perubahan Ditolak",
          "",
          "Anda tidak dapat menonaktifkan akun yang sedang digunakan.",
        ].join("\n")
      );

      return;
    }

    setSavingUserId(userId);

    const { error } =
      await supabase.rpc(
        "update_wms_user",
        {
          p_user_id: userId,
          p_full_name:
            fullName || null,
          p_role: role,
          p_is_active: isActive,
        }
      );

    if (error) {
      const message =
        error.message;

      setErrorMessage(message);

      const normalizedMessage =
        message.toLowerCase();

      if (
        normalizedMessage.includes(
          "akses ditolak"
        ) ||
        normalizedMessage.includes(
          "permission"
        ) ||
        normalizedMessage.includes(
          "owner"
        )
      ) {
        window.alert(
          [
            "Perubahan Ditolak",
            "",
            message,
          ].join("\n")
        );
      }

      setSavingUserId(null);
      return;
    }

    setSuccessMessage(
      "Data user berhasil diperbarui."
    );

    setSavingUserId(null);

    await loadUsers();
  }

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
                Users
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Kelola user dan hak
                akses Warehouse
                Management System
              </p>

              {currentRole ===
                "admin" && (
                <div className="mt-4 inline-flex rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Admin dapat
                  mengelola user,
                  tetapi akun Owner
                  dilindungi.
                </div>
              )}
            </header>

            {successMessage && (
              <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
                {successMessage}
              </div>
            )}

            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
                {errorMessage}
              </div>
            )}

            <section className="mb-6 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <form
                onSubmit={handleSearch}
                className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
              >
                <input
                  value={
                    searchInput
                  }
                  onChange={(
                    event
                  ) =>
                    setSearchInput(
                      event.target
                        .value
                    )
                  }
                  placeholder="Cari nama, email, atau role..."
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                />

                <button
                  type="submit"
                  className="shrink-0 rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white"
                >
                  Search
                </button>

                {search && (
                  <button
                    type="button"
                    onClick={
                      handleReset
                    }
                    className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-center text-sm"
                  >
                    Reset
                  </button>
                )}
              </form>
            </section>

            <section className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    User List
                  </h2>

                  <p className="text-sm text-slate-500">
                    {totalCount.toLocaleString(
                      "id-ID"
                    )}{" "}
                    user ditemukan
                  </p>
                </div>

                <div className="shrink-0 text-sm text-slate-500">
                  Page{" "}
                  {currentPage} of{" "}
                  {totalPages}
                </div>
              </div>

              {loading ? (
                <div className="p-12 text-center text-sm text-slate-500">
                  Memuat data user...
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {users.map(
                    (item) => {
                      const ownerProtected =
                        currentRole ===
                          "admin" &&
                        item.role ===
                          "owner";

                      const isCurrentUser =
                        currentUserId ===
                        item.user_id;

                      return (
                        <form
                          key={
                            item.user_id
                          }
                          onSubmit={
                            handleUpdate
                          }
                          className={[
                            "w-full max-w-full p-6",
                            ownerProtected
                              ? "bg-slate-50/70"
                              : "",
                          ].join(
                            " "
                          )}
                        >
                          <input
                            type="hidden"
                            name="user_id"
                            value={
                              item.user_id
                            }
                          />

                          <div className="grid w-full min-w-0 grid-cols-1 gap-5 xl:grid-cols-12 xl:items-start">
                            <div className="min-w-0 xl:col-span-3">
                              <div className="mb-2 text-xs font-medium text-slate-400">
                                Email
                              </div>

                              <div className="break-all font-semibold">
                                {
                                  item.email
                                }
                              </div>

                              <div className="mt-2 text-xs text-slate-500">
                                Last login:{" "}
                                {formatDate(
                                  item.last_sign_in_at
                                )}
                              </div>

                              {ownerProtected && (
                                <div className="mt-3 inline-flex rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                  Protected
                                  Owner
                                </div>
                              )}

                              {isCurrentUser && (
                                <div className="mt-3 inline-flex rounded-lg bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                                  Akun
                                  Anda
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 xl:col-span-3">
                              <label className="mb-2 block text-xs font-medium text-slate-400">
                                Full Name
                              </label>

                              <input
                                name="full_name"
                                defaultValue={
                                  item.full_name
                                }
                                disabled={
                                  ownerProtected
                                }
                                placeholder="Nama user"
                                className="h-11 w-full min-w-0 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                              />
                            </div>

                            <div className="min-w-0 xl:col-span-2">
                              <label className="mb-2 block text-xs font-medium text-slate-400">
                                Role
                              </label>

                              <select
                                name="role"
                                defaultValue={
                                  item.role
                                }
                                disabled={
                                  ownerProtected
                                }
                                className="h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                              >
                                <option
                                  value="owner"
                                  disabled={
                                    currentRole !== "owner"
                                  }
                                >
                                  Owner
                                </option>

                                <option value="admin">
                                  Admin
                                </option>

                                <option value="warehouse_manager">
                                  Warehouse
                                  Manager
                                </option>

                                <option value="warehouse_staff">
                                  Warehouse
                                  Staff
                                </option>

                                <option value="viewer">
                                  Viewer
                                </option>
                              </select>

                              {currentRole ===
                                "admin" &&
                                !ownerProtected && (
                                  <div className="mt-2 text-xs text-slate-400">
                                    Admin
                                    tidak
                                    dapat
                                    memberikan
                                    role
                                    Owner.
                                  </div>
                                )}
                            </div>

                            <div className="min-w-0 xl:col-span-2">
                              <label className="mb-2 block text-xs font-medium text-slate-400">
                                Status
                              </label>

                              <select
                                name="is_active"
                                defaultValue={
                                  item.is_active
                                    ? "true"
                                    : "false"
                                }
                                disabled={
                                  ownerProtected
                                }
                                className="h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                              >
                                <option value="true">
                                  Active
                                </option>

                                <option
                                  value="false"
                                  disabled={
                                    isCurrentUser
                                  }
                                >
                                  Inactive
                                </option>
                              </select>

                              {isCurrentUser && (
                                <div className="mt-2 text-xs text-slate-400">
                                  Akun
                                  yang
                                  sedang
                                  digunakan
                                  tidak
                                  dapat
                                  dinonaktifkan.
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 xl:col-span-2">
                              <div className="mb-2 text-xs font-medium text-transparent">
                                Action
                              </div>

                              <button
                                type="submit"
                                disabled={
                                  ownerProtected ||
                                  savingUserId ===
                                    item.user_id
                                }
                                className="h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                              >
                                {ownerProtected
                                  ? "Protected"
                                  : savingUserId ===
                                      item.user_id
                                    ? "Saving..."
                                    : "Save"}
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-3 text-xs">
                            <span className="rounded-lg bg-slate-100 px-3 py-1 text-slate-600">
                              Role saat ini:{" "}
                              <span className="font-medium text-slate-900">
                                {formatRole(
                                  item.role
                                )}
                              </span>
                            </span>

                            <span
                              className={
                                item.is_active
                                  ? "rounded-lg bg-emerald-50 px-3 py-1 font-medium text-emerald-700"
                                  : "rounded-lg bg-red-50 px-3 py-1 font-medium text-red-700"
                              }
                            >
                              {item.is_active
                                ? "Active"
                                : "Inactive"}
                            </span>
                          </div>
                        </form>
                      );
                    }
                  )}

                  {users.length ===
                    0 && (
                    <div className="p-12 text-center text-sm text-slate-500">
                      Tidak ada user
                      ditemukan.
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  Maksimal{" "}
                  {pageSize} user per
                  halaman
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={
                      currentPage <=
                      1
                    }
                    onClick={() =>
                      setCurrentPage(
                        (page) =>
                          Math.max(
                            page - 1,
                            1
                          )
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Previous
                  </button>

                  <button
                    type="button"
                    disabled={
                      currentPage >=
                      totalPages
                    }
                    onClick={() =>
                      setCurrentPage(
                        (page) =>
                          Math.min(
                            page + 1,
                            totalPages
                          )
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}