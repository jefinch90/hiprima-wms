"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";

type Profile = {
  full_name: string | null;
  role: string;
  is_active: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  warehouse_manager: "Warehouse Manager",
  warehouse_staff: "Warehouse Staff",
  viewer: "Viewer",
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [mobileOpen, setMobileOpen] =
    useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "full_name, role, is_active"
        )
        .eq("id", user.id)
        .single();

      if (!mounted) return;

      if (
        error ||
        !data ||
        data.is_active !== true
      ) {
        await supabase.auth.signOut();

        router.replace("/login");
        return;
      }

      setProfile(data as Profile);
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (!mobileOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const role = profile?.role ?? "";

  const navItems = [
    {
      label: "Dashboard",
      href: "/",
      visible: true,
    },
    {
      label: "Products",
      href: "/products",
      visible: true,
    },
    {
      label: "Inventory",
      href: "/inventory",
      visible: true,
    },
    {
      label: "Stock Movement",
      href: "/stock-movement",
      visible: true,
    },
    {
      label: "Stock Opname",
      href: "/stock-opname",
      visible: true,
    },
    {
      label: "Locations",
      href: "/locations",
      visible: true,
    },
    {
      label: "Users",
      href: "/users",
      visible:
        role === "owner" ||
        role === "admin",
    },
  ];

  function activeMenu(href: string) {
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

  async function handleLogout() {
    setMobileOpen(false);

    await supabase.auth.signOut();

    router.replace("/login");
    router.refresh();
  }

  function MenuContent() {
    return (
      <>
        <div className="border-b border-slate-200 px-5 py-6">
          <div className="text-lg font-bold text-slate-900">
            Hi.PRIMA WMS
          </div>

          <div className="mt-1 text-xs text-slate-500">
            PT Prima Berkah Mulia
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {navItems
            .filter(
              (item) => item.visible
            )
            .map((item) => {
              const active =
                activeMenu(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() =>
                    setMobileOpen(false)
                  }
                  className={
                    active
                      ? "block rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                      : "block rounded-xl px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3 rounded-xl bg-slate-50 p-3">
            <div className="truncate text-sm font-semibold text-slate-900">
              {profile?.full_name ||
                "WMS User"}
            </div>

            <div className="mt-1 text-xs text-slate-500">
              {ROLE_LABELS[role] ||
                role ||
                "Loading..."}
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Logout
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <aside className="hidden min-h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <MenuContent />
      </aside>

      <button
        type="button"
        aria-label="Open menu"
        onClick={() =>
          setMobileOpen(true)
        }
        className="fixed bottom-5 left-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-xl text-white shadow-lg lg:hidden"
      >
        ☰
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() =>
              setMobileOpen(false)
            }
            className="absolute inset-0 bg-black/40"
          />

          <aside className="relative z-10 flex h-full w-[min(82vw,300px)] flex-col bg-white shadow-2xl">
            <div className="absolute right-3 top-3 z-20">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() =>
                  setMobileOpen(false)
                }
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-600"
              >
                ×
              </button>
            </div>

            <MenuContent />
          </aside>
        </div>
      )}
    </>
  );
}
