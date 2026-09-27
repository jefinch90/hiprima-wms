"use client";

import Link from "next/link";
import {
  usePathname,
  useRouter,
} from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";

type AppRole =
  | "owner"
  | "admin"
  | "warehouse_manager"
  | "warehouse_staff"
  | "viewer";

type MenuItem = {
  label: string;
  href: string;
  adminOnly?: boolean;
};

type UserProfile = {
  full_name: string | null;
  role: AppRole;
};

const menuItems: MenuItem[] = [
  {
    label: "Dashboard",
    href: "/",
  },
  {
    label: "Products",
    href: "/products",
  },
  {
    label: "Inventory",
    href: "/inventory",
  },
  {
    label: "Stock Movement",
    href: "/stock-movement",
  },
  {
    label: "Locations",
    href: "/locations",
  },
  {
    label: "Users",
    href: "/users",
    adminOnly: true,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [profile, setProfile] =
    useState<UserProfile | null>(null);

  const [mobileOpen, setMobileOpen] =
    useState(false);

  const [loggingOut, setLoggingOut] =
    useState(false);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !active) {
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select(
          "full_name, role, is_active"
        )
        .eq("id", user.id)
        .single();

      if (
        active &&
        data &&
        data.is_active
      ) {
        setProfile({
          full_name: data.full_name,
          role: data.role as AppRole,
        });
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const canManageUsers =
    profile?.role === "owner" ||
    profile?.role === "admin";

  const visibleMenuItems =
    menuItems.filter((item) => {
      if (
        item.adminOnly &&
        !canManageUsers
      ) {
        return false;
      }

      return true;
    });

  function isActive(
    href: string
  ) {
    if (href === "/") {
      return pathname === "/";
    }

    return (
      pathname === href ||
      pathname.startsWith(
        `${href}/`
      )
    );
  }

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

  async function handleLogout() {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);

    const { error } =
      await supabase.auth.signOut();

    if (error) {
      alert(
        `Logout gagal: ${error.message}`
      );

      setLoggingOut(false);
      return;
    }

    setMobileOpen(false);
    setProfile(null);

    router.replace("/login");
    router.refresh();
  }

  function MenuLinks({
    onNavigate,
  }: {
    onNavigate?: () => void;
  }) {
    return (
      <nav className="mt-10 space-y-3">
        {visibleMenuItems.map(
          (item) => {
            const active =
              isActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={
                  onNavigate
                }
                className={[
                  "block rounded-xl px-4 py-3 text-sm transition",
                  active
                    ? "bg-slate-900 font-medium text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          }
        )}
      </nav>
    );
  }

  function UserFooter() {
    return (
      <div className="mt-auto border-t border-slate-200 pt-5">
        {profile && (
          <div className="mb-4 rounded-xl bg-slate-50 p-4">
            <div className="truncate text-sm font-semibold text-slate-900">
              {profile.full_name ||
                "WMS User"}
            </div>

            <div className="mt-1 text-xs text-slate-500">
              {formatRole(
                profile.role
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loggingOut
            ? "Logging out..."
            : "Logout"}
        </button>

        <div className="mt-5 text-xs text-slate-400">
          PT Prima Berkah Mulia
        </div>
      </div>
    );
  }

  return (
    <>
      {/* DESKTOP SIDEBAR */}
      <aside className="hidden w-[290px] shrink-0 border-r border-slate-200 bg-white lg:flex lg:min-h-screen lg:flex-col">
        <div className="flex min-h-screen flex-col p-6">
          <div>
            <div className="text-xl font-bold text-slate-900">
              Hi.PRIMA
            </div>

            <div className="mt-1 text-sm leading-5 text-slate-500">
              Warehouse Management
              <br />
              System
            </div>
          </div>

          <MenuLinks />

          <UserFooter />
        </div>
      </aside>

      {/* MOBILE MENU BUTTON */}
      <button
        type="button"
        onClick={() =>
          setMobileOpen(true)
        }
        aria-label="Open menu"
        className="fixed bottom-5 left-5 z-40 flex h-14 items-center gap-3 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow-lg lg:hidden"
      >
        <span className="text-xl leading-none">
          ☰
        </span>

        <span>Menu</span>
      </button>

      {/* MOBILE OVERLAY */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() =>
              setMobileOpen(false)
            }
            className="absolute inset-0 h-full w-full bg-slate-950/40"
          />

          {/* MOBILE DRAWER */}
          <aside className="relative z-10 flex h-full w-[290px] max-w-[85vw] flex-col overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-bold text-slate-900">
                  Hi.PRIMA
                </div>

                <div className="mt-1 text-sm leading-5 text-slate-500">
                  Warehouse Management
                  <br />
                  System
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setMobileOpen(
                    false
                  )
                }
                aria-label="Close menu"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-2xl leading-none text-slate-500"
              >
                ×
              </button>
            </div>

            <MenuLinks
              onNavigate={() =>
                setMobileOpen(
                  false
                )
              }
            />

            <UserFooter />
          </aside>
        </div>
      )}
    </>
  );
}