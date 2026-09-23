import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import Sidebar from "@/components/Sidebar";
import { updateUserAction } from "./actions";

export const dynamic = "force-dynamic";

type UserRow = {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  total_count: number;
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;

  const search = params.q?.trim() ?? "";
  const successMessage = params.success ?? "";
  const errorMessage = params.error ?? "";

  const currentPage = Math.max(
    Number(params.page ?? "1") || 1,
    1
  );

  const pageSize = 50;
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
    return (
      <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">
        <div className="flex min-h-screen w-full max-w-full">

          <Sidebar />

          <main className="min-w-0 flex-1 p-6 md:p-10">
            <div className="mx-auto w-full max-w-[1500px]">

              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <h1 className="mt-1 text-3xl font-bold">
                Users
              </h1>

              <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-6">

                <div className="font-semibold text-red-800">
                  Users Management tidak dapat dibuka
                </div>

                <p className="mt-2 text-sm text-red-700">
                  {error.message}
                </p>

              </div>

            </div>
          </main>

        </div>
      </div>
    );
  }

  const users =
    (data ?? []) as UserRow[];

  const totalCount = Number(
    users[0]?.total_count ?? 0
  );

  const totalPages = Math.max(
    Math.ceil(
      totalCount / pageSize
    ),
    1
  );

  const formatDate = (
    value: string | null
  ) => {
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
  };

  const makePageUrl = (
    page: number
  ) => {
    const query =
      new URLSearchParams();

    if (search) {
      query.set(
        "q",
        search
      );
    }

    query.set(
      "page",
      String(page)
    );

    return `/users?${query.toString()}`;
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900">

      <div className="flex min-h-screen w-full max-w-full">

        <Sidebar />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-6 md:p-10">

          <div className="mx-auto w-full min-w-0 max-w-[1500px]">

            {/* HEADER */}
            <header className="mb-8">

              <p className="text-sm text-slate-500">
                PT Prima Berkah Mulia
              </p>

              <h1 className="mt-1 text-3xl font-bold">
                Users
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Kelola user dan hak akses Warehouse Management System
              </p>

            </header>


            {/* SUCCESS */}
            {successMessage && (
              <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
                {successMessage}
              </div>
            )}


            {/* ERROR */}
            {errorMessage && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
                {errorMessage}
              </div>
            )}


            {/* SEARCH */}
            <section className="mb-6 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

              <form
                action="/users"
                method="GET"
                className="flex w-full min-w-0 flex-col gap-3 lg:flex-row"
              >

                <input
                  name="q"
                  defaultValue={search}
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
                  <Link
                    href="/users"
                    className="shrink-0 rounded-xl border border-slate-300 px-5 py-3 text-center text-sm"
                  >
                    Reset
                  </Link>
                )}

              </form>

            </section>


            {/* USERS LIST */}
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
                  Page {currentPage} of {totalPages}
                </div>

              </div>


              <div className="divide-y divide-slate-100">

                {users.map(
                  (item) => (
                    <form
                      key={item.user_id}
                      action={updateUserAction}
                      className="w-full max-w-full p-6"
                    >

                      <input
                        type="hidden"
                        name="user_id"
                        value={item.user_id}
                      />

                      <input
                        type="hidden"
                        name="search"
                        value={search}
                      />


                      <div className="grid w-full min-w-0 grid-cols-1 gap-5 xl:grid-cols-12 xl:items-start">

                        {/* EMAIL */}
                        <div className="min-w-0 xl:col-span-3">

                          <div className="mb-2 text-xs font-medium text-slate-400">
                            Email
                          </div>

                          <div className="break-all font-semibold">
                            {item.email}
                          </div>

                          <div className="mt-2 text-xs text-slate-500">
                            Last login:{" "}
                            {formatDate(
                              item.last_sign_in_at
                            )}
                          </div>

                        </div>


                        {/* FULL NAME */}
                        <div className="min-w-0 xl:col-span-3">

                          <label className="mb-2 block text-xs font-medium text-slate-400">
                            Full Name
                          </label>

                          <input
                            name="full_name"
                            defaultValue={item.full_name}
                            placeholder="Nama user"
                            className="h-11 w-full min-w-0 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
                          />

                        </div>


                        {/* ROLE */}
                        <div className="min-w-0 xl:col-span-2">

                          <label className="mb-2 block text-xs font-medium text-slate-400">
                            Role
                          </label>

                          <select
                            name="role"
                            defaultValue={item.role}
                            className="h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-500"
                          >
                            <option value="owner">
                              Owner
                            </option>

                            <option value="admin">
                              Admin
                            </option>

                            <option value="warehouse_manager">
                              Warehouse Manager
                            </option>

                            <option value="warehouse_staff">
                              Warehouse Staff
                            </option>

                            <option value="viewer">
                              Viewer
                            </option>
                          </select>

                        </div>


                        {/* STATUS */}
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
                            className="h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-500"
                          >
                            <option value="true">
                              Active
                            </option>

                            <option value="false">
                              Inactive
                            </option>
                          </select>

                        </div>


                        {/* SAVE */}
                        <div className="min-w-0 xl:col-span-2">

                          <div className="mb-2 text-xs font-medium text-transparent">
                            Action
                          </div>

                          <button
                            type="submit"
                            className="h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
                          >
                            Save
                          </button>

                        </div>

                      </div>


                      {/* STATUS INFO */}
                      <div className="mt-4 flex flex-wrap gap-3 text-xs">

                        <span className="rounded-lg bg-slate-100 px-3 py-1 text-slate-600">
                          Role saat ini:{" "}
                          <span className="font-medium text-slate-900">
                            {item.role}
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
                  )
                )}


                {users.length === 0 && (
                  <div className="p-12 text-center text-sm text-slate-500">
                    Tidak ada user ditemukan.
                  </div>
                )}

              </div>


              {/* PAGINATION */}
              <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">

                <div className="text-sm text-slate-500">
                  Maksimal {pageSize} user per halaman
                </div>

                <div className="flex shrink-0 gap-2">

                  {currentPage > 1 ? (
                    <Link
                      href={makePageUrl(
                        currentPage - 1
                      )}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-300">
                      Previous
                    </span>
                  )}

                  {currentPage < totalPages ? (
                    <Link
                      href={makePageUrl(
                        currentPage + 1
                      )}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
                    >
                      Next
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-300">
                      Next
                    </span>
                  )}

                </div>

              </div>

            </section>

          </div>

        </main>

      </div>

    </div>
  );
}